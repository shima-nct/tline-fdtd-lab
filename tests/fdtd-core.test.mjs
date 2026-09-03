import assert from "node:assert/strict";
import { FDTDLine } from "../dist/fdtd-core.mjs";

const base = {
  length: 10,
  cells: 240,
  resistance: 0,
  inductance: 250e-9,
  conductance: 0,
  capacitance: 100e-12,
  courant: 0.95,
};

function pulse(sim, t) {
  const width = 20e-9;
  const start = 2 * sim.dt;
  const local = t - start;
  if (local < 0 || local > width) return 0;
  const edge = Math.min(width * 0.16, Math.max(3 * sim.dt, width * 0.08));
  if (local < edge) return 0.5 * (1 - Math.cos(Math.PI * local / edge));
  if (local > width - edge) return 0.5 * (1 - Math.cos(Math.PI * (width - local) / edge));
  return 1;
}

function run(loadResistance, duration) {
  const sim = new FDTDLine(base);
  const sourceSamples = [];
  const loadSamples = [];
  while (sim.time < duration) {
    sim.fullStep(pulse(sim, sim.time + sim.dt / 2), 50, loadResistance === "matched" ? sim.z0 : loadResistance);
    sourceSamples.push(sim.voltage[0]);
    loadSamples.push(sim.voltage[sim.n]);
  }
  return { sim, sourceSamples, loadSamples };
}

const reference = new FDTDLine(base);
assert.ok(Math.abs(reference.z0 - 50) < 1e-12, "Z0 should be 50 ohms");
assert.ok(Math.abs(reference.velocity - 2e8) < 1e-6, "velocity should be 2e8 m/s");
assert.ok(reference.dt < reference.dx / reference.velocity, "Courant stability condition should hold");

const matched = run("matched", 150e-9);
const opened = run(Infinity, 150e-9);
const shorted = run(0, 150e-9);

for (const result of [matched, opened, shorted]) {
  assert.ok(result.sim.voltage.every(Number.isFinite), "voltage must remain finite");
  assert.ok(result.sim.current.every(Number.isFinite), "current must remain finite");
}

const maxMatchedLoad = Math.max(...matched.loadSamples);
const maxOpenLoad = Math.max(...opened.loadSamples);
assert.ok(maxMatchedLoad > 0.35 && maxMatchedLoad < 0.65, "matched load should receive the launched half-amplitude pulse");
assert.ok(maxOpenLoad > 0.8, "open load should show a positive voltage reflection");
assert.ok(shorted.loadSamples.every((v) => v === 0), "shorted load voltage must stay at zero");

const reflectedWindowStart = Math.floor(2.0 * reference.delay / reference.dt);
const matchedReturn = Math.max(...matched.sourceSamples.slice(reflectedWindowStart).map(Math.abs));
const openReturn = Math.max(...opened.sourceSamples.slice(reflectedWindowStart).map(Math.abs));
assert.ok(openReturn > matchedReturn + 0.15, "open load should return more voltage than a matched load");

const envelopeTest = new FDTDLine(base);
envelopeTest.setEnvelopeHoldTime(2 * envelopeTest.dt);
envelopeTest.voltage[0] = 1;
envelopeTest.captureEnvelope();
envelopeTest.time += envelopeTest.dt;
envelopeTest.voltage[0] = 0.25;
envelopeTest.captureEnvelope();
assert.equal(envelopeTest.envelope[0], 1, "peak should remain inside the hold window");
envelopeTest.time += 2 * envelopeTest.dt;
envelopeTest.captureEnvelope();
assert.equal(envelopeTest.envelope[0], 0.25, "expired peak should leave the hold window");

const { forward: iForward, backward: iBackward } = opened.sim.currentWaveComponents();
for (let j = 0; j < opened.sim.n; j += 1) {
  assert.ok(Math.abs(iForward[j] + iBackward[j] - opened.sim.current[j]) < 1e-12,
    "signed forward and backward currents must reconstruct total current");
}

console.log("FDTD core tests passed", {
  z0: reference.z0,
  velocity: reference.velocity,
  maxMatchedLoad,
  maxOpenLoad,
  matchedReturn,
  openReturn,
});

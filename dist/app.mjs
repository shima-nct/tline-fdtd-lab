import { FDTDLine } from "./fdtd-core.mjs";

const $ = (id) => document.getElementById(id);
const refs = {
  run: $("runButton"), half: $("halfButton"), reset: $("resetButton"), warning: $("warning"),
  sourceMode: $("sourceMode"), amplitude: $("amplitude"), pulseWidth: $("pulseWidth"), frequency: $("frequency"),
  sourceResistance: $("sourceResistance"), loadMode: $("loadMode"), loadResistance: $("loadResistance"),
  lineLength: $("lineLength"), cells: $("cells"), resistance: $("resistance"), inductance: $("inductance"),
  conductance: $("conductance"), capacitance: $("capacitance"), courant: $("courant"), speed: $("speed"),
  speedOutput: $("speedOutput"), widthField: $("widthField"), frequencyField: $("frequencyField"),
  loadResistanceField: $("loadResistanceField"), showTotal: $("showTotal"), showForward: $("showForward"),
  showBackward: $("showBackward"), showEnvelope: $("showEnvelope"), timeMetric: $("timeMetric"),
  showCurrentTotal: $("showCurrentTotal"), showCurrentForward: $("showCurrentForward"),
  showCurrentBackward: $("showCurrentBackward"),
  envelopeHoldTime: $("envelopeHoldTime"),
  dxMetric: $("dxMetric"), dtMetric: $("dtMetric"), z0Metric: $("z0Metric"), velocityMetric: $("velocityMetric"),
  delayMetric: $("delayMetric"), microR: $("microR"), microL: $("microL"), microG: $("microG"),
  microC: $("microC"), phaseBadge: $("phaseBadge"), currentStep: $("currentStep"), voltageStep: $("voltageStep"),
  voltageCanvas: $("voltageCanvas"), currentCanvas: $("currentCanvas"), historyCanvas: $("historyCanvas"),
};

let simulation;
let running = false;
let history = [];

function configFromForm() {
  return {
    length: Number(refs.lineLength.value), cells: Number(refs.cells.value), resistance: Number(refs.resistance.value),
    inductance: Number(refs.inductance.value) * 1e-9, conductance: Number(refs.conductance.value) * 1e-6,
    capacitance: Number(refs.capacitance.value) * 1e-12, courant: Number(refs.courant.value),
    envelopeHoldTime: Number(refs.envelopeHoldTime.value) * 1e-9,
  };
}

function showWarning(message = "") {
  refs.warning.hidden = !message;
  refs.warning.textContent = message;
}

function getLoadResistance() {
  if (refs.loadMode.value === "open") return Infinity;
  if (refs.loadMode.value === "short") return 0;
  if (refs.loadMode.value === "matched") return simulation.z0;
  return Number(refs.loadResistance.value);
}

function sourceAt(t) {
  const amplitude = Number(refs.amplitude.value);
  const start = 2 * simulation.dt;
  const mode = refs.sourceMode.value;
  if (mode === "step") return t >= start ? amplitude : 0;
  if (mode === "sine") {
    const f = Number(refs.frequency.value) * 1e6;
    const tau = Math.max(1 / f, 4 * simulation.dt);
    const ramp = t <= 0 ? 0 : Math.min(1, t / tau);
    const smoothRamp = ramp * ramp * (3 - 2 * ramp);
    return amplitude * smoothRamp * Math.sin(2 * Math.PI * f * t);
  }
  const width = Math.max(Number(refs.pulseWidth.value) * 1e-9, 6 * simulation.dt);
  if (mode === "gaussian") {
    const center = start + width / 2;
    const sigma = width / 6;
    return amplitude * Math.exp(-0.5 * ((t - center) / sigma) ** 2);
  }
  const local = t - start;
  if (local < 0 || local > width) return 0;
  const edge = Math.min(width * 0.16, Math.max(3 * simulation.dt, width * 0.08));
  if (local < edge) return amplitude * 0.5 * (1 - Math.cos(Math.PI * local / edge));
  if (local > width - edge) return amplitude * 0.5 * (1 - Math.cos(Math.PI * (width - local) / edge));
  return amplitude;
}

function updateMetrics() {
  const micro = simulation.microElements();
  refs.timeMetric.textContent = `${(simulation.time * 1e9).toFixed(3)} ns`;
  refs.dxMetric.textContent = formatSI(simulation.dx, "m");
  refs.dtMetric.textContent = formatSI(simulation.dt, "s");
  refs.z0Metric.textContent = `${simulation.z0.toFixed(2)} Ω`;
  refs.velocityMetric.textContent = `${simulation.velocity.toExponential(3)} m/s`;
  refs.delayMetric.textContent = formatSI(simulation.delay, "s");
  refs.microR.textContent = formatSI(micro.resistance, "Ω");
  refs.microL.textContent = formatSI(micro.inductance, "H");
  refs.microG.textContent = formatSI(micro.conductance, "S");
  refs.microC.textContent = formatSI(micro.capacitance, "F");

  const currentPhase = simulation.phase === "current";
  refs.phaseBadge.textContent = currentPhase ? "次：I 更新 (n+½)" : "次：V 更新 (n+1)";
  refs.currentStep.classList.toggle("active", currentPhase);
  refs.voltageStep.classList.toggle("active", !currentPhase);
}

function formatSI(value, unit) {
  if (value === 0) return `0 ${unit}`;
  const scales = [
    [1e9, "G"], [1e6, "M"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"], [1e-15, "f"],
  ];
  const abs = Math.abs(value);
  const picked = scales.find(([scale]) => abs >= scale * 0.999) || scales.at(-1);
  const scaled = value / picked[0];
  return `${scaled.toFixed(Math.abs(scaled) >= 100 ? 1 : Math.abs(scaled) >= 10 ? 2 : 3)} ${picked[1]}${unit}`;
}

function rebuild() {
  running = false;
  refs.run.textContent = "▶ 実行";
  try {
    simulation = new FDTDLine(configFromForm());
    history = [];
    showWarning();
    updateMetrics();
    drawAll();
  } catch (error) {
    showWarning(error.message);
  }
}

function recordHistory() {
  const mid = Math.floor(simulation.n / 2);
  history.push({ t: simulation.time, source: simulation.voltage[0], mid: simulation.voltage[mid], load: simulation.voltage[simulation.n] });
  const windowSeconds = Math.max(4 * simulation.delay, 10 * simulation.dt);
  while (history.length > 2 && history[0].t < simulation.time - windowSeconds) history.shift();
  if (history.length > 1400) history.splice(0, history.length - 1400);
}

function doFullStep() {
  const nextTime = simulation.time + simulation.dt / 2;
  simulation.fullStep(sourceAt(nextTime), Number(refs.sourceResistance.value), getLoadResistance());
  recordHistory();
}

function setupCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(300, Math.round(rect.width));
  const height = Math.max(150, Math.round(rect.height));
  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
    canvas.width = width * dpr;
    canvas.height = height * dpr;
  }
  const context = canvas.getContext("2d");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { context, width, height };
}

function drawAxes(context, width, height, yMax, yUnit, xLabel) {
  const p = { left: 52, right: 18, top: 12, bottom: 30 };
  const plotW = width - p.left - p.right;
  const plotH = height - p.top - p.bottom;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#090f14";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "#1d2b36";
  context.lineWidth = 1;
  context.fillStyle = "#7f93a2";
  context.font = "11px ui-monospace, monospace";
  for (let k = 0; k <= 4; k += 1) {
    const y = p.top + plotH * k / 4;
    context.beginPath(); context.moveTo(p.left, y); context.lineTo(width - p.right, y); context.stroke();
    const value = yMax * (1 - k / 2);
    context.fillText(`${value.toFixed(Math.abs(yMax) < 0.1 ? 3 : 2)} ${yUnit}`, 4, y + 4);
  }
  for (let k = 0; k <= 5; k += 1) {
    const x = p.left + plotW * k / 5;
    context.beginPath(); context.moveTo(x, p.top); context.lineTo(x, height - p.bottom); context.stroke();
    context.fillText(`${(simulation.length * k / 5).toFixed(1)}`, x - 8, height - 11);
  }
  context.fillText(xLabel, width - 78, height - 11);
  return { p, plotW, plotH };
}

function maxAbs(arrays, floor = 1) {
  let max = floor;
  for (const values of arrays) for (const value of values) if (Number.isFinite(value)) max = Math.max(max, Math.abs(value));
  return max * 1.12;
}

function plotArray(context, values, geometry, yMax, color, width = 2, dash = []) {
  const { p, plotW, plotH } = geometry;
  context.beginPath();
  context.strokeStyle = color;
  context.lineWidth = width;
  context.setLineDash(dash);
  for (let j = 0; j < values.length; j += 1) {
    const x = p.left + plotW * j / (values.length - 1);
    const y = p.top + plotH * (0.5 - values[j] / (2 * yMax));
    if (j === 0) context.moveTo(x, y); else context.lineTo(x, y);
  }
  context.stroke();
  context.setLineDash([]);
}

function drawNodeMarkers(context, geometry, values, yMax) {
  const { p, plotW, plotH } = geometry;
  const stride = Math.max(1, Math.round(simulation.n / 24));
  context.fillStyle = "#35d8ff";
  for (let j = 0; j < values.length; j += stride) {
    const x = p.left + plotW * j / simulation.n;
    const y = p.top + plotH * (0.5 - values[j] / (2 * yMax));
    context.fillRect(x - 1.5, y - 1.5, 3, 3);
  }
}

function drawVoltage() {
  const { context, width, height } = setupCanvas(refs.voltageCanvas);
  const { forward, backward } = simulation.waveComponents();
  const amp = Math.max(0.1, Number(refs.amplitude.value));
  const yMax = maxAbs([simulation.voltage, forward, backward, refs.showEnvelope.checked ? simulation.envelope : []], amp * 1.15);
  const geometry = drawAxes(context, width, height, yMax, "V", "位置 x [m]");
  if (refs.showEnvelope.checked) {
    plotArray(context, simulation.envelope, geometry, yMax, "#59e3a7", 1.4, [5, 4]);
    const negative = Float64Array.from(simulation.envelope, (v) => -v);
    plotArray(context, negative, geometry, yMax, "#59e3a7", 1.4, [5, 4]);
  }
  if (refs.showForward.checked) plotArray(context, forward, geometry, yMax, "#ffd45c", 1.6, [7, 4]);
  if (refs.showBackward.checked) plotArray(context, backward, geometry, yMax, "#ff5fb8", 1.6, [3, 4]);
  if (refs.showTotal.checked) {
    plotArray(context, simulation.voltage, geometry, yMax, "#35d8ff", 2.4);
    drawNodeMarkers(context, geometry, simulation.voltage, yMax);
  }
  drawBoundaryLabels(context, geometry, height);
}

function drawBoundaryLabels(context, geometry) {
  const { p, plotW } = geometry;
  context.font = "700 10px ui-monospace, monospace";
  context.fillStyle = "#7aa7ff";
  context.fillText("SOURCE", p.left + 5, p.top + 13);
  context.textAlign = "right";
  context.fillStyle = "#ff906b";
  context.fillText(refs.loadMode.options[refs.loadMode.selectedIndex].text.toUpperCase(), p.left + plotW - 5, p.top + 13);
  context.textAlign = "left";
}

function drawCurrent() {
  const { context, width, height } = setupCanvas(refs.currentCanvas);
  const { forward, backward } = simulation.currentWaveComponents();
  const expected = Math.max(1e-6, Number(refs.amplitude.value) / simulation.z0);
  const visible = [];
  if (refs.showCurrentTotal.checked) visible.push(simulation.current);
  if (refs.showCurrentForward.checked) visible.push(forward);
  if (refs.showCurrentBackward.checked) visible.push(backward);
  const yMax = maxAbs(visible, expected * 1.15);
  const geometry = drawAxes(context, width, height, yMax, "A", "位置 x [m]");
  if (refs.showCurrentForward.checked) plotArray(context, forward, geometry, yMax, "#ffd45c", 1.6, [7, 4]);
  if (refs.showCurrentBackward.checked) plotArray(context, backward, geometry, yMax, "#ff5fb8", 1.6, [3, 4]);
  if (refs.showCurrentTotal.checked) plotArray(context, simulation.current, geometry, yMax, "#35d8ff", 2.2);
  const { p, plotW, plotH } = geometry;
  const stride = Math.max(1, Math.round(simulation.n / 24));
  if (refs.showCurrentTotal.checked) {
    context.fillStyle = "#35d8ff";
    for (let j = 0; j < simulation.n; j += stride) {
      const x = p.left + plotW * (j + 0.5) / simulation.n;
      const y = p.top + plotH * (0.5 - simulation.current[j] / (2 * yMax));
      context.beginPath(); context.arc(x, y, 1.8, 0, Math.PI * 2); context.fill();
    }
  }
  drawBoundaryLabels(context, geometry);
}

function drawHistory() {
  const { context, width, height } = setupCanvas(refs.historyCanvas);
  const p = { left: 52, right: 18, top: 12, bottom: 30 };
  const plotW = width - p.left - p.right;
  const plotH = height - p.top - p.bottom;
  const amp = Math.max(0.1, Number(refs.amplitude.value));
  const values = history.flatMap((d) => [d.source, d.mid, d.load]);
  const yMax = maxAbs([values], amp * 1.15);
  const windowSeconds = Math.max(4 * simulation.delay, 10 * simulation.dt);
  const tEnd = Math.max(windowSeconds, simulation.time);
  const tStart = Math.max(0, tEnd - windowSeconds);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#090f14"; context.fillRect(0, 0, width, height);
  context.font = "11px ui-monospace, monospace";
  for (let k = 0; k <= 4; k += 1) {
    const y = p.top + plotH * k / 4;
    context.strokeStyle = "#1d2b36"; context.beginPath(); context.moveTo(p.left, y); context.lineTo(width - p.right, y); context.stroke();
    context.fillStyle = "#7f93a2"; context.fillText(`${(yMax * (1 - k / 2)).toFixed(2)} V`, 4, y + 4);
  }
  for (let k = 0; k <= 5; k += 1) {
    const x = p.left + plotW * k / 5;
    context.strokeStyle = "#1d2b36"; context.beginPath(); context.moveTo(x, p.top); context.lineTo(x, height - p.bottom); context.stroke();
    const t = (tStart + (tEnd - tStart) * k / 5) * 1e9;
    context.fillStyle = "#7f93a2"; context.fillText(t.toFixed(0), x - 8, height - 11);
  }
  context.fillText("時刻 [ns]", width - 79, height - 11);
  const series = [["source", "#35d8ff"], ["mid", "#ffd45c"], ["load", "#ff5fb8"]];
  for (const [key, color] of series) {
    context.beginPath(); context.strokeStyle = color; context.lineWidth = 1.8;
    let begun = false;
    for (const point of history) {
      if (point.t < tStart) continue;
      const x = p.left + plotW * (point.t - tStart) / Math.max(Number.EPSILON, tEnd - tStart);
      const y = p.top + plotH * (0.5 - point[key] / (2 * yMax));
      if (!begun) { context.moveTo(x, y); begun = true; } else context.lineTo(x, y);
    }
    context.stroke();
  }
}

function drawAll() {
  if (!simulation) return;
  drawVoltage();
  drawCurrent();
  drawHistory();
}

function syncConditionalFields() {
  refs.frequencyField.hidden = refs.sourceMode.value !== "sine";
  refs.widthField.hidden = !["pulse", "gaussian"].includes(refs.sourceMode.value);
  refs.loadResistanceField.hidden = refs.loadMode.value !== "custom";
}

function syncQuickChoices() {
  document.querySelectorAll("[data-wave]").forEach((button) => {
    button.classList.toggle("selected", button.dataset.wave === refs.sourceMode.value);
  });
  document.querySelectorAll("[data-load]").forEach((button) => {
    button.classList.toggle("selected", button.dataset.load === refs.loadMode.value);
  });
}

function selectWave(mode) {
  refs.sourceMode.value = mode;
  refs.showEnvelope.checked = mode === "sine";
  syncConditionalFields();
  syncQuickChoices();
  rebuild();
}

function selectLoad(mode) {
  refs.loadMode.value = mode;
  syncConditionalFields();
  syncQuickChoices();
  rebuild();
}

refs.run.addEventListener("click", () => {
  if (!simulation) rebuild();
  running = !running;
  refs.run.textContent = running ? "❚❚ 一時停止" : "▶ 実行";
});
function advanceHalfStep() {
  running = false; refs.run.textContent = "▶ 実行";
  try {
    const wasVoltage = simulation.phase === "voltage";
    simulation.halfStep(sourceAt(simulation.time + simulation.dt / 2), Number(refs.sourceResistance.value), getLoadResistance());
    if (wasVoltage) recordHistory();
    updateMetrics(); drawAll(); showWarning();
  } catch (error) { showWarning(error.message); }
}

let halfHoldDelay;
let halfHoldRepeat;
let pointerGeneratedClick = false;

function stopHalfStepRepeat() {
  clearTimeout(halfHoldDelay);
  clearInterval(halfHoldRepeat);
  halfHoldDelay = undefined;
  halfHoldRepeat = undefined;
  refs.half.classList.remove("holding");
}

refs.half.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  pointerGeneratedClick = true;
  refs.half.classList.add("holding");
  refs.half.setPointerCapture?.(event.pointerId);
  advanceHalfStep();
  halfHoldDelay = setTimeout(() => {
    halfHoldRepeat = setInterval(advanceHalfStep, 75);
  }, 320);
});
refs.half.addEventListener("pointerup", () => {
  stopHalfStepRepeat();
  setTimeout(() => { pointerGeneratedClick = false; }, 0);
});
function endCancelledPointerRepeat() {
  stopHalfStepRepeat();
  setTimeout(() => { pointerGeneratedClick = false; }, 0);
}
refs.half.addEventListener("pointercancel", endCancelledPointerRepeat);
refs.half.addEventListener("lostpointercapture", endCancelledPointerRepeat);
refs.half.addEventListener("click", () => {
  if (pointerGeneratedClick) return;
  advanceHalfStep();
});
window.addEventListener("blur", stopHalfStepRepeat);
refs.reset.addEventListener("click", rebuild);
refs.speed.addEventListener("input", () => { refs.speedOutput.textContent = refs.speed.value; });

document.querySelectorAll("[data-wave]").forEach((button) => button.addEventListener("click", () => selectWave(button.dataset.wave)));
document.querySelectorAll("[data-load]").forEach((button) => button.addEventListener("click", () => selectLoad(button.dataset.load)));
const resetControls = [refs.sourceMode, refs.amplitude, refs.pulseWidth, refs.frequency, refs.sourceResistance, refs.loadMode,
  refs.loadResistance, refs.lineLength, refs.cells, refs.resistance, refs.inductance, refs.conductance, refs.capacitance, refs.courant];
for (const control of resetControls) control.addEventListener("change", () => {
  syncConditionalFields(); rebuild();
  syncQuickChoices();
});
for (const control of [refs.showTotal, refs.showForward, refs.showBackward, refs.showEnvelope,
  refs.showCurrentTotal, refs.showCurrentForward, refs.showCurrentBackward]) control.addEventListener("change", drawAll);
refs.envelopeHoldTime.addEventListener("change", () => {
  try {
    simulation.setEnvelopeHoldTime(Number(refs.envelopeHoldTime.value) * 1e-9);
    showWarning();
    drawAll();
  } catch (error) { showWarning(error.message); }
});
window.addEventListener("resize", drawAll);

function frame() {
  if (running && simulation) {
    try {
      const steps = Number(refs.speed.value);
      for (let k = 0; k < steps; k += 1) doFullStep();
      updateMetrics(); drawAll(); showWarning();
    } catch (error) {
      running = false; refs.run.textContent = "▶ 実行"; showWarning(error.message);
    }
  }
  requestAnimationFrame(frame);
}

syncConditionalFields();
syncQuickChoices();
rebuild();
requestAnimationFrame(frame);

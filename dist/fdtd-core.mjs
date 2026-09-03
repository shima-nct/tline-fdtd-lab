export class FDTDLine {
  constructor(config) {
    this.configure(config);
  }

  configure(config) {
    const n = Math.round(Number(config.cells));
    const length = Number(config.length);
    const R = Number(config.resistance);
    const L = Number(config.inductance);
    const G = Number(config.conductance);
    const C = Number(config.capacitance);
    const courant = Number(config.courant);
    const envelopeHoldTime = Number(config.envelopeHoldTime ?? Infinity);

    if (!Number.isFinite(n) || n < 20 || n > 600) throw new Error("セル数 N は20〜600にしてください。");
    if (!(length > 0)) throw new Error("線路長は正の値にしてください。");
    if (!(L > 0) || !(C > 0)) throw new Error("L′とC′は正の値にしてください。");
    if (!(R >= 0) || !(G >= 0)) throw new Error("R′とG′は0以上にしてください。");
    if (!(courant > 0 && courant < 1)) throw new Error("安定性のため Courant 数は0より大きく1未満にしてください。");
    if (!(envelopeHoldTime > 0)) throw new Error("包絡線ホールド時間は正の値にしてください。");

    Object.assign(this, { n, length, R, L, G, C, courant, envelopeHoldTime });
    this.dx = length / n;
    this.z0 = Math.sqrt(L / C);
    this.velocity = 1 / Math.sqrt(L * C);
    this.dt = courant * this.dx / this.velocity;
    this.delay = length / this.velocity;

    const iLoss = R * this.dt / (2 * L);
    const vLoss = G * this.dt / (2 * C);
    this.aI = (1 - iLoss) / (1 + iLoss);
    this.bI = (this.dt / (L * this.dx)) / (1 + iLoss);
    this.aV = (1 - vLoss) / (1 + vLoss);
    this.bV = (this.dt / (C * this.dx)) / (1 + vLoss);
    this.halfC = C * this.dx / 2;
    this.halfG = G * this.dx / 2;
    this.reset();
  }

  reset() {
    this.voltage = new Float64Array(this.n + 1);
    this.current = new Float64Array(this.n);
    this.envelope = new Float64Array(this.n + 1);
    this.envelopeQueues = Array.from({ length: this.n + 1 }, () => ({ times: [], values: [], head: 0 }));
    this.time = 0;
    this.steps = 0;
    this.phase = "current";
    this.captureEnvelope();
  }

  setEnvelopeHoldTime(seconds) {
    const value = Number(seconds);
    if (!(value > 0)) throw new Error("包絡線ホールド時間は正の値にしてください。");
    this.envelopeHoldTime = value;
    this.envelope.fill(0);
    this.envelopeQueues = Array.from({ length: this.n + 1 }, () => ({ times: [], values: [], head: 0 }));
    this.captureEnvelope();
  }

  captureEnvelope() {
    const cutoff = this.time - this.envelopeHoldTime;
    for (let j = 0; j <= this.n; j += 1) {
      const magnitude = Math.abs(this.voltage[j]);
      const queue = this.envelopeQueues[j];
      while (queue.values.length > queue.head && queue.values.at(-1) <= magnitude) {
        queue.values.pop();
        queue.times.pop();
      }
      queue.values.push(magnitude);
      queue.times.push(this.time);
      while (queue.head < queue.times.length && queue.times[queue.head] < cutoff) queue.head += 1;
      this.envelope[j] = queue.head < queue.values.length ? queue.values[queue.head] : magnitude;
      if (queue.head > 64 && queue.head * 2 > queue.values.length) {
        queue.values = queue.values.slice(queue.head);
        queue.times = queue.times.slice(queue.head);
        queue.head = 0;
      }
    }
  }

  updateCurrent() {
    const v = this.voltage;
    const i = this.current;
    for (let j = 0; j < this.n; j += 1) {
      i[j] = this.aI * i[j] - this.bI * (v[j + 1] - v[j]);
    }
    this.phase = "voltage";
  }

  updateVoltage(sourceVoltage, sourceResistance, loadResistance) {
    const oldV = this.voltage;
    const i = this.current;
    const nextV = new Float64Array(this.n + 1);

    for (let j = 1; j < this.n; j += 1) {
      nextV[j] = this.aV * oldV[j] - this.bV * (i[j] - i[j - 1]);
    }

    if (sourceResistance === 0) {
      nextV[0] = sourceVoltage;
    } else {
      const invRs = Number.isFinite(sourceResistance) ? 1 / sourceResistance : 0;
      const denom = this.halfC / this.dt + this.halfG / 2 + invRs / 2;
      nextV[0] = ((this.halfC / this.dt - this.halfG / 2 - invRs / 2) * oldV[0]
        + invRs * sourceVoltage - i[0]) / denom;
    }

    if (loadResistance === 0) {
      nextV[this.n] = 0;
    } else {
      const invRl = Number.isFinite(loadResistance) ? 1 / loadResistance : 0;
      const denom = this.halfC / this.dt + this.halfG / 2 + invRl / 2;
      nextV[this.n] = ((this.halfC / this.dt - this.halfG / 2 - invRl / 2) * oldV[this.n]
        + i[this.n - 1]) / denom;
    }

    this.voltage = nextV;
    this.time += this.dt;
    this.steps += 1;
    this.captureEnvelope();
    this.phase = "current";
  }

  halfStep(sourceVoltage, sourceResistance, loadResistance) {
    if (this.phase === "current") this.updateCurrent();
    else this.updateVoltage(sourceVoltage, sourceResistance, loadResistance);
  }

  fullStep(sourceVoltage, sourceResistance, loadResistance) {
    if (this.phase === "voltage") {
      this.updateVoltage(sourceVoltage, sourceResistance, loadResistance);
      return;
    }
    this.updateCurrent();
    this.updateVoltage(sourceVoltage, sourceResistance, loadResistance);
  }

  currentAtNodes() {
    const result = new Float64Array(this.n + 1);
    result[0] = this.current[0];
    result[this.n] = this.current[this.n - 1];
    for (let j = 1; j < this.n; j += 1) result[j] = (this.current[j - 1] + this.current[j]) / 2;
    return result;
  }

  waveComponents() {
    const nodeCurrent = this.currentAtNodes();
    const forward = new Float64Array(this.n + 1);
    const backward = new Float64Array(this.n + 1);
    for (let j = 0; j <= this.n; j += 1) {
      forward[j] = (this.voltage[j] + this.z0 * nodeCurrent[j]) / 2;
      backward[j] = (this.voltage[j] - this.z0 * nodeCurrent[j]) / 2;
    }
    return { forward, backward };
  }

  currentWaveComponents() {
    const forward = new Float64Array(this.n);
    const backward = new Float64Array(this.n);
    for (let j = 0; j < this.n; j += 1) {
      const halfCellVoltage = (this.voltage[j] + this.voltage[j + 1]) / 2;
      forward[j] = (this.current[j] + halfCellVoltage / this.z0) / 2;
      backward[j] = (this.current[j] - halfCellVoltage / this.z0) / 2;
    }
    return { forward, backward };
  }

  microElements() {
    return {
      resistance: this.R * this.dx,
      inductance: this.L * this.dx,
      conductance: this.G * this.dx,
      capacitance: this.C * this.dx,
    };
  }
}

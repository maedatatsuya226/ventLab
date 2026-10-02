// 呼吸ごとの最小二乗法（LSF）による呼吸力学推定（Hamilton 方式）
// Paw = Rinsp·F(吸気) + Rexp·F(呼気) + V/C + P0 を 1 呼吸分のサンプル全体に当てはめ、
// 吸気ホールドなしで Rinsp（吸気相の抵抗）・Cstat・AutoPEEP（P0 − 設定 PEEP）を求める。
// 自発呼吸（Pmus）があると式が成り立たなくなるため、推定値は実際の呼吸器と同様にずれる。

const N = 4;

export class LsfMonitor {
  constructor() { this.reset(); }

  reset() {
    this.cstat = null; this.rinsp = null; this.autoPeep = null; this.rcexp = null;
    this.startBreath();
  }

  startBreath() {
    // 正規方程式の累積（x = [F吸気, F呼気, V, 1]、y = Paw）
    this.S = new Float64Array(N * N); this.Sy = new Float64Array(N); this.n = 0; this.ni = 0;
    this.vmax = 0; this.p50 = null; this.p75 = null; this.pLast = null;
  }

  // sm: { paw [cmH₂O], flow [L/min], vol [mL], phase }
  push(sm) {
    if (sm.phase === 'exphold') return;
    const F = sm.flow / 60, V = sm.vol / 1000;
    const insp = sm.phase === 'insp' || sm.phase === 'pause';
    const x = [insp ? F : 0, insp ? 0 : F, V, 1];
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) this.S[i * N + j] += x[i] * x[j];
      this.Sy[i] += x[i] * sm.paw;
    }
    this.n++;
    if (insp && Math.abs(F) > 0.02) this.ni++;
    // RCexp：受動呼気では Flow = −(肺容量 − 弛緩位)/RC なので、呼気の流量−容量曲線の傾き ΔV/ΔFlow が RC。
    // VTE の 50% と 75% を吐き終えた 2 点の傾きを使う（air trapping で吐き切れなくても偏らない）
    if (sm.vol > this.vmax) this.vmax = sm.vol;
    if (!insp && this.vmax > 50 && F < -0.02) {
      const p = { V, F };
      if (!this.p50 && sm.vol <= this.vmax * 0.5) this.p50 = p;
      if (!this.p75 && sm.vol <= this.vmax * 0.25) this.p75 = p;
      this.pLast = p;
    }
  }

  rcFromSlope() {
    const a = this.p50;
    // 75% まで吐けない（重度の air trapping）ときは呼気の最後の点を使う
    const b = this.p75 || (this.pLast && a && a.V - this.pLast.V > this.vmax / 1000 * 0.1 ? this.pLast : null);
    if (!a || !b || b.F - a.F <= 1e-3) return null;
    return (a.V - b.V) / (b.F - a.F);
  }

  // 次の呼吸の開始時に、終わった呼吸の推定値を確定する
  endBreath(peepSet) {
    const sol = this.n > 30 && this.ni > 5 ? solve(this.S, this.Sy) : null;
    if (sol) {
      const [Ri, , E, P0] = sol;
      const C = E > 0 ? 1000 / E : null;     // mL/cmH₂O
      const ok = C != null && C >= 3 && C <= 250 && Ri >= 0 && Ri <= 150;
      this.cstat = ok ? C : null;
      this.rinsp = ok ? Ri : null;
      this.autoPeep = ok ? Math.max(0, P0 - peepSet) : null;
    }
    const rc = this.rcFromSlope();
    if (rc != null && rc > 0 && rc < 10) this.rcexp = rc;
    this.startBreath();
  }
}

// 連立一次方程式（部分ピボット付きガウス消去）。解けなければ null
function solve(A0, b0) {
  const A = Array.from({ length: N }, (_, r) => [...A0.slice(r * N, r * N + N), b0[r]]);
  for (let c = 0; c < N; c++) {
    let p = c;
    for (let r = c + 1; r < N; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-9) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = c + 1; r < N; r++) {
      const f = A[r][c] / A[c][c];
      for (let k = c; k <= N; k++) A[r][k] -= f * A[c][k];
    }
  }
  const x = new Array(N);
  for (let r = N - 1; r >= 0; r--) {
    let s = A[r][N];
    for (let k = r + 1; k < N; k++) s -= A[r][k] * x[k];
    x[r] = s / A[r][r];
  }
  return x.every(isFinite) ? x : null;
}

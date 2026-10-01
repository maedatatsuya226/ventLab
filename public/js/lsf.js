// 呼吸ごとの最小二乗法（LSF）による呼吸力学推定
// Paw = R·F + V/C + P0 を 1 呼吸分のサンプルに当てはめ、吸気ホールドなしで Cstat・Rinsp・AutoPEEP を求める。
// 自発呼吸（Pmus）があると式が成り立たなくなるため、推定値は実際の呼吸器と同様にずれる。

export class LsfMonitor {
  constructor() { this.reset(); }

  reset() {
    this.cstat = null; this.rinsp = null; this.autoPeep = null; this.rcexp = null;
    this.startBreath();
  }

  startBreath() {
    // 正規方程式の累積（x = [F, V, 1]、y = Paw）
    this.S = new Float64Array(9); this.Sy = new Float64Array(3); this.n = 0;
    this.vmax = 0; this.rc = null;
  }

  // sm: { paw [cmH₂O], flow [L/min], vol [mL], phase }
  push(sm) {
    if (sm.phase === 'exphold') return;
    const F = sm.flow / 60, V = sm.vol / 1000, x = [F, V, 1];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) this.S[i * 3 + j] += x[i] * x[j];
      this.Sy[i] += x[i] * sm.paw;
    }
    this.n++;
    // RCexp：呼気で VTE の 75% を吐き終えた時点の 残り容量 ÷ 呼気流量
    if (sm.vol > this.vmax) this.vmax = sm.vol;
    if (sm.phase === 'exp' && this.rc == null && this.vmax > 50 && sm.vol <= this.vmax * 0.25 && F < -0.02) {
      this.rc = V / -F;
    }
  }

  // 次の呼吸の開始時に、終わった呼吸の推定値を確定する
  endBreath(peepSet) {
    if (this.n > 30) {
      const sol = solve3(this.S, this.Sy);
      if (sol) {
        const [R, E, P0] = sol;
        const C = E > 0 ? 1000 / E : null;     // mL/cmH₂O
        if (C != null && C >= 3 && C <= 250 && R >= 0 && R <= 150) {
          this.cstat = C; this.rinsp = R;
          this.autoPeep = Math.max(0, P0 - peepSet);
        } else {
          this.cstat = this.rinsp = this.autoPeep = null;
        }
      }
    }
    if (this.rc != null && this.rc < 10) this.rcexp = this.rc;
    this.startBreath();
  }
}

// 3×3 連立一次方程式（クラメルの公式）
function solve3(A, b) {
  const d = det(A);
  if (!isFinite(d) || Math.abs(d) < 1e-9) return null;
  const out = [];
  for (let c = 0; c < 3; c++) {
    const M = A.slice();
    for (let r = 0; r < 3; r++) M[r * 3 + c] = b[r];
    out.push(det(M) / d);
  }
  return out;
}
function det(m) {
  return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
}

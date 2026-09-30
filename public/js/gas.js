// 血液ガス推定モデル
// CO2：肺胞換気量（VT − 死腔）× RR と CO2 産生量から PaCO2 を求める（肺胞換気式）。
// O2 ：肺胞気式で PAO2、シャント＋低 V/Q 領域の混合で動脈血酸素含量 → PaO2・SaO2。
// 変化は一次遅れで追従させる（学習用に時定数を実際より短縮している）。

import { pbw } from './engine.js';

const HB = 12;            // g/dL
const AV_DIFF = 5;        // 動静脈酸素含量較差 mL/dL
const TAU_CO2 = 60;       // s
const TAU_O2 = 15;        // s

export const sat = P => { P = Math.max(P, 0.1); return 1 / (23400 / (P * P * P + 150 * P) + 1); };
const o2ct = P => 1.34 * HB * sat(P) + 0.003 * P;
function invO2ct(C) {
  let lo = 0.5, hi = 700;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (o2ct(m) < C) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

export function defaultGas() {
  return {
    shunt: 0.05,     // 基礎シャント率
    recruit: 0.3,    // PEEP で減らせるシャントの割合（リクルート可能性）
    vdAlv: 0.10,     // 肺胞死腔率（VD/VT のうち解剖学的死腔以外）
    vq: 0.0,         // 低 V/Q 領域の血流割合
    hco3: 24,        // 代謝性 HCO3（腎代償・代謝性異常を含む）
  };
}

export class GasModel {
  constructor(sim) {
    this.sim = sim;
    this.p = defaultGas();
    this.paco2 = 40; this.pao2 = 95;
    this.palvMax = [];   // 直近の最大肺胞内圧（過膨張による死腔増加）
    this.snapped = false;
    this.samples = [];
  }

  setParams(patch) { Object.assign(this.p, patch); }
  snap() { this.snapped = false; this.palvMax = []; }

  // 直近 30 秒の肺胞換気量 [L/min]
  alveolarVent(kg, vdAlv) {
    const sim = this.sim, t = sim.t;
    const vdAnat = 1.8 * kg;   // mL（挿管下：上気道をバイパスし、回路・人工鼻の死腔を含む）
    const H = sim.history.filter(h => h.start >= t - 30);
    if (H.length < 2) return H.length && t - H[0].start < 10 ? 4 : 0;
    let va = 0;
    for (const h of H) {
      const vt = h.disc ? 0 : h.vte;
      va += Math.max(0, vt - vdAnat - vdAlv * vt);
    }
    // 定常状態では n 回分の呼吸間隔で割る。呼吸が途絶えると経過時間で割るので低下していく
    const span = H[H.length - 1].start - H[0].start;
    const denom = Math.max(span + span / (H.length - 1), t - H[0].start);
    return va / denom * 60 / 1000;
  }

  targets() {
    const sim = this.sim, s = sim.settings, e = sim.eff, ev = sim.events, g = this.p;
    const kg = pbw(sim.patient);
    const pmax = Math.max(0, ...this.palvMax.map(x => x.v));
    const over = Math.max(0, pmax - 28);
    const vdAlv = Math.min(0.7, g.vdAlv + 0.012 * over);
    const va = this.alveolarVent(kg, vdAlv);
    const vco2 = 3 * kg * (1 + e.effort / 40);   // mL/min
    const paco2 = Math.min(130, Math.max(15, va > 0.05 ? 0.863 * vco2 / va : 130));

    const fio2 = e.disconnect ? 0.21 : s.fio2 / 100;
    const pio2 = fio2 * 713;
    let pao2A = pio2 - this.paco2 / 0.8;
    pao2A = 40 + (Math.max(pao2A, 40) - 40) * Math.min(1, va / 1.5);   // 低換気・無呼吸で肺胞 O2 が枯渇

    const k = id => ev[id] ? Math.min(1, (sim.t - ev[id].at) / 20) : 0;
    let qs = g.shunt * (1 - g.recruit * (1 - Math.exp(-s.peep / 8)));
    qs += 0.15 * k('pneumothorax') + 0.20 * k('mainstem') + 0.06 * k('secretion') + (e.disconnect ? 0.08 : 0);
    qs = Math.min(0.7, Math.max(0.02, qs));
    const qv = Math.min(0.6, g.vq + 0.08 * k('bronchospasm') + 0.05 * k('secretion'));

    // シャント・低 V/Q・正常領域の混合（混合静脈血 PvO2 を反復で求める）
    const cc = o2ct(pao2A);
    let pvo2 = 40, ca = cc;
    for (let i = 0; i < 25; i++) {
      const clow = o2ct(pvo2 + (pao2A - pvo2) * 0.3);
      ca = ((1 - qs - qv) * cc + qv * clow - AV_DIFF * qs) / (1 - qs);
      pvo2 = invO2ct(Math.max(1, ca - AV_DIFF));
    }
    const pao2 = invO2ct(Math.max(1, ca));
    return { paco2, pao2, va, vdAlv, qs, qv, fio2, kg, vco2 };
  }

  update(dt) {
    const sim = this.sim;
    this.palvMax.push({ t: sim.t, v: sim.V / (sim.eff.c / 1000) });
    while (this.palvMax.length && (this.palvMax[0].t < sim.t - 8 || this.palvMax[0].t > sim.t)) this.palvMax.shift();
    if (!this.snapped && (sim.t < 10 || sim.history.length < 3)) return;   // 立ち上がり直後は履歴が少ない
    let T = this.targets();
    if (!this.snapped) {
      for (let i = 0; i < 5; i++) { this.paco2 = T.paco2; T = this.targets(); }
      this.pao2 = T.pao2; this.paco2 = T.paco2;
      this.snapped = true;
    } else {
      this.paco2 += (T.paco2 - this.paco2) * Math.min(1, dt / TAU_CO2);
      this.pao2 += (T.pao2 - this.pao2) * Math.min(1, dt / TAU_O2);
    }
    this.last = T;
  }

  values() {
    const sim = this.sim, g = this.p, T = this.last;
    const hco3 = g.hco3 + 0.1 * (this.paco2 - 40);
    const ph = 6.1 + Math.log10(hco3 / (0.03 * this.paco2));
    const spo2 = sat(this.pao2) * 100;
    const fio2 = T ? T.fio2 : sim.settings.fio2 / 100;
    const etco2 = sim.eff.disconnect || sim.t - sim.lastBreathStart > 15 ? 0
      : this.paco2 * (1 - (T ? T.vdAlv : g.vdAlv)) * 0.95;
    return {
      ph, paco2: this.paco2, pao2: this.pao2, hco3, spo2, etco2, pf: this.pao2 / fio2,
      be: 0.93 * (hco3 - 24.4 + 14.8 * (ph - 7.4)), ready: this.snapped,
    };
  }
}

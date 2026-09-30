// 人工呼吸器シミュレーター — 物理エンジン
// 単一コンパートメント肺モデル（運動方程式: Paw = R·F + V/C − Pmus）を 1 ms 刻みで積分する。
// 波形・非同調・auto-PEEP はすべて設定と患者パラメータから自然に生じる（作り込みの波形ではない）。
// 非同調の判定は、シミュレーターだけが知る「真の」患者吸気努力のタイミングと呼吸器の動作を照合して行う。

export const DT = 0.001;           // 積分刻み [s]
const SAMPLE_EVERY = 10;           // 100 Hz で UI にサンプルを渡す
const REFRACTORY = 0.15;           // 呼気開始後のトリガー不応期 [s]
const R_VALVE = 1.0;               // 呼気弁抵抗 [cmH2O/L/s]
const HOLD_TIME = 3.0;             // 吸気/呼気ホールド時間 [s]
const PS_MAX_TI = 3.0;             // PS 呼吸の最大吸気時間 [s]
const DISC_FLOW = 3.0;             // 回路外れ時に呼吸器が流す最大流量 [L/s]

export const MODES = {
  'VC-AC':    { name: 'VC-AC',    jp: '量規定 補助/調節換気', mand: 'VC', timed: true,  simv: false },
  'PC-AC':    { name: 'PC-AC',    jp: '圧規定 補助/調節換気', mand: 'PC', timed: true,  simv: false },
  'VC-SIMV':  { name: 'VC-SIMV',  jp: '量規定 同期式間欠的強制換気', mand: 'VC', timed: true,  simv: true },
  'PC-SIMV':  { name: 'PC-SIMV',  jp: '圧規定 同期式間欠的強制換気', mand: 'PC', timed: true,  simv: true },
  'CPAP-PSV': { name: 'CPAP/PSV', jp: '持続気道陽圧 / 圧支持換気', mand: null, timed: false, simv: false },
};
const BACKUP_MODE = { name: 'バックアップ', jp: '無呼吸バックアップ換気（PC）', mand: 'PC', timed: true, simv: false };

// 急変イベント：onset 秒かけて徐々に進行する
export const EVENTS = {
  secretion:    { jp: '痰貯留',       onset: 15 },
  bronchospasm: { jp: '気管支攣縮',   onset: 20 },
  pneumothorax: { jp: '気胸',         onset: 30 },
  mainstem:     { jp: '片肺挿管',     onset: 2 },
  kink:         { jp: 'チューブ屈曲・閉塞', onset: 1 },
  cuffleak:     { jp: 'カフリーク',   onset: 3 },
  disconnect:   { jp: '回路外れ',     onset: 0 },
  agitation:    { jp: '不穏・努力増大', onset: 5 },
};

export const ASYNC = {
  ineffective: { jp: 'トリガー不発',     short: '不発' },
  double:      { jp: 'ダブルトリガー',   short: '2連' },
  auto:        { jp: 'オートトリガー',   short: '自動' },
  premature:   { jp: '早すぎるサイクル', short: '早' },
  delayed:     { jp: '遅すぎるサイクル', short: '遅' },
  starvation:  { jp: '流量不足',         short: '流' },
};
export const ASYNC_KEYS = Object.keys(ASYNC);

export function defaultSettings() {
  return {
    mode: 'VC-AC',
    vt: 450,            // mL
    rr: 14,             // /min
    ti: 1.0,            // s（VC はポーズを含む）
    pause: 0.2,         // s
    flowPattern: 'square', // 'square' | 'decel'
    pinsp: 15,          // cmH2O（PEEP 上）
    rise: 0.1,          // s
    peep: 5,            // cmH2O
    ps: 8,              // cmH2O（PEEP 上）
    ets: 25,            // % of peak flow
    trigType: 'flow',   // 'flow' | 'pressure'
    ftrig: 2,           // L/min
    ptrig: 2,           // cmH2O
    fio2: 40,           // %
    apnea: 20,          // 無呼吸時間 s（CPAP/PSV のバックアップ換気開始）
    // アラーム
    pmax: 40,           // 気道内圧上限（超えたら吸気を打ち切る）
    plow: 8,            // 低気道内圧
    vteHigh: 1000, vteLow: 200,
    mveHigh: 15, mveLow: 3,
    rrHigh: 35,
  };
}

export function defaultPatient() {
  return {
    c: 50,          // コンプライアンス mL/cmH2O
    r: 10,          // 吸気抵抗 cmH2O/L/s（気管チューブ込み）
    rexp: 1.0,      // 呼気抵抗倍率（COPD の動的気道虚脱を表現）
    effort: 0,      // 吸気努力 Pmus 最大値 cmH2O（0 = 自発呼吸なし）
    prr: 16,        // 患者の呼吸数 /min
    pti: 1.0,       // 患者の神経吸気時間 s
    leak: 0,        // リーク量 L/min（Paw 20 cmH2O 時）
    height: 165,    // 身長 cm
    sex: 'M',       // 'M' | 'F'
  };
}

export function pbw(p) {
  return Math.max(20, (p.sex === 'F' ? 45.5 : 50) + 0.91 * (p.height - 152.4));
}

export class Simulator {
  constructor() {
    this.settings = defaultSettings();
    this.patient = defaultPatient();
    this.events = {};
    this.reset();
  }

  reset() {
    const C = this.patient.c / 1000;
    this.t = 0;
    this.V = this.settings.peep * C;   // 弛緩位からの肺容量 [L]
    this.phase = 'exp';                // 'insp' | 'pause' | 'exp' | 'exphold'
    this.phaseStart = 0;
    this.breath = null;
    this.lastBreath = null;
    this.breathCount = 0;
    this.lastBreathStart = 0;
    this.nextMandAt = 0.3;
    this.paw = this.settings.peep;
    this.flow = 0;                     // 肺に出入りする流量 [L/s]
    this.ventFlow = 0;                 // 呼吸器が表示する流量 [L/s]
    this.dispVol = 0;                  // 表示用換気量 [L]（吸気開始でリセット）
    this.pmus = 0;
    this.neuralInsp = false;
    this.pat = { cycleStart: 0.6, period: 60 / Math.max(this.patient.prr, 1), ti: this.patient.pti, amp: 0, id: 0 };
    this.ncycle = null;                // 現在の神経吸気サイクル（非同調判定用）
    this.samples = [];
    this.markers = [];
    this.asyncLog = [];                // { t, type }
    this.history = [];
    this.holdReq = { insp: false, exp: false };
    this.backup = false;
    this.backupTriggers = 0;
    this.stepCount = 0;
    this.acc = 0;
    this.eff = this.effPatient();
    this.meas = {
      pip: null, pplat: null, pmean: null, peep: null, vti: null, vte: null, mve: null,
      rr: null, rrSpont: null, ti: null, ie: null, cstat: null, raw: null, dp: null,
      peepTot: null, autoPeep: null, pplatAt: -1, peepTotAt: -1,
    };
  }

  get mode() { return this.backup ? BACKUP_MODE : MODES[this.settings.mode]; }

  setSettings(patch) {
    const prevMode = this.settings.mode;
    Object.assign(this.settings, patch);
    if (patch.mode && patch.mode !== prevMode) {
      this.backup = false;
      this.nextMandAt = this.t + 0.2;
    }
  }

  setPatient(patch) { Object.assign(this.patient, patch); }

  setEvent(id, on) {
    if (on && !this.events[id]) this.events[id] = { at: this.t };
    if (!on) delete this.events[id];
  }

  clearEvents() { this.events = {}; }

  requestHold(kind) {
    if (kind === 'insp' && !this.mode.mand) return false;
    this.holdReq[kind] = true;
    return true;
  }

  // 実時間 dt [s] 分だけ進める
  advance(dt) {
    this.acc += dt;
    let n = Math.floor(this.acc / DT);
    this.acc -= n * DT;
    if (n > 2000) n = 2000;
    for (let i = 0; i < n; i++) this.step();
  }

  // 急変イベントを反映した実効パラメータ
  effPatient() {
    const p = this.patient, ev = this.events, t = this.t;
    const k = id => {
      const e = ev[id];
      if (!e) return 0;
      const on = EVENTS[id].onset;
      return on <= 0 ? 1 : Math.min(1, (t - e.at) / on);
    };
    let c = p.c, r = p.r, rexp = p.rexp, effort = p.effort, prr = p.prr, leak = p.leak;
    let x;
    if ((x = k('secretion'))) { r *= 1 + 1.5 * x; rexp *= 1 + 0.3 * x; }
    if ((x = k('bronchospasm'))) { r *= 1 + 2.0 * x; rexp *= 1 + 0.8 * x; }
    if ((x = k('pneumothorax'))) { c *= 1 - 0.55 * x; }
    if ((x = k('mainstem'))) { c *= 1 - 0.45 * x; r *= 1 + 0.3 * x; }
    if ((x = k('kink'))) { r += 80 * x; }
    if ((x = k('cuffleak'))) { leak += 30 * x; }
    if ((x = k('agitation'))) { effort += 8 * x; prr *= 1 + 0.6 * x; }
    return { c, r, rexp, effort, prr, pti: p.pti, leak, disconnect: !!ev.disconnect };
  }

  // ---- 患者の吸気努力 ----
  updatePmus() {
    const p = this.eff;
    if (p.effort <= 0 || p.prr <= 0) {
      this.pmus = 0;
      if (this.neuralInsp) this.endNeuralInsp();
      this.neuralInsp = false;
      return;
    }
    let tau = this.t - this.pat.cycleStart;
    if (tau >= this.pat.period) {
      this.pat.cycleStart += this.pat.period;
      if (this.t - this.pat.cycleStart > this.pat.period) this.pat.cycleStart = this.t;
      const jitter = 1 + (Math.random() - 0.5) * 0.08;
      this.pat.period = (60 / p.prr) * jitter;
      this.pat.ti = Math.min(p.pti, this.pat.period * 0.66);
      this.pat.amp = p.effort * (1 + (Math.random() - 0.5) * 0.1);
      this.pat.id++;
      tau = this.t - this.pat.cycleStart;
    }
    const ti = this.pat.ti, A = this.pat.amp;
    let v = 0;
    if (tau < ti) v = A * 0.5 * (1 - Math.cos(Math.PI * tau / ti));
    else if (tau < ti * 1.5) v = A * 0.5 * (1 + Math.cos(Math.PI * (tau - ti) / (0.5 * ti)));
    const ni = tau < ti && A > 0;
    if (ni && !this.neuralInsp) {
      // 神経吸気の開始
      this.ncycle = {
        id: this.pat.id, start: this.t, end: this.pat.cycleStart + ti, amp: A,
        startedInExp: this.phase === 'exp', triggers: 0, ventBreath: false,
      };
    } else if (!ni && this.neuralInsp) {
      this.endNeuralInsp();
    }
    this.neuralInsp = ni;
    this.pmus = v;
  }

  endNeuralInsp() {
    const c = this.ncycle;
    if (!c) return;
    c.ended = true;
    // 呼気中に始まった有意な吸気努力で、何の呼吸も始まらなかった → トリガー不発
    if (c.amp >= 1 && c.startedInExp && c.triggers === 0 && !c.ventBreath && !this.eff.disconnect) {
      this.logAsync('ineffective');
    }
  }

  logAsync(type) {
    this.asyncLog.push({ t: this.t, type });
    if (this.asyncLog.length > 300) this.asyncLog.shift();
    this.markers.push({ t: this.t, async: type });
  }

  leakAt(P) {
    const k = this.eff.leak / 60 / Math.sqrt(20);
    return P > 0 ? k * Math.sqrt(P) : 0;
  }

  riseFn(tin) {
    const r = this.settings.rise;
    if (r <= 0.02) return 1;
    const f = Math.min(1, tin / r);
    return 1 - (1 - f) * (1 - f);
  }

  vcFlow(tin) {
    const b = this.breath;
    if (b.pattern === 'decel') return (2 * b.vt / b.tf) * Math.max(0, 1 - tin / b.tf);
    return b.vt / b.tf;
  }

  // ---- 1 ステップ ----
  step() {
    const s = this.settings;
    if (this.stepCount % 20 === 0) this.eff = this.effPatient();
    const p = this.eff;
    const C = Math.max(p.c, 1) / 1000;
    const Ri = Math.max(p.r, 0.5);
    const Re = Ri * Math.max(p.rexp, 0.2);
    const disc = p.disconnect;
    this.updatePmus();
    const palv = this.V / C - this.pmus;
    const tin = this.t - this.phaseStart;
    const b = this.breath;
    let paw, F, vflow;

    if (disc) {
      // 回路外れ：肺は大気に開放され、呼吸器の送気は外へ漏れる
      F = -palv / Ri;
      if (this.phase === 'insp') {
        vflow = b.ctrl === 'VC' ? this.vcFlow(tin) : DISC_FLOW;
        paw = 0.4 * vflow;
      } else { vflow = 0; paw = 0; }
    } else if (this.phase === 'insp') {
      if (b.ctrl === 'VC') {
        const q = this.vcFlow(tin);
        F = q - this.leakAt(this.paw);
        paw = Ri * F + palv;
        vflow = q;
        // 安全弁：上限圧をわずかに超えたところで圧を逃がす
        if (paw > s.pmax + 2) { paw = s.pmax + 2; F = (paw - palv) / Ri; vflow = F + this.leakAt(paw); }
        // 流量不足：定常流なのに圧波形が下に凹む（ピークからの落ち込み）
        if (tin > 0.05) { if (paw > b.pawRun) b.pawRun = paw; else if (b.pawRun - paw > b.dip) b.dip = b.pawRun - paw; }
      } else {
        const target = s.peep + b.pset * this.riseFn(tin);
        F = (target - palv) / Ri;
        paw = target;
        vflow = F + this.leakAt(paw);
      }
    } else if (this.phase === 'pause' || this.phase === 'exphold') {
      // 吸気弁・呼気弁とも閉鎖。リークがあれば肺から漏れる
      F = -this.leakAt(this.paw);
      paw = palv + Ri * F;
      vflow = 0;
    } else {
      if (palv >= s.peep) {
        F = (s.peep - palv) / (Re + R_VALVE);   // 負 = 呼出
        paw = s.peep - R_VALVE * F;
      } else {
        // 患者が吸おうとしている：フロートリガーはバイアスフローから、圧トリガーは閉じたデマンド弁に対して吸う
        const Rd = s.trigType === 'flow' ? 3 : 40;
        F = (s.peep - palv) / (Ri + Rd);
        paw = s.peep - Rd * F;
      }
      vflow = F + this.leakAt(paw);
    }

    // 積分
    this.V += F * DT;
    if (this.V < -0.3) this.V = -0.3;
    this.paw = paw; this.flow = F; this.ventFlow = vflow;
    this.dispVol += vflow * DT;
    if (b) {
      b.pmeanAcc += paw * DT;
      if (this.phase === 'insp' || this.phase === 'pause') {
        b.vti += vflow * DT;
        if (paw > b.pip) b.pip = paw;
      } else if (this.phase === 'exp') {
        if (F < 0 && !disc) b.vte += -F * DT;
        if (this.pmus < 0.2) b.quietFlow = vflow;   // 吸気努力のない呼気中の基線流量
      }
    }
    this.t += DT;

    // ---- 相の遷移 ----
    const tNow = this.t - this.phaseStart;
    if (this.phase === 'insp') {
      if (b.ctrl === 'VC' && tNow >= b.tf) this.endInsp(F);
      else if (b.ctrl === 'PC' && tNow >= b.ti) this.endInsp(F);
      else if (b.ctrl === 'PS') {
        if (vflow > b.peak) b.peak = vflow;
        if ((tNow > 0.1 && vflow < (s.ets / 100) * b.peak) || tNow >= PS_MAX_TI) this.endInsp(F);
      }
      if (this.phase === 'insp' && paw >= s.pmax) {
        b.pmaxHit = true;
        b.pauseDur = 0;
        this.endInsp(F);
      }
    } else if (this.phase === 'pause') {
      if (tNow >= b.pauseDur) {
        if (b.pauseDur >= 0.1 && !disc) b.pplat = paw;
        this.enterExp();
      }
    } else if (this.phase === 'exphold') {
      if (tNow >= HOLD_TIME) {
        this.meas.peepTot = paw;
        this.meas.autoPeep = Math.max(0, paw - s.peep);
        this.meas.peepTotAt = this.t;
        if (this.mode.timed) {
          this.startBreath('mand', false);
          this.nextMandAt = this.t + 60 / s.rr;
        } else {
          this.phase = 'exp';
          this.phaseStart = this.t - REFRACTORY;
        }
      }
    } else if (this.phase === 'exp') {
      this.checkExp(tNow, vflow, paw, disc);
    }

    // サンプル
    if (++this.stepCount % SAMPLE_EVERY === 0) {
      let seg = 0;
      if (this.phase === 'insp' || this.phase === 'pause') {
        const cb = this.breath;
        seg = cb.kind === 'spont' ? 3 : (cb.triggered ? 2 : 1);
      }
      this.samples.push({
        t: this.t, paw, flow: vflow * 60, vol: this.dispVol * 1000,
        pmus: this.pmus, V: this.V, palv: this.V / C, seg, phase: this.phase,
      });
    }
  }

  checkExp(tNow, vflow, paw, disc) {
    const s = this.settings;
    // 無呼吸 → バックアップ換気（CPAP/PSV）
    if (!this.backup && !MODES[s.mode].timed && this.t - this.lastBreathStart > s.apnea) {
      this.backup = true;
      this.backupTriggers = 0;
      this.nextMandAt = this.t;
    }
    const mode = this.mode;
    // 呼気ホールド要求
    if (this.holdReq.exp && !disc) {
      const due = mode.timed ? this.t >= this.nextMandAt : tNow > 1.5;
      if (due) {
        this.holdReq.exp = false;
        this.phase = 'exphold';
        this.phaseStart = this.t;
        return;
      }
    }
    // 患者トリガー（回路外れ中は呼吸器が回路外れを検知しトリガーを無効化）
    if (tNow > REFRACTORY && !disc) {
      const trig = s.trigType === 'flow' ? vflow * 60 > s.ftrig : paw < s.peep - s.ptrig;
      if (trig) { this.onTrigger(); return; }
    }
    // 時間トリガー（強制換気）
    if (mode.timed && this.t >= this.nextMandAt) {
      this.startBreath('mand', false);
      const T = 60 / s.rr;
      this.nextMandAt = mode.simv ? Math.max(this.nextMandAt + T, this.t + 0.5 * T) : this.t + T;
    }
  }

  onTrigger() {
    const s = this.settings, mode = this.mode;
    const T = 60 / s.rr;
    // 非同調判定：患者の吸気努力がないのにトリガー → オートトリガー
    const c = this.ncycle;
    const withEffort = this.neuralInsp && c && !c.ended;
    if (!withEffort && this.pmus < 0.5) this.logAsync('auto');
    else if (withEffort) {
      c.triggers++;
      if (c.triggers === 2) this.logAsync('double');
      this.stacked = c.triggers >= 2;
    }
    if (this.backup) {
      this.backupTriggers++;
      if (this.backupTriggers >= 2) { this.backup = false; this.startBreath('spont', true); return; }
      this.startBreath('mand', true);
      this.nextMandAt = this.t + T;
      return;
    }
    if (!mode.timed) { this.startBreath('spont', true); return; }
    if (!mode.simv) {
      this.startBreath('mand', true);
      this.nextMandAt = this.t + T;
      return;
    }
    // SIMV：強制換気予定時刻の直前（同期ウィンドウ）なら同期強制換気、それ以外は PS 呼吸
    const W = Math.min(5, 0.5 * T);
    if (this.t >= this.nextMandAt - W) {
      this.startBreath('mand', true);
      this.nextMandAt = this.nextMandAt + T;
    } else {
      this.startBreath('spont', true);
    }
  }

  startBreath(kind, triggered) {
    this.finalizeBreath();
    const s = this.settings, mode = this.mode;
    const T = 60 / s.rr;
    const b = {
      id: ++this.breathCount, start: this.t, kind, triggered, vti: 0, vte: 0, pip: -Infinity, pmeanAcc: 0,
      peak: 0, pplat: null, endFlow: 0, ti: 0, expStart: null, pauseDur: 0, pmaxHit: false,
      pawRun: -Infinity, dip: 0, backup: this.backup,
    };
    // この呼吸と重なる神経吸気サイクル
    const c = this.ncycle;
    if (c && !c.ended && this.neuralInsp) { c.ventBreath = true; b.ncycle = c; }
    b.stacked = triggered && !!this.stacked;
    this.stacked = false;
    if (kind === 'mand') {
      b.ctrl = mode.mand;
      const ti = Math.min(s.ti, Math.max(0.3, T - 0.3));
      if (b.ctrl === 'VC') {
        b.vt = s.vt / 1000;
        b.pauseDur = Math.min(s.pause, ti - 0.15);
        b.tf = Math.max(0.15, ti - b.pauseDur);
        b.pattern = s.flowPattern;
      } else {
        b.pset = s.pinsp;
        b.ti = ti;
      }
      if (this.holdReq.insp) { b.pauseDur = HOLD_TIME; b.hold = true; this.holdReq.insp = false; }
    } else {
      b.ctrl = 'PS';
      b.pset = s.ps;
    }
    this.breath = b;
    this.lastBreathStart = this.t;
    this.phase = 'insp';
    this.phaseStart = this.t;
    this.dispVol = 0;
    this.markers.push({ t: this.t, kind, triggered });
  }

  endInsp(F) {
    const b = this.breath;
    b.endFlow = F;
    // 非同調判定：サイクルのタイミング
    const c = b.ncycle;
    if (c && c.amp >= 1.5) {
      if (!c.ended && c.end - this.t > 0.2) this.logAsync('premature');
      else if (c.ended && b.triggered && !b.stacked && this.t - c.end > 0.35) this.logAsync('delayed');
    }
    if (b.ctrl === 'VC' && b.pattern === 'square' && b.dip >= 2) this.logAsync('starvation');
    if (b.pauseDur > 0) { this.phase = 'pause'; this.phaseStart = this.t; }
    else this.enterExp();
  }

  enterExp() {
    const b = this.breath;
    b.ti = this.t - b.start;
    b.expStart = this.t;
    this.phase = 'exp';
    this.phaseStart = this.t;
  }

  finalizeBreath() {
    const b = this.breath;
    if (!b) return;
    const total = this.t - b.start;
    const rec = {
      id: b.id, start: b.start, kind: b.kind, triggered: b.triggered, ctrl: b.ctrl,
      vti: b.vti * 1000, vte: b.vte * 1000, pip: b.pip, pmean: b.pmeanAcc / Math.max(total, 1e-3),
      ti: b.ti, te: b.expStart != null ? this.t - b.expStart : 0, pset: b.pset,
      pplat: b.pplat, endFlow: b.endFlow, peepEE: this.paw, hold: !!b.hold, pmaxHit: b.pmaxHit,
      endExpFlow: (b.quietFlow ?? this.ventFlow) * 60,   // 呼気終末の基線流量 L/min（リークがあると正、air trapping では負）
      square: b.ctrl === 'VC' && b.pattern === 'square', backup: b.backup, disc: this.eff.disconnect,
    };
    this.history.push(rec);
    if (this.history.length > 40) this.history.shift();
    this.lastBreath = rec;
    this.updateMeas(rec);
  }

  updateMeas(rec) {
    const m = this.meas, s = this.settings;
    const H = this.history;
    m.pip = rec.pip;
    m.vti = rec.vti;
    m.vte = rec.vte;
    m.ti = rec.ti;
    m.peep = rec.peepEE;
    m.pmean = rec.pmean;
    m.ie = rec.te > 0 ? rec.te / Math.max(rec.ti, 1e-3) : null;
    // 直近の呼吸（最大 8 回・60 秒以内）から RR と分時換気量
    const recent = [];
    for (let i = H.length - 1; i >= 0 && recent.length < 8; i--) {
      if (this.t - H[i].start > 60) break;
      recent.push(H[i]);
    }
    if (recent.length >= 2) {
      const span = this.t - recent[recent.length - 1].start;
      m.rr = recent.length / span * 60;
      m.mve = recent.reduce((a, r) => a + r.vte, 0) / span * 60 / 1000;
      const nsp = recent.filter(r => r.kind === 'spont').length;
      m.rrSpont = nsp / span * 60;
      // RSBI（浅速呼吸指数）= RR ÷ VT[L]：自発呼吸主体のときのみ
      const vtAvg = recent.reduce((a, r) => a + r.vte, 0) / recent.length;
      m.rsbi = nsp >= recent.length / 2 && vtAvg > 20 ? m.rr / (vtAvg / 1000) : null;
    }
    if (rec.pplat != null) {
      m.pplat = rec.pplat;
      m.pplatAt = this.t;
      const peepRef = (m.peepTot != null && this.t - m.peepTotAt < 120) ? m.peepTot : rec.peepEE;
      const dp = rec.pplat - peepRef;
      m.dp = rec.pplat - s.peep;
      m.cstat = dp > 0.5 ? rec.vti / dp : null;
      m.raw = rec.square && rec.endFlow > 0.05 ? (rec.pip - rec.pplat) / rec.endFlow : null;
    }
  }

  // 呼吸がない状態が続いたときの MVe 減衰（無呼吸・回路外れで数値が残り続けないように）
  liveMve() {
    const m = this.meas;
    if (m.mve == null) return null;
    const gap = this.t - this.lastBreathStart;
    return gap > 15 ? m.mve * Math.max(0, 1 - (gap - 15) / 45) : m.mve;
  }

  asyncStats(windowSec = 120) {
    const from = this.t - windowSec;
    const counts = Object.fromEntries(ASYNC_KEYS.map(k => [k, 0]));
    let n = 0;
    for (const e of this.asyncLog) if (e.t >= from) { counts[e.type]++; n++; }
    const breaths = this.history.filter(h => h.start >= from).length;
    const total = breaths + counts.ineffective;
    return { counts, n, index: total >= 5 ? n / total * 100 : null };
  }

  drain() {
    const s = this.samples; this.samples = [];
    const mk = this.markers; this.markers = [];
    return { samples: s, markers: mk };
  }
}

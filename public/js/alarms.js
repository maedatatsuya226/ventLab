// アラームシステム：呼吸ごとの判定と連続判定、ラッチ、消音、警報音

export const ALARM_DEFS = {
  disconnect: { jp: '回路外れ',                level: 'high',   hint: '回路の接続・リークを確認。患者の換気を確保（用手換気）' },
  pmax:       { jp: '気道内圧 上限',           level: 'high',   hint: '痰貯留・チューブ閉塞/屈曲・気管支攣縮・気胸・咳嗽/ファイティングを確認' },
  plow:       { jp: '気道内圧 下限',           level: 'high',   hint: '回路外れ・大量リーク・カフ漏れを確認' },
  apnea:      { jp: '無呼吸',                  level: 'high',   hint: '患者の呼吸努力・鎮静深度を確認。バックアップ換気作動' },
  mveLow:     { jp: '分時換気量 下限',         level: 'high',   hint: '換気量低下：リーク・回路外れ・閉塞・呼吸努力低下を確認' },
  mveHigh:    { jp: '分時換気量 上限',         level: 'medium', hint: '頻呼吸・オートトリガー・過換気を確認' },
  vteLow:     { jp: '呼気一回換気量 下限',     level: 'medium', hint: 'PC/PS ではコンプライアンス低下・抵抗上昇、または リークを疑う' },
  vteHigh:    { jp: '呼気一回換気量 上限',     level: 'medium', hint: '過大な吸気努力・設定過大を確認（肺保護）' },
  rrHigh:     { jp: '呼吸数 上限',             level: 'medium', hint: '呼吸促迫・オートトリガー・ダブルトリガーを確認' },
  leak:       { jp: 'リーク',                  level: 'low',    hint: 'VTi と VTe の差が大きい：カフ圧・回路接続を確認' },
  backup:     { jp: 'バックアップ換気中',      level: 'low',    hint: '無呼吸のため強制換気中。患者トリガーが 2 回続くと元のモードに戻る' },
};

const LEVEL_RANK = { high: 3, medium: 2, low: 1 };

export class AlarmSystem {
  constructor(sim) {
    this.sim = sim;
    this.state = {};         // id → { active, latched, since, count }
    this.lastBreathId = 0;
    this.silenceUntil = -1;  // performance.now() 基準
    this.sound = false;
    this.audio = null;
    this.nextBeep = 0;
  }

  set(id, on) {
    const st = this.state[id] || (this.state[id] = { active: false, latched: false, since: 0, count: 0 });
    if (on && !st.active) { st.since = this.sim.t; st.count++; }
    st.active = on;
    if (on) st.latched = true;
  }

  update() {
    const sim = this.sim, s = sim.settings, m = sim.meas;
    const b = sim.lastBreath;
    // 呼吸ごとの判定
    if (b && b.id !== this.lastBreathId) {
      this.lastBreathId = b.id;
      this.set('pmax', b.pmaxHit || b.pip >= s.pmax);
      const pressured = b.ctrl !== 'PS' || (b.pset ?? 0) > 0;
      this.set('plow', pressured && b.pip < s.plow);
      this.set('vteLow', b.vte < s.vteLow);
      this.set('vteHigh', b.vte > s.vteHigh);
      // リーク：呼気終末の基線流量が正（呼吸器が漏れを補っている）かつ VTi と VTe の差が大きい状態が 3 呼吸続く
      // （air trapping では呼気終末流量が負なので区別できる）
      const leaky = b.vti > 100 && (b.vti - b.vte) / b.vti > 0.10 && b.endExpFlow > 2 && !b.disc;
      this.leakRun = leaky ? (this.leakRun || 0) + 1 : 0;
      this.set('leak', this.leakRun >= 3);
    }
    // 連続判定
    const mve = sim.liveMve();
    if (mve != null) {
      this.set('mveLow', mve < s.mveLow);
      this.set('mveHigh', mve > s.mveHigh);
    }
    if (m.rr != null) this.set('rrHigh', m.rr > s.rrHigh);
    this.set('apnea', sim.t - sim.lastBreathStart > s.apnea);
    this.set('disconnect', sim.eff.disconnect && sim.t - (sim.events.disconnect?.at ?? sim.t) > 1.5);
    this.set('backup', sim.backup);
    this.beep();
  }

  list() {
    return Object.entries(this.state)
      .filter(([, st]) => st.active || st.latched)
      .map(([id, st]) => ({ id, ...ALARM_DEFS[id], active: st.active, since: st.since }))
      .sort((a, b) => (b.active - a.active) || (LEVEL_RANK[b.level] - LEVEL_RANK[a.level]));
  }

  top() {
    const act = this.list().filter(a => a.active);
    return act.length ? act[0].level : null;
  }

  reset() {
    for (const st of Object.values(this.state)) if (!st.active) st.latched = false;
  }

  silence(sec = 120) { this.silenceUntil = performance.now() + sec * 1000; }
  get silenced() { return performance.now() < this.silenceUntil; }
  silenceLeft() { return Math.max(0, Math.ceil((this.silenceUntil - performance.now()) / 1000)); }

  setSound(on) {
    this.sound = on;
    if (on && !this.audio) {
      try { this.audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.audio = null; }
    }
    if (on && this.audio?.state === 'suspended') this.audio.resume();
  }

  beep() {
    if (!this.sound || !this.audio || this.silenced) return;
    const lv = this.top();
    if (!lv || lv === 'low') return;
    const now = performance.now();
    if (now < this.nextBeep) return;
    const high = lv === 'high';
    this.nextBeep = now + (high ? 2500 : 6000);
    const ctx = this.audio, t0 = ctx.currentTime;
    const n = high ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = high ? 880 : 660;
      g.gain.setValueAtTime(0, t0 + i * 0.22);
      g.gain.linearRampToValueAtTime(0.15, t0 + i * 0.22 + 0.02);
      g.gain.linearRampToValueAtTime(0, t0 + i * 0.22 + 0.16);
      o.connect(g).connect(ctx.destination);
      o.start(t0 + i * 0.22);
      o.stop(t0 + i * 0.22 + 0.18);
    }
  }
}

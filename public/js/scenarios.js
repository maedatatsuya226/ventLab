// シナリオ（課題）と実行・採点・学習記録

import { pbw } from './engine.js';

const fresh = (sim, at, sec) => at >= 0 && sim.t - at < sec;
const f0 = v => v == null || !isFinite(v) ? '--' : v.toFixed(0);
const f1 = v => v == null || !isFinite(v) ? '--' : v.toFixed(1);
const f2 = v => v == null || !isFinite(v) ? '--' : v.toFixed(2);

// ---- 目標（goal）の部品 ----
const G = {
  vtKg: (lo, hi) => ({
    label: `VTe ${lo}–${hi} mL/kg PBW`,
    check: c => { const v = c.m.vte / c.kg; return { ok: v >= lo && v <= hi, value: `${f1(v)} mL/kg` }; },
  }),
  pplat: max => ({
    label: `Pplat ≤ ${max} cmH₂O（直近 60 秒以内に測定）`,
    check: c => {
      if (!fresh(c.sim, c.m.pplatAt, 60)) return { ok: false, value: '未測定（吸気ポーズ or 吸気ホールド）' };
      return { ok: c.m.pplat <= max, value: `${f0(c.m.pplat)} cmH₂O` };
    },
  }),
  dp: max => ({
    label: `ΔP（Pplat − PEEP）≤ ${max} cmH₂O`,
    check: c => {
      if (!fresh(c.sim, c.m.pplatAt, 60)) return { ok: false, value: '未測定' };
      return { ok: c.m.dp <= max, value: `${f0(c.m.dp)} cmH₂O` };
    },
  }),
  peepMin: min => ({ label: `PEEP ≥ ${min} cmH₂O`, check: c => ({ ok: c.s.peep >= min, value: `${c.s.peep}` }) }),
  fio2Max: max => ({ label: `FiO₂ ≤ ${max}%`, check: c => ({ ok: c.s.fio2 <= max, value: `${c.s.fio2}%` }) }),
  spo2: (lo, hi) => ({
    label: hi ? `SpO₂ ${lo}–${hi}%` : `SpO₂ ≥ ${lo}%`,
    check: c => { const v = Math.round(c.g.spo2); return { ok: v >= lo && (!hi || v <= hi), value: `${v}%` }; },
  }),
  ph: lo => ({ label: `pH ≥ ${lo}`, check: c => ({ ok: c.g.ph >= lo, value: f2(c.g.ph) }) }),
  autoPeep: max => ({
    label: `auto-PEEP ≤ ${max} cmH₂O（直近 90 秒以内に呼気ホールドで測定）`,
    check: c => {
      if (!fresh(c.sim, c.m.peepTotAt, 90)) return { ok: false, value: '未測定（呼気ホールド）' };
      return { ok: c.m.autoPeep <= max, value: `${f1(c.m.autoPeep)} cmH₂O` };
    },
  }),
  ai: max => ({
    label: `非同調指数 < ${max}%（直近 60 秒）`,
    check: c => {
      const st = c.sim.asyncStats(60);
      if (st.index == null) return { ok: false, value: 'データ不足' };
      return { ok: st.index < max, value: `${f0(st.index)}%` };
    },
  }),
  noAsync: (type, jp) => ({
    label: `${jp} 0 件（直近 60 秒）`,
    check: c => { const n = c.sim.asyncStats(60).counts[type]; return { ok: n === 0 && c.sim.t > 20, value: `${n} 件` }; },
  }),
  rrRange: (lo, hi) => ({
    label: `総呼吸数 ${lo}–${hi} /min`,
    check: c => ({ ok: c.m.rr >= lo && c.m.rr <= hi, value: `${f0(c.m.rr)} /min` }),
  }),
  pipMax: max => ({ label: `PIP < ${max} cmH₂O`, check: c => ({ ok: c.m.pip < max, value: `${f0(c.m.pip)} cmH₂O` }) }),
};

const GAS = {
  normal: { shunt: 0.05, recruit: 0.3, vdAlv: 0.10, vq: 0.0, hco3: 24 },
  ardsMod: { shunt: 0.35, recruit: 0.6, vdAlv: 0.25, vq: 0.05, hco3: 24 },
  ardsSev: { shunt: 0.70, recruit: 0.7, vdAlv: 0.30, vq: 0.05, hco3: 23 },
  copd: { shunt: 0.05, recruit: 0.2, vdAlv: 0.20, vq: 0.25, hco3: 31 },
};
export { GAS };

export const SCENARIOS = [
  {
    id: 'ards-init', title: 'ARDS：肺保護換気への調整', cat: '設定', level: '基礎',
    brief: '58 歳男性、身長 170 cm。重症肺炎による ARDS で挿管直後。当直医が VC-AC・VT 600 mL・PEEP 5・FiO₂ 60% で開始した。肺保護換気の考え方に沿って設定を見直してほしい。',
    setup: {
      settings: { mode: 'VC-AC', vt: 600, rr: 14, ti: 1.0, pause: 0.3, flowPattern: 'square', peep: 5, fio2: 60 },
      patient: { height: 170, sex: 'M', c: 28, r: 12, rexp: 1, effort: 0, prr: 20, pti: 0.8, leak: 0 },
      gas: GAS.ardsMod,
    },
    tasks: [
      { type: 'quiz', q: 'この患者の予測体重（PBW）に基づく「VT 6 mL/kg」はおよそいくつか？',
        options: ['約 300 mL', '約 400 mL', '約 500 mL', '約 600 mL'], answer: 1,
        explain: 'PBW（男性）= 50 + 0.91 ×（170 − 152.4）≈ 66 kg。6 mL/kg ≈ 400 mL。実体重ではなく PBW で計算する。' },
      { type: 'goal', ...G.vtKg(4, 8) },
      { type: 'goal', ...G.pplat(30) },
      { type: 'goal', ...G.dp(15) },
      { type: 'goal', ...G.peepMin(8) },
      { type: 'goal', ...G.spo2(88, 95) },
      { type: 'goal', ...G.ph(7.25) },
    ],
    hint: 'VT を下げると Pplat・ΔP は下がるが PaCO₂ が上がる → RR を増やして分時換気量を保つ。酸素化は PEEP を上げて FiO₂ を下げる方向で。SpO₂ は高すぎても目標外（88–95%）。',
    debrief: '肺保護換気の要点：VT 4–8 mL/kg PBW（目標 6）、Pplat ≤ 30、ΔP ≤ 15 を目安にし、PaCO₂ 上昇は pH ≥ 7.25 程度まで許容（permissive hypercapnia）。中等症以上では高めの PEEP を考慮し、FiO₂ は SpO₂ 88–95% を目標に下げる。このモデルの C は 28 mL/cmH₂O、PEEP で減らせるシャントが大きい（リクルート可能）設定だった。',
  },
  {
    id: 'copd-autopeep', title: 'COPD：auto-PEEP を減らす', cat: '設定', level: '基礎',
    brief: '72 歳男性、COPD 急性増悪で挿管。挿管後から血圧低下傾向で、PIP も高い。鎮静下で自発呼吸はない。波形を確認し、問題を解決してほしい。',
    setup: {
      settings: { mode: 'VC-AC', vt: 550, rr: 22, ti: 1.3, pause: 0.2, flowPattern: 'square', peep: 5, fio2: 40 },
      patient: { height: 165, sex: 'M', c: 65, r: 20, rexp: 2.5, effort: 0, prr: 16, pti: 1.0, leak: 0 },
      gas: GAS.copd,
    },
    tasks: [
      { type: 'quiz', q: '流量波形から最も考えられる問題は？',
        options: ['auto-PEEP（動的肺過膨張）', '気胸', '流量不足', 'オートトリガー'], answer: 0,
        explain: '呼気流量がゼロに戻る前に次の吸気が始まっている（呼気が終わりきらない）。呼気ホールドで総 PEEP を測ると auto-PEEP が分かる。胸腔内圧上昇による静脈還流低下で血圧が下がる。' },
      { type: 'goal', ...G.autoPeep(3) },
      { type: 'goal', ...G.ph(7.25) },
      { type: 'goal', ...G.pipMax(35) },
    ],
    hint: '呼気時間を延ばす：RR を下げる、Ti を短くする（ポーズを減らす）、VT を少し下げる。高二酸化炭素血症はある程度許容する（この患者は慢性的に HCO₃⁻ が高い）。',
    debrief: 'auto-PEEP 対策は「呼気時間を確保」すること。RR↓・Ti↓（吸気流量↑）・VT↓ が有効。気管支拡張薬などで抵抗を下げることも重要。PaCO₂ は慢性の代償（HCO₃⁻ 31）があるため pH を目安に許容する。',
  },
  {
    id: 'pip-rise', title: '気道内圧上昇の鑑別', cat: '急変', level: '基礎',
    brief: '術後 1 日目、人工呼吸管理中。しばらくすると看護師から「気道内圧が上がってきました」と連絡があった。波形と実測値（PIP と Pplat）を観察し、原因を判断してほしい。※ 20 秒後から変化が始まる。',
    setup: {
      settings: { mode: 'VC-AC', vt: 450, rr: 14, ti: 1.0, pause: 0.3, flowPattern: 'square', peep: 5, fio2: 40 },
      patient: { height: 165, sex: 'M', c: 50, r: 10, rexp: 1, effort: 0, prr: 16, pti: 1.0, leak: 0 },
      gas: GAS.normal,
    },
    variants: [
      { key: 'resist', timeline: [{ at: 20, event: 'secretion' }], label: '痰貯留（気道抵抗の上昇）' },
      { key: 'compl', timeline: [{ at: 20, event: 'pneumothorax' }], label: '気胸（コンプライアンスの低下）' },
    ],
    tasks: [
      { type: 'quiz', q: 'PIP 上昇の機序は？',
        options: ['気道抵抗の上昇（PIP − Pplat の差が拡大、Pplat は不変）', 'コンプライアンスの低下（PIP と Pplat がともに上昇）', 'リークの増加', '患者の吸気努力の増加'],
        answer: v => v.key === 'resist' ? 0 : 1,
        explain: v => v.key === 'resist'
          ? '今回は痰貯留。PIP は上がったが Pplat はほぼ不変 → 抵抗成分（R × 流量）の増大。'
          : '今回は気胸。PIP と Pplat がともに上がり、差は変わらない → 弾性成分（VT/C）の増大。' },
      { type: 'quiz', q: 'まず行う対応として最も適切なものは？',
        options: ['気管吸引・チューブ屈曲の確認', '呼吸音・胸郭の左右差の確認、胸部画像（脱気の準備）', '回路の再接続', 'VT を減らして様子を見る'],
        answer: v => v.key === 'resist' ? 0 : 1,
        explain: v => v.key === 'resist'
          ? '抵抗上昇なら痰・チューブ屈曲・バイトブロック・気管支攣縮を考え、吸引や閉塞解除を行う。'
          : 'コンプライアンス低下なら気胸・片肺挿管・無気肺・腹腔内圧上昇などを考える。緊張性気胸は循環虚脱を招くので迅速に評価・脱気する。' },
    ],
    hint: '吸気ポーズ中の圧（Pplat）は肺胞内圧を反映する。PIP − Pplat の差は抵抗成分、Pplat − PEEP の差は弾性成分。',
    debrief: v => `正解の原因は「${v.label}」。PIP だけでなく Pplat（吸気ポーズ／吸気ホールド）を見ることで、抵抗の問題かコンプライアンスの問題かを切り分けられる。`,
  },
  {
    id: 'async-double', title: '非同調：ダブルトリガー', cat: '非同調', level: '応用',
    brief: '肺炎で挿管 3 日目。鎮静を浅くしたところ呼吸数が増え、VTe が設定の約 2 倍になる呼吸が混じるようになった。「Pmus」ボタンで患者の吸気努力を表示して観察し、対処してほしい。',
    setup: {
      settings: { mode: 'VC-AC', vt: 420, rr: 14, ti: 0.6, pause: 0, flowPattern: 'square', peep: 5, fio2: 40 },
      patient: { height: 165, sex: 'M', c: 45, r: 10, rexp: 1, effort: 10, prr: 22, pti: 1.1, leak: 0 },
      gas: GAS.normal,
    },
    tasks: [
      { type: 'quiz', q: '見られている非同調は？',
        options: ['ダブルトリガー', 'トリガー不発', 'オートトリガー', '遅すぎるサイクル'], answer: 0,
        explain: '患者の神経吸気時間（約 1.1 秒）に対して呼吸器の Ti が 0.6 秒と短く、呼吸器が呼気に移った後も患者が吸い続けて 2 回目がトリガーされる。2 回分が重なり VT が過大になる（ブレススタッキング）。' },
      { type: 'goal', ...G.noAsync('double', 'ダブルトリガー') },
      { type: 'goal', ...G.noAsync('premature', '早すぎるサイクル') },
      { type: 'goal', ...G.vtKg(4, 8) },
    ],
    hint: '呼吸器の吸気時間を患者の吸気時間に合わせる（Ti 延長）。流量不足もあれば流量を増やす。VT を守るなら VC のまま Ti を調整するのが確実。',
    debrief: 'ダブルトリガーは「呼吸器の Ti ＜ 患者の神経吸気時間」で起こる。Ti 延長、流量や VT の見直し、PC/PS への変更、鎮静・鎮痛の評価を行う。PSV に変えると同調は良くなるが、強い吸気努力で VT が過大になることがある（肺保護の観点で注意）。',
  },
  {
    id: 'async-ineffective', title: '非同調：トリガー不発', cat: '非同調', level: '応用',
    brief: '68 歳男性、COPD。PSV で離脱中。患者は 1 分間に 24 回ほど吸おうとしているが、呼吸器の呼吸数は少ない。「Pmus」表示を使って観察し、同調を改善してほしい。',
    setup: {
      settings: { mode: 'CPAP-PSV', ps: 18, ets: 25, peep: 5, rise: 0.1, fio2: 35, trigType: 'flow', ftrig: 2 },
      patient: { height: 165, sex: 'M', c: 65, r: 20, rexp: 2.5, effort: 8, prr: 24, pti: 0.9, leak: 0 },
      gas: GAS.copd,
    },
    tasks: [
      { type: 'quiz', q: '見られている非同調は？',
        options: ['トリガー不発', 'ダブルトリガー', '流量不足', '早すぎるサイクル'], answer: 0,
        explain: '高い PS で VT が大きく、しかも ETS 25% では吸気が長引く。呼気が終わらないうちに次の努力が来るため、auto-PEEP を超えられずトリガーできない（呼気流量・圧に小さなくぼみ）。' },
      { type: 'goal', ...G.ai(10) },
      { type: 'goal', ...G.rrRange(18, 30) },
    ],
    hint: '① PS を下げて VT と吸気時間を減らす ② ETS を上げて早めに呼気へ ③ 外因性 PEEP を少し上げて auto-PEEP とのトリガー閾値差を縮める。',
    debrief: 'トリガー不発は COPD の動的過膨張で最も多い非同調。過剰な補助（高 PS・低 ETS）が原因になることが多い。PS↓、ETS↑（COPD では 40–60%）、外因性 PEEP を auto-PEEP の 70–80% 程度まで上げる、が基本。',
  },
  {
    id: 'async-auto', title: '非同調：オートトリガー', cat: '非同調', level: '応用',
    brief: '腹部術後、PSV で管理中。本人は落ち着いて 1 分間に 14 回ほど呼吸しているように見えるのに、呼吸器の呼吸数が非常に多い。カフ圧はやや低めとの申し送りあり。原因を考えて設定で対処してほしい。',
    setup: {
      settings: { mode: 'CPAP-PSV', ps: 10, ets: 25, peep: 8, rise: 0.1, fio2: 35, trigType: 'flow', ftrig: 2 },
      patient: { height: 160, sex: 'F', c: 50, r: 10, rexp: 1, effort: 5, prr: 14, pti: 1.0, leak: 10 },
      gas: GAS.normal,
    },
    tasks: [
      { type: 'quiz', q: '頻呼吸の原因として最も考えられるのは？',
        options: ['リークによるオートトリガー', '患者の呼吸促迫', 'ダブルトリガー', '無呼吸バックアップ換気'], answer: 0,
        explain: 'カフ周囲のリークで呼気中も回路から流量が失われ続け、呼吸器はそれを「患者が吸った」と判断してトリガーしてしまう。Pmus を表示すると、吸気努力がないのに換気されている呼吸が分かる。' },
      { type: 'goal', ...G.noAsync('auto', 'オートトリガー') },
      { type: 'goal', ...G.rrRange(8, 25) },
    ],
    hint: 'フロートリガーの感度を鈍くする（数値を上げる）か、圧トリガーに変更する。実臨床ではカフ圧調整・リーク補正機能も。',
    debrief: 'オートトリガーの原因：リーク、敏感すぎるトリガー、回路内の水、心拍動。まず原因（リーク）を除去し、トリガー感度を適正化する。感度を鈍くしすぎるとトリガー不発を招くので注意。',
  },
  {
    id: 'ards-oxy', title: '重症 ARDS：酸素化の改善', cat: '設定', level: '応用',
    brief: '45 歳女性、身長 160 cm。重症 ARDS。FiO₂ 100% でも SpO₂ が低い。Pplat を守りながら酸素化を改善し、FiO₂ を下げてほしい。',
    setup: {
      settings: { mode: 'VC-AC', vt: 320, rr: 26, ti: 0.8, pause: 0.2, flowPattern: 'square', peep: 6, fio2: 100 },
      patient: { height: 160, sex: 'F', c: 16, r: 14, rexp: 1, effort: 0, prr: 24, pti: 0.7, leak: 0 },
      gas: GAS.ardsSev,
    },
    tasks: [
      { type: 'quiz', q: 'FiO₂ を上げても酸素化が改善しにくい主な機序は？',
        options: ['シャント（換気されない肺胞への血流）', '拡散障害', '低換気', '死腔換気'], answer: 0,
        explain: 'ARDS では虚脱・浸潤した肺胞に血流が流れ続ける（シャント）。シャント血は吸入酸素に触れないため FiO₂ の効果が小さい。PEEP で虚脱肺胞を開通（リクルート）させることがシャント減少に有効。' },
      { type: 'goal', ...G.spo2(88) },
      { type: 'goal', ...G.fio2Max(80) },
      { type: 'goal', ...G.pplat(30) },
      { type: 'goal', ...G.ph(7.20) },
    ],
    hint: 'PEEP を上げてシャントを減らす。ただし VC では PEEP を上げると Pplat も上がるので、VT を 4–6 mL/kg まで下げて Pplat ≤ 30 を守る。',
    debrief: '重症 ARDS では PEEP によるリクルートメントで酸素化を改善し、FiO₂ を下げる。一方 Pplat・ΔP 上昇とのトレードオフがあり、VT をさらに下げる必要がある。実臨床では腹臥位療法・筋弛緩・ECMO も検討対象。※ 本モデルでは PEEP によるコンプライアンス改善は再現していない。',
  },
  {
    id: 'sbt', title: 'SBT：抜管できるか', cat: '離脱', level: '基礎',
    brief: '人工呼吸 5 日目。原疾患は改善傾向。PS 5 / PEEP 5 で自発呼吸トライアル（SBT）を開始した。1〜2 分観察して（早送り可）、SBT の成否を判断してほしい。',
    setup: {
      settings: { mode: 'CPAP-PSV', ps: 5, ets: 25, peep: 5, rise: 0.1, fio2: 35, trigType: 'flow', ftrig: 2 },
      gas: GAS.normal,
    },
    variants: [
      { key: 'pass', label: '合格', patient: { height: 165, sex: 'M', c: 55, r: 8, rexp: 1, effort: 6, prr: 15, pti: 1.0, leak: 0 } },
      { key: 'fail', label: '不合格', patient: { height: 165, sex: 'M', c: 30, r: 12, rexp: 1, effort: 7, prr: 34, pti: 0.6, leak: 0 },
        gas: { ...GAS.normal, vdAlv: 0.2 } },
    ],
    tasks: [
      { type: 'quiz', q: 'SBT の評価は？（RSBI = 呼吸数 ÷ VT[L] を参考に）',
        options: ['合格：抜管を検討してよい', '不合格：浅速呼吸（RSBI > 105）で継続困難'],
        answer: v => v.key === 'pass' ? 0 : 1,
        explain: v => v.key === 'pass'
          ? '呼吸数・VT が安定し RSBI は 105 未満。ガス交換も保たれている。抜管の可否は気道防御（咳・分泌物・意識）も合わせて判断する。'
          : '呼吸数が多く VT が小さい浅速呼吸で RSBI は 105 を超える。呼吸仕事量に対して呼吸筋が追いついていない。補助を戻して原因（負荷の増大・筋力低下）を評価する。' },
    ],
    hint: '実測値の「RSBI」と「RR」「VTe」、血液ガスを確認する。RSBI < 105 が一般的な目安。',
    debrief: v => `このケースは「${v.label}」。SBT では RSBI だけでなく、呼吸数（>35 は危険）、SpO₂、心拍・血圧、呼吸補助筋の使用、意識などを総合して判断する。`,
  },
];

// ---- 学習記録（端末内保存） ----
const KEY = 'vs-records';
export function loadRecords() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
}
function saveRecords(r) { try { localStorage.setItem(KEY, JSON.stringify(r)); } catch (e) {} }
export function resetRecords() { try { localStorage.removeItem(KEY); } catch (e) {} }

// ---- 実行 ----
export class ScenarioRunner {
  constructor({ sim, gas, onStart, onEnd, fastForward, host, term = s => s }) {
    Object.assign(this, { sim, gas, onStart, onEnd, fastForward, host, term });
    this.cur = null;
  }

  get active() { return !!this.cur; }

  start(id) {
    const sc = SCENARIOS.find(s => s.id === id);
    const variant = sc.variants ? sc.variants[Math.floor(Math.random() * sc.variants.length)] : null;
    const answers = sc.tasks.map(() => null);
    this.cur = { sc, variant, answers, done: false, result: null, hintShown: false, fired: new Set() };
    const setup = sc.setup;
    this.onStart({
      settings: setup.settings,
      patient: { ...(setup.patient || {}), ...(variant?.patient || {}) },
      gas: { ...(setup.gas || {}), ...(variant?.gas || {}) },
    });
    this.render();
  }

  // 時間経過で起こるイベント
  tick() {
    const c = this.cur;
    if (!c || c.done) return;
    for (const ev of c.variant?.timeline || c.sc.timeline || []) {
      const k = ev.at + ':' + ev.event;
      if (!c.fired.has(k) && this.sim.t >= ev.at) { c.fired.add(k); this.sim.setEvent(ev.event, true); }
    }
    this.updateGoals();
  }

  ctx() {
    const sim = this.sim;
    return { sim, m: sim.meas, s: sim.settings, g: this.gas.values(), kg: pbw(sim.patient) };
  }

  resolve(v) { return this.term(typeof v === 'function' ? v(this.cur.variant) : v); }

  answer(ti, oi) {
    const c = this.cur;
    if (c.answers[ti] != null || c.done) return;
    c.answers[ti] = oi;
    this.render();
  }

  evaluate() {
    const c = this.cur;
    const ctx = this.ctx();
    let got = 0;
    const detail = c.sc.tasks.map((t, i) => {
      if (t.type === 'quiz') {
        const ok = c.answers[i] === this.resolve(t.answer);
        if (ok) got++;
        return { ok, label: t.q };
      }
      const r = t.check(ctx);
      if (r.ok) got++;
      return { ok: r.ok, label: t.label, value: r.value };
    });
    const score = Math.round(got / c.sc.tasks.length * 100);
    c.done = true;
    c.result = { score, detail };
    const rec = loadRecords();
    const prev = rec[c.sc.id] || { best: 0, attempts: 0 };
    rec[c.sc.id] = { best: Math.max(prev.best, score), attempts: prev.attempts + 1, last: score, at: Date.now() };
    saveRecords(rec);
    this.render();
  }

  end() {
    this.cur = null;
    this.host.hidden = true;
    this.host.innerHTML = '';
    this.onEnd();
  }

  updateGoals() {
    const c = this.cur;
    if (!c || c.done) return;
    const ctx = this.ctx();
    c.sc.tasks.forEach((t, i) => {
      if (t.type !== 'goal') return;
      const el = this.host.querySelector(`[data-goal="${i}"]`);
      if (!el) return;
      const r = t.check(ctx);
      el.classList.toggle('ok', r.ok);
      const v = el.querySelector('.gv');
      if (v.textContent !== r.value) v.textContent = r.value;
    });
  }

  render() {
    const c = this.cur, sc = c.sc, h = this.host, T = this.term;
    h.hidden = false;
    const quizHtml = (t, i) => {
      const ans = c.answers[i];
      const correct = this.resolve(t.answer);
      const opts = t.options.map((o, oi) => {
        let cls = 'opt';
        if (ans != null) cls += oi === correct ? ' right' : (oi === ans ? ' wrong' : ' dim');
        return `<button class="${cls}" data-q="${i}" data-o="${oi}" ${ans != null ? 'disabled' : ''}>${T(o)}</button>`;
      }).join('');
      const exp = ans != null
        ? `<div class="explain ${ans === correct ? 'ok' : 'ng'}"><b>${ans === correct ? '正解' : '不正解'}</b> ${this.resolve(t.explain)}</div>` : '';
      return `<div class="task quiz"><div class="tq">Q. ${T(t.q)}</div><div class="opts">${opts}</div>${exp}</div>`;
    };
    const goals = sc.tasks.map((t, i) => t.type === 'goal'
      ? `<li data-goal="${i}"><span class="gi"></span><span class="gl">${T(t.label)}</span><span class="gv">--</span></li>` : '').join('');
    let result = '';
    if (c.done) {
      const r = c.result;
      result = `<div class="result">
        <div class="score"><b>${r.score}</b> 点</div>
        <ul class="rlist">${r.detail.map(d => `<li class="${d.ok ? 'ok' : 'ng'}"><span class="gi"></span>${T(d.label)}${d.value ? `（${d.value}）` : ''}</li>`).join('')}</ul>
        <div class="debrief"><b>解説</b> ${this.resolve(sc.debrief)}</div>
      </div>`;
    }
    h.innerHTML = `
      <div class="sc-head">
        <div><span class="sc-cat">${sc.cat}・${sc.level}</span><b class="sc-title">${T(sc.title)}</b></div>
        <div class="sc-actions">
          ${c.done ? '' : '<button class="btn small" data-act="hint">ヒント</button><button class="btn small" data-act="ff">早送り 60 秒</button>'}
          <button class="btn small" data-act="end">${c.done ? '閉じる' : '中止'}</button>
        </div>
      </div>
      <div class="sc-brief">${T(sc.brief)}</div>
      ${c.hintShown && !c.done ? `<div class="sc-hint"><b>ヒント</b> ${T(sc.hint)}</div>` : ''}
      ${sc.tasks.map((t, i) => t.type === 'quiz' ? quizHtml(t, i) : '').join('')}
      ${goals && !c.done ? `<div class="task"><div class="tq">目標（設定を調整し、満たした状態で「判定」）</div><ul class="goals">${goals}</ul></div>` : ''}
      ${c.done ? result : `<div class="sc-foot"><span>患者パラメータはシナリオ終了まで非表示です。血液ガスは設定変更後しばらくして平衡に達します（早送りも可）。</span><button class="btn on" data-act="eval">判定</button></div>`}
      ${c.done ? `<div class="sc-foot"><span>患者パラメータを表示しました。</span><button class="btn" data-act="retry">もう一度</button></div>` : ''}`;
    h.querySelectorAll('[data-q]').forEach(b => b.onclick = () => this.answer(+b.dataset.q, +b.dataset.o));
    h.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
      const a = b.dataset.act;
      if (a === 'hint') { c.hintShown = true; this.render(); }
      else if (a === 'ff') this.fastForward(60);
      else if (a === 'eval') this.evaluate();
      else if (a === 'end') this.end();
      else if (a === 'retry') this.start(sc.id);
    });
    if (c.done) this.onEnd({ reveal: true });
    this.updateGoals();
  }
}

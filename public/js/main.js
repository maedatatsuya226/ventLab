import { Simulator, MODES, EVENTS, ASYNC, ASYNC_KEYS, pbw } from './engine.js';
import { SweepChart, LoopChart } from './charts.js';
import { LungView } from './lung.js';
import { HELP } from './help.js';
import { AlarmSystem, ALARM_DEFS } from './alarms.js';
import { GasModel } from './gas.js';
import { SCENARIOS, ScenarioRunner, GAS, loadRecords, resetRecords } from './scenarios.js';
import { defaultSettings } from './engine.js';
import { VENDORS, vendor, vendorKey, setVendor, term, fmtIE } from './vendor.js';
import { LsfMonitor } from './lsf.js';

const sim = new Simulator();
const alarms = new AlarmSystem(sim);
const gas = new GasModel(sim);
const lsf = new LsfMonitor();
const $ = id => document.getElementById(id);

// ---------------- 設定パラメータ定義 ----------------
const PARAMS = {
  vt:    { label: 'VT',     jp: '一回換気量',     unit: 'mL',     min: 100, max: 1200, step: 10 },
  rr:    { label: 'RR',     jp: '換気回数',       unit: '/min',   min: 4,   max: 40,   step: 1 },
  ti:    { label: 'Ti',     jp: '吸気時間',       unit: 's',      min: 0.3, max: 3.0,  step: 0.05, dec: 2 },
  pause: { label: 'Tpause', jp: '吸気ポーズ',     unit: 's',      min: 0,   max: 1.0,  step: 0.05, dec: 2 },
  pinsp: { label: 'Pinsp',  jp: '吸気圧（PEEP上）', unit: 'cmH₂O', min: 2,   max: 45,   step: 1 },
  rise:  { label: 'Rise',   jp: '立ち上がり',     unit: 's',      min: 0,   max: 0.6,  step: 0.05, dec: 2 },
  peep:  { label: 'PEEP',   jp: '呼気終末陽圧',   unit: 'cmH₂O',  min: 0,   max: 25,   step: 1 },
  ps:    { label: 'PS',     jp: '圧支持（PEEP上）', unit: 'cmH₂O', min: 0,   max: 30,   step: 1 },
  ets:   { label: 'ETS',    jp: '呼気トリガー',   unit: '%',      min: 5,   max: 80,   step: 5 },
  fio2:  { label: 'FiO₂',   jp: '吸入酸素濃度',   unit: '%',      min: 21,  max: 100,  step: 1 },
  apnea: { label: 'Tapnea', jp: '無呼吸時間',     unit: 's',      min: 10,  max: 60,   step: 5 },
};
const MODE_PARAMS = {
  'VC-AC':    ['vt', 'rr', 'ti', 'pause', 'flow', 'peep', 'fio2', 'trig'],
  'PC-AC':    ['pinsp', 'rr', 'ti', 'rise', 'peep', 'fio2', 'trig'],
  'VC-SIMV':  ['vt', 'rr', 'ti', 'pause', 'flow', 'ps', 'ets', 'peep', 'fio2', 'trig'],
  'PC-SIMV':  ['pinsp', 'rr', 'ti', 'rise', 'ps', 'ets', 'peep', 'fio2', 'trig'],
  'CPAP-PSV': ['ps', 'peep', 'rise', 'ets', 'fio2', 'trig', 'apnea', 'bk:pinsp', 'bk:rr', 'bk:ti'],
};
const ALARM_PARAMS = {
  pmax:    { label: 'Pmax',    jp: '気道内圧 上限', unit: 'cmH₂O', min: 15, max: 80,   step: 1 },
  plow:    { label: 'Plow',    jp: '気道内圧 下限', unit: 'cmH₂O', min: 2,  max: 40,   step: 1 },
  vteHigh: { label: 'VTe ↑',   jp: '一回換気量 上限', unit: 'mL',  min: 200, max: 2000, step: 10 },
  vteLow:  { label: 'VTe ↓',   jp: '一回換気量 下限', unit: 'mL',  min: 0,  max: 1000, step: 10 },
  mveHigh: { label: 'MVe ↑',   jp: '分時換気量 上限', unit: 'L/min', min: 2, max: 40,   step: 0.5, dec: 1 },
  mveLow:  { label: 'MVe ↓',   jp: '分時換気量 下限', unit: 'L/min', min: 0, max: 20,   step: 0.5, dec: 1 },
  rrHigh:  { label: 'RR ↑',    jp: '呼吸数 上限',   unit: '/min',  min: 10, max: 80,   step: 1 },
  apnea:   { label: 'Tapnea',  jp: '無呼吸時間',   unit: 's',     min: 10, max: 60,   step: 5 },
};
const PRESETS = [
  { name: '正常肺', p: { c: 55, r: 8, rexp: 1, effort: 0, prr: 14, pti: 1.0, leak: 0 }, g: GAS.normal },
  { name: 'ARDS 中等症', p: { c: 28, r: 12, rexp: 1, effort: 0, prr: 20, pti: 0.8, leak: 0 }, g: GAS.ardsMod },
  { name: 'ARDS 重症', p: { c: 16, r: 14, rexp: 1, effort: 0, prr: 24, pti: 0.7, leak: 0 }, g: GAS.ardsSev },
  { name: 'COPD 増悪', p: { c: 65, r: 20, rexp: 2.5, effort: 5, prr: 22, pti: 0.9, leak: 0 }, g: GAS.copd },
  { name: '喘息発作', p: { c: 45, r: 35, rexp: 2.0, effort: 0, prr: 16, pti: 1.0, leak: 0 }, g: { ...GAS.normal, vq: 0.2, vdAlv: 0.2 } },
  { name: '離脱期（自発呼吸）', p: { c: 50, r: 10, rexp: 1, effort: 5, prr: 18, pti: 1.0, leak: 0 }, g: GAS.normal },
  { name: '呼吸促迫', p: { c: 35, r: 12, rexp: 1, effort: 12, prr: 30, pti: 0.9, leak: 0 }, g: { shunt: 0.15, recruit: 0.4, vdAlv: 0.15, vq: 0.05, hco3: 22 } },
];
const GASP = {
  shunt:   { label: 'Qs',    jp: 'シャント率',   unit: '%',     min: 0,  max: 70, step: 1, scale: 100 },
  recruit: { label: 'Recr',  jp: 'PEEP 反応性',  unit: '%',     min: 0,  max: 90, step: 5, scale: 100 },
  vdAlv:   { label: 'VDalv', jp: '肺胞死腔率',   unit: '%',     min: 0,  max: 60, step: 1, scale: 100 },
  vq:      { label: 'V/Q',   jp: '低 V/Q 領域',  unit: '%',     min: 0,  max: 50, step: 1, scale: 100 },
  hco3:    { label: 'HCO₃',  jp: '代謝性 HCO₃⁻', unit: 'mEq/L', min: 10, max: 40, step: 1, scale: 1 },
};
const PATIENT = {
  c:      { label: 'C',      jp: 'コンプライアンス', unit: 'mL/cmH₂O',  min: 5,   max: 120, step: 1 },
  r:      { label: 'R',      jp: '気道抵抗（吸気）', unit: 'cmH₂O/L/s', min: 2,   max: 60,  step: 1 },
  rexp:   { label: 'Rexp',   jp: '呼気抵抗倍率',     unit: '×',         min: 1,   max: 4,   step: 0.1, dec: 1 },
  effort: { label: 'Pmus',   jp: '吸気努力',         unit: 'cmH₂O',     min: 0,   max: 20,  step: 0.5, dec: 1 },
  prr:    { label: 'RRpt',   jp: '患者呼吸数',       unit: '/min',      min: 4,   max: 45,  step: 1 },
  pti:    { label: 'Ti,pt',  jp: '患者の吸気時間',   unit: 's',         min: 0.4, max: 2.0, step: 0.05, dec: 2 },
  leak:   { label: 'Leak',   jp: 'リーク',           unit: 'L/min',     min: 0,   max: 40,  step: 1 },
};

// 表示スタイルによる上書きを反映した定義
const pdef = k => ({ ...PARAMS[k], ...vendor().params?.[k] });
const adef = k => ({ ...ALARM_PARAMS[k], ...vendor().alarmParams?.[k] });
const modeDef = key => ({ ...MODES[key], ...vendor().modes?.[key] });

const fmt = (v, dec = 0) => v == null || !isFinite(v) ? '--' : v.toFixed(dec);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const roundStep = (v, st) => Math.round(v / st) * st;

// ---------------- ツールチップ ----------------
const tip = $('tooltip');
let tipTimer = null;
function showTip(target, text) {
  if (!text) return;
  tip.textContent = text;
  tip.hidden = false;
  const r = target.getBoundingClientRect();
  const tw = Math.min(320, window.innerWidth - 24);
  tip.style.maxWidth = tw + 'px';
  let left = clamp(r.left, 12, window.innerWidth - tw - 12);
  tip.style.left = left + 'px';
  const th = tip.offsetHeight;
  let top = r.bottom + 6;
  if (top + th > window.innerHeight - 8) top = r.top - th - 6;
  tip.style.top = Math.max(8, top) + 'px';
}
function hideTip() { tip.hidden = true; }
document.addEventListener('pointerover', e => {
  if (e.pointerType !== 'mouse') return;
  const t = e.target.closest('[data-help]');
  if (t) showTip(t, term(HELP[t.dataset.help])); else hideTip();
});
document.addEventListener('click', e => {
  const t = e.target.closest('[data-help]');
  if (!t || e.pointerType === 'mouse') return;
  if (e.target.closest('button:not([data-help]), input, select')) return;
  showTip(t, term(HELP[t.dataset.help]));
  clearTimeout(tipTimer);
  tipTimer = setTimeout(hideTip, 5000);
});
window.addEventListener('scroll', hideTip, { passive: true });

// ---------------- 波形・ループ・肺 ----------------
const chPaw = new SweepChart($('cvPaw'), { kind: 'paw', label: 'Paw', unit: 'cmH₂O', color: '--paw', overlayColor: '--pmus', overlayLabel: '− Pmus', showSeg: true, asyncLabels: ASYNC_KEYS.map(k => ASYNC[k].short) });
const chFlow = new SweepChart($('cvFlow'), { kind: 'flow', label: 'Flow', unit: 'L/min', color: '--flow' });
const chVol = new SweepChart($('cvVol'), { kind: 'vol', label: 'Volume', unit: 'mL', color: '--vol' });
const charts = [chPaw, chFlow, chVol];
const lpPV = new LoopChart($('cvPV'), { xKey: 'paw', yKey: 'vol', title: 'P-V', xLabel: 'Paw cmH₂O', yLabel: 'Vol mL', color: '--vol', xMinSpan: 30 });
const lpFV = new LoopChart($('cvFV'), { xKey: 'vol', yKey: 'flow', title: 'F-V', xLabel: 'Vol mL', yLabel: 'Flow L/min', color: '--flow', symY: true, xMinSpan: 300 });
const loops = [lpPV, lpFV];
const lung = new LungView($('lungBox'));
const chartBase = new Map([[chPaw, 'paw'], [chFlow, 'flow'], [chVol, 'vol'], [lpPV, 'pv'], [lpFV, 'fv']].map(([c, k]) => [c, { k, o: { ...c.o } }]));
function applyChartLabels() {
  for (const [c, b] of chartBase) {
    const v = vendor().charts?.[b.k];
    c.o = { ...b.o, ...v, limit: v?.limit ? () => sim.settings.pmax : null };
  }
}

// Dynamic Lung 風の呼吸力学表示（Hamilton 表示のみ）
const dlInfo = document.createElement('div');
dlInfo.className = 'dl-info';
$('lungBox').appendChild(dlInfo);
let dlCache = '';
function updateDynLung() {
  if (vendorKey() !== 'hamilton') return;
  const html = `<div class="dl-h">${sim.patient.sex === 'F' ? 'Female' : 'Male'} ${sim.patient.height} cm</div>
    <div data-help="h_rinsp"><span>Rinsp</span><b>${fmt(lsf.rinsp, 0)}</b><small>cmH2O/(l/s)</small></div>
    <div data-help="h_cstat"><span>Cstat</span><b>${fmt(lsf.cstat, 0)}</b><small>ml/cmH2O</small></div>
    <div data-help="h_rcexp"><span>RCexp</span><b>${fmt(lsf.rcexp, 2)}</b><small>s</small></div>`;
  if (html !== dlCache) { dlInfo.innerHTML = html; dlCache = html; }
}

// ---------------- 換気モード ----------------
function renderModes() {
  const host = $('modeButtons');
  host.innerHTML = '';
  for (const key of Object.keys(MODES)) {
    const md = modeDef(key);
    const b = document.createElement('button');
    b.className = 'btn' + (sim.settings.mode === key ? ' on' : '');
    b.textContent = md.name;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', sim.settings.mode === key);
    b.title = md.jp;
    b.onclick = () => { sim.setSettings({ mode: key }); renderModes(); renderParams(); };
    host.appendChild(b);
  }
  updateModeChip();
  renderMainControls();
}
let chipCache = '';
function updateModeChip() {
  const m = modeDef(sim.settings.mode);
  const html = sim.backup
    ? `${m.name} → <span style="color:var(--warn)">${vendor().backupName || 'バックアップ換気'}</span><small>無呼吸のため PC 強制換気中</small>`
    : `${m.name}<small>${m.jp}</small>`;
  if (html !== chipCache) { $('modeChip').innerHTML = html; chipCache = html; }
  $('btnInspHold').disabled = !sim.mode.mand;
}

// 押し続けで連続変更
function repeatButton(btn, fn) {
  let t1 = null, t2 = null;
  const stop = () => { clearTimeout(t1); clearInterval(t2); };
  btn.addEventListener('pointerdown', e => {
    e.preventDefault();
    fn();
    t1 = setTimeout(() => { t2 = setInterval(fn, 70); }, 380);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => btn.addEventListener(ev, stop));
}

function numberCard(key, def, get, set) {
  const card = document.createElement('div');
  card.className = 'pcard';
  card.innerHTML = `
    <div class="lbl" data-help="${key}"><b>${def.label}</b><small>${def.jp}</small></div>
    <div class="row">
      <button class="pm" aria-label="${def.label} を下げる">−</button>
      <div class="val"><span class="n"></span><small>${def.unit}</small></div>
      <button class="pm" aria-label="${def.label} を上げる">＋</button>
    </div>
    <input type="range" min="${def.min}" max="${def.max}" step="${def.step}" aria-label="${def.label}">`;
  const n = card.querySelector('.n'), range = card.querySelector('input');
  const [dn, up] = card.querySelectorAll('.pm');
  const refresh = () => { const v = get(); n.textContent = fmt(v * (def.scale || 1), def.dec || 0); range.value = v; };
  const apply = v => { set(+clamp(roundStep(v, def.step), def.min, def.max).toFixed(3)); refresh(); updateDerived(); };
  repeatButton(dn, () => apply(get() - def.step));
  repeatButton(up, () => apply(get() + def.step));
  range.addEventListener('input', () => apply(+range.value));
  refresh();
  return card;
}

function segCard(helpKey, label, jp, options, get, set, extra) {
  const card = document.createElement('div');
  card.className = 'pcard';
  card.innerHTML = `<div class="lbl" data-help="${helpKey}"><b>${label}</b><small>${jp}</small></div><div class="seg"></div>`;
  const seg = card.querySelector('.seg');
  const draw = () => {
    seg.innerHTML = '';
    for (const [val, text] of options) {
      const b = document.createElement('button');
      b.className = 'btn' + (get() === val ? ' on' : '');
      b.textContent = text;
      b.onclick = () => { set(val); draw(); extra?.(); };
      seg.appendChild(b);
    }
  };
  draw();
  return card;
}

function renderParams() {
  const host = $('params');
  host.innerHTML = '';
  const s = sim.settings;
  for (const key of MODE_PARAMS[s.mode]) {
    if (key.startsWith('bk:')) {
      const k = key.slice(3);
      const base = pdef(k);
      const def = { ...base, jp: 'バックアップ ' + base.jp };
      host.appendChild(numberCard(k, def, () => sim.settings[k], v => sim.setSettings({ [k]: v })));
    } else if (PARAMS[key]) {
      host.appendChild(numberCard(key, pdef(key), () => sim.settings[key], v => sim.setSettings({ [key]: v })));
    } else if (key === 'flow') {
      const fv = vendor().flow;
      host.appendChild(segCard('flow', fv?.label || 'Flow', '流量波形',
        [['square', fv?.options.square || '矩形波'], ['decel', fv?.options.decel || '漸減波']],
        () => sim.settings.flowPattern, v => sim.setSettings({ flowPattern: v }), updateDerived));
    } else if (key === 'trig') {
      const tv = vendor().trig;
      const wrap = document.createElement('div');
      wrap.style.display = 'contents';
      const draw = () => {
        wrap.innerHTML = '';
        wrap.appendChild(segCard('trig', tv?.label || 'Trigger', 'トリガー方式', [['flow', 'フロー'], ['pressure', '圧']],
          () => sim.settings.trigType, v => { sim.setSettings({ trigType: v }); draw(); }));
        const isFlow = sim.settings.trigType === 'flow';
        const k = isFlow ? 'ftrig' : 'ptrig';
        const def = isFlow
          ? { label: 'Trig', jp: 'フロートリガー感度', unit: 'L/min', min: 0.5, max: 15, step: 0.5, dec: 1, ...tv?.flow }
          : { label: 'Trig', jp: '圧トリガー感度', unit: 'cmH₂O', min: 0.5, max: 15, step: 0.5, dec: 1, ...tv?.pressure };
        wrap.appendChild(numberCard('trig', def, () => sim.settings[k], v => sim.setSettings({ [k]: v })));
      };
      draw();
      host.appendChild(wrap);
    }
  }
  updateDerived();
}

function renderAlarmParams() {
  const host = $('alarmParams');
  host.innerHTML = '';
  for (const k of Object.keys(ALARM_PARAMS)) {
    host.appendChild(numberCard(k, adef(k), () => sim.settings[k], v => sim.setSettings({ [k]: v })));
  }
}
document.querySelectorAll('.tab').forEach(tab => tab.onclick = () => {
  document.querySelectorAll('.tab').forEach(t => { const on = t === tab; t.classList.toggle('on', on); t.setAttribute('aria-selected', on); });
  $('tabVent').hidden = tab.dataset.tab !== 'vent';
  $('tabAlarm').hidden = tab.dataset.tab !== 'alarm';
  if (tab.dataset.tab === 'alarm') renderAlarmParams();
});

function updateDerived() {
  const s = sim.settings, m = MODES[s.mode];
  const parts = [];
  if (m.mand) {
    const T = 60 / s.rr;
    const ti = Math.min(s.ti, T - 0.3);
    const te = T - ti;
    parts.push(`設定 I:E <b>1 : ${fmt(te / ti, 1)}</b>`);
    parts.push(`Te <b>${fmt(te, 2)} s</b>`);
    if (m.mand === 'VC') {
      const tf = Math.max(0.15, ti - Math.min(s.pause, ti - 0.15));
      const pk = (s.flowPattern === 'decel' ? 2 : 1) * s.vt / 1000 / tf * 60;
      parts.push(`ピーク流量 <b>${fmt(pk, 0)} L/min</b>`);
      parts.push(`予測 MV <b>${fmt(s.vt * s.rr / 1000, 1)} L/min</b>`);
    }
    if (s.ti > T - 0.3) parts.push('<span class="warn">Ti が呼吸周期に対して長すぎるため短縮して換気中</span>');
    else if (ti > te) parts.push('<span class="warn">逆比換気（I &gt; E）</span>');
  } else {
    parts.push(`強制換気なし：${s.apnea} 秒無呼吸でバックアップ換気（PC：Pinsp ${s.pinsp} / RR ${s.rr} / Ti ${fmt(s.ti, 2)}）`);
  }
  if (m.mand === 'VC') {
    const kg = pbw(sim.patient);
    const perKg = s.vt / kg;
    parts.push(`VT/PBW <b class="${perKg > 8 ? 'warn' : ''}">${fmt(perKg, 1)} mL/kg</b>`);
  }
  $('derived').innerHTML = term(parts.map(p => `<span>${p}</span>`).join(''));
}

// ---------------- 患者パネル ----------------
const sliderRefs = {};
function renderPatient() {
  // プリセット
  const pre = $('presets');
  pre.innerHTML = '';
  pre.dataset.help = 'presets';
  for (const pr of PRESETS) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = pr.name;
    b.onclick = () => { sim.setPatient(pr.p); gas.setParams(pr.g); renderPatient(); setStatus(`患者を「${pr.name}」に変更しました。換気設定は変わっていません。`); };
    pre.appendChild(b);
  }
  // 体格
  const body = $('bodyRow');
  body.innerHTML = `<label>身長 <input type="number" min="120" max="210" step="1" value="${sim.patient.height}" aria-label="身長 cm"> cm</label>
    <div class="seg"></div>`;
  body.querySelector('input').addEventListener('change', e => {
    sim.setPatient({ height: clamp(+e.target.value || 165, 120, 210) });
    e.target.value = sim.patient.height;
    updatePbw(); updateDerived();
  });
  const seg = body.querySelector('.seg');
  for (const [v, t] of [['M', '男性'], ['F', '女性']]) {
    const b = document.createElement('button');
    b.className = 'btn' + (sim.patient.sex === v ? ' on' : '');
    b.textContent = t;
    b.onclick = () => { sim.setPatient({ sex: v }); renderPatient(); updateDerived(); };
    seg.appendChild(b);
  }
  updatePbw();
  // スライダー
  const host = $('patientSliders');
  host.innerHTML = '';
  for (const [key, def] of Object.entries(PATIENT)) {
    const row = document.createElement('div');
    row.className = 'srow';
    row.innerHTML = `<div class="lbl" data-help="${key}"><b>${def.label}</b><small>${def.jp}</small><span class="eff"></span></div>
      <div class="val"><span class="n"></span><small>${def.unit}</small></div>
      <input type="range" min="${def.min}" max="${def.max}" step="${def.step}" aria-label="${def.jp}">`;
    const n = row.querySelector('.n'), range = row.querySelector('input');
    const refresh = () => { n.textContent = fmt(sim.patient[key], def.dec || 0); range.value = sim.patient[key]; };
    range.addEventListener('input', () => { sim.setPatient({ [key]: +range.value }); refresh(); });
    refresh();
    sliderRefs[key] = { eff: row.querySelector('.eff'), def, cache: '' };
    host.appendChild(row);
  }
  // ガス交換
  const gh = $('gasSliders');
  gh.innerHTML = '';
  for (const [key, def] of Object.entries(GASP)) {
    const row = document.createElement('div');
    row.className = 'srow';
    row.innerHTML = `<div class="lbl" data-help="${key}"><b>${def.label}</b><small>${def.jp}</small></div>
      <div class="val"><span class="n"></span><small>${def.unit}</small></div>
      <input type="range" min="${def.min}" max="${def.max}" step="${def.step}" aria-label="${def.jp}">`;
    const n = row.querySelector('.n'), range = row.querySelector('input');
    const refresh = () => { const v = gas.p[key] * def.scale; n.textContent = fmt(v, 0); range.value = v; };
    range.addEventListener('input', () => { gas.setParams({ [key]: +range.value / def.scale }); refresh(); });
    refresh();
    gh.appendChild(row);
  }
  renderEvents();
}
function updatePbw() {
  $('pbw').innerHTML = `<span data-help="pbw">PBW <b>${fmt(pbw(sim.patient), 1)} kg</b>（6 mL/kg = ${fmt(pbw(sim.patient) * 6, 0)} mL、8 mL/kg = ${fmt(pbw(sim.patient) * 8, 0)} mL）</span>`;
}
function renderEvents() {
  const host = $('events');
  host.innerHTML = '';
  for (const [id, ev] of Object.entries(EVENTS)) {
    const b = document.createElement('button');
    b.className = 'btn' + (sim.events[id] ? ' on' : '');
    b.textContent = ev.jp;
    b.dataset.help = 'ev_' + id;
    b.setAttribute('aria-pressed', !!sim.events[id]);
    b.onclick = () => { sim.setEvent(id, !sim.events[id]); renderEvents(); };
    host.appendChild(b);
  }
}
$('btnClearEv').onclick = () => { sim.clearEvents(); renderEvents(); };
// イベントで変化した実効値をスライダー横に表示
function updateEffective() {
  const e = sim.eff;
  for (const [key, ref] of Object.entries(sliderRefs)) {
    const base = sim.patient[key], v = e[key];
    const str = v != null && Math.abs(v - base) > 1e-6 * Math.max(1, Math.abs(base)) + 0.05 ? '→ ' + fmt(v, ref.def.dec || 0) : '';
    if (str !== ref.cache) { ref.eff.textContent = str; ref.cache = str; }
  }
}

// ---------------- 実測値タイル ----------------
const TILES = [
  { k: 'pip',   label: 'PIP',    jp: '最高気道内圧', unit: 'cmH₂O',  cls: 'paw big', help: 'm_pip',   dec: 0 },
  { k: 'pplat', label: 'Pplat',  jp: 'プラトー圧',   unit: 'cmH₂O',  cls: 'paw big', help: 'm_pplat', dec: 0, stale: 'pplatAt' },
  { k: 'peep',  label: 'PEEP',   jp: '呼気終末圧',   unit: 'cmH₂O',  cls: 'paw big', help: 'm_peep',  dec: 0 },
  { k: 'vti',   label: 'VTi',    jp: '吸気VT',       unit: 'mL',     cls: 'vol',     help: 'm_vti',   dec: 0 },
  { k: 'vte',   label: 'VTe',    jp: '呼気VT',       unit: 'mL',     cls: 'vol',     help: 'm_vte',   dec: 0 },
  { k: 'mve',   label: 'MVe',    jp: '分時換気量',   unit: 'L/min',  cls: 'vol',     help: 'm_mve',   dec: 1 },
  { k: 'rr',    label: 'RR',     jp: '総呼吸数',     unit: '/min',   cls: 'flow',    help: 'm_rr',    dec: 0 },
  { k: 'rrSpont', label: 'RRspn', jp: '自発',        unit: '/min',   cls: 'flow',    help: 'm_rrs',   dec: 0 },
  { k: 'ie',    label: 'I:E',    jp: '',             unit: '',       cls: 'flow',    help: 'm_ie',    dec: 1, fmt: fmtIE },
  { k: 'pmean', label: 'Pmean',  jp: '平均気道内圧', unit: 'cmH₂O',  cls: 'paw',     help: 'm_pmean', dec: 0 },
  { k: 'dp',    label: 'ΔP',     jp: 'Driving',      unit: 'cmH₂O',  cls: 'paw',     help: 'm_dp',    dec: 0, stale: 'pplatAt' },
  { k: 'cstat', label: 'Cstat',  jp: '',             unit: 'mL/cmH₂O', cls: '',      help: 'm_cstat', dec: 0, stale: 'pplatAt' },
  { k: 'raw',   label: 'Raw',    jp: '',             unit: 'cmH₂O/L/s', cls: '',     help: 'm_raw',   dec: 0, stale: 'pplatAt' },
  { k: 'autoPeep', label: 'autoPEEP', jp: '',        unit: 'cmH₂O',  cls: '',        help: 'm_autopeep', dec: 1, stale: 'peepTotAt' },
  { k: 'ti',    label: 'Ti',     jp: '実測',         unit: 's',      cls: '',        help: 'm_ti',    dec: 2 },
  { k: 'rsbi',  label: 'RSBI',   jp: '',             unit: '/min/L', cls: '',        help: 'm_rsbi',  dec: 0 },
];
let tileEls = {};
const tileDefs = () => vendor().tiles || TILES;
// 実測値の取り出し（src: 'lsf' は呼吸ごとの LSF 推定値）
function measValue(t) {
  if (t.src === 'lsf') return lsf[t.k];
  if (t.k === 'mve') return sim.liveMve();
  if (t.k === 'fio2') return sim.settings.fio2;
  return sim.meas[t.k];
}
function renderTiles() {
  const host = $('tiles');
  host.innerHTML = '';
  tileEls = {};
  for (const t of tileDefs()) {
    const d = document.createElement('div');
    d.className = 'tile ' + t.cls;
    d.dataset.help = t.help;
    d.innerHTML = `<div class="k"><b>${t.label}</b><span>${t.unit}</span></div><div class="v">--</div>`;
    host.appendChild(d);
    tileEls[t.k] = { root: d, v: d.querySelector('.v'), cache: '' };
  }
}
function updateTiles() {
  const m = sim.meas;
  for (const t of tileDefs()) {
    const el = tileEls[t.k];
    const val = measValue(t);
    const str = t.fmt ? t.fmt(val) : fmt(val, t.dec);
    if (str !== el.cache) { el.v.textContent = str; el.cache = str; }
    if (t.stale) el.v.classList.toggle('stale', m[t.stale] < 0 || sim.t - m[t.stale] > 60);
  }
  const pip = m.pip ?? 0;
  const autoPeep = tileDefs().find(t => t.k === 'autoPeep')?.src === 'lsf' ? lsf.autoPeep : m.autoPeep;
  tileEls.pip?.root.classList.toggle('alarm', pip >= sim.settings.pmax - 0.5);
  tileEls.pip?.root.classList.toggle('warn', pip >= 35 && pip < sim.settings.pmax - 0.5);
  tileEls.pplat?.root.classList.toggle('warn', (m.pplat ?? 0) > 30);
  tileEls.dp?.root.classList.toggle('warn', (m.dp ?? 0) > 15);
  tileEls.autoPeep?.root.classList.toggle('warn', (autoPeep ?? 0) >= 2);
  tileEls.rsbi?.root.classList.toggle('warn', (m.rsbi ?? 0) > 105);
}

// ---------------- 主要モニタリング値（Hamilton 表示：波形の左に常時表示） ----------------
// 各値の左に アラーム上限（上）・下限（下）を小さく表示。下限のないものは Off
let mmpEls = [];
const MMP_ALARMS = { pip: ['pmax', 'plow'], mve: ['mveHigh', 'mveLow'], vte: ['vteHigh', 'vteLow'], rr: ['rrHigh'] };
function renderMmp() {
  const host = $('mmp');
  host.innerHTML = '';
  mmpEls = (vendor().mmp || []).map(t => {
    const d = document.createElement('div');
    d.className = 'mmp-item';
    d.innerHTML = `<div class="lim"><span class="hi"></span><span class="lo"></span></div>
      <div class="main"><div class="v">--</div><div class="k">${t.label}<br><span>${t.unit}</span></div></div>`;
    host.appendChild(d);
    return { t, root: d, v: d.querySelector('.v'), hi: d.querySelector('.hi'), lo: d.querySelector('.lo'), cache: '' };
  });
}
function updateMmp() {
  const s = sim.settings, act = new Set(alarms.list().filter(a => a.active).map(a => a.id));
  for (const el of mmpEls) {
    const t = el.t, val = measValue(t);
    const str = t.fmt ? t.fmt(val) : fmt(val, t.dec || 0);
    if (str !== el.cache) { el.v.textContent = str; el.cache = str; }
    const lim = (k, dec) => k ? fmt(s[k], dec) : 'Off';
    if (t.hi !== undefined) {
      el.hi.textContent = lim(t.hi, t.hiDec || 0);
      el.lo.textContent = lim(t.lo, t.hiDec || 0);
    }
    const ids = MMP_ALARMS[t.k] || [];
    const lvl = ids.map(id => act.has(id) ? ALARM_DEFS[id].level : null);
    el.root.classList.toggle('alarm', lvl.includes('high'));
    el.root.classList.toggle('warn', !lvl.includes('high') && lvl.includes('medium'));
  }
}

// ---------------- 主要設定ボタン（Hamilton 表示：画面右の丸いボタン） ----------------
// タップで選択（オレンジ）→ ＋／− またはホイールで調整 → もう一度タップで確定
let ctlActive = null, ctlEls = [];
function renderMainControls() {
  const host = $('mainCtl');
  host.innerHTML = '';
  ctlEls = [];
  const keys = vendor().mainControls?.[sim.settings.mode];
  if (!keys) return;
  if (!keys.includes(ctlActive)) ctlActive = null;
  for (const k of keys) {
    const def = pdef(k);
    const b = document.createElement('button');
    b.className = 'rc' + (ctlActive === k ? ' active' : '');
    b.dataset.help = k;
    b.innerHTML = `<span class="rc-dial"><b></b><small>${def.unit}</small></span><span class="rc-l">${def.label}</span>`;
    b.onclick = () => { ctlActive = ctlActive === k ? null : k; renderMainControls(); };
    b.addEventListener('wheel', e => { if (ctlActive !== k) return; e.preventDefault(); stepParam(k, e.deltaY < 0 ? 1 : -1); }, { passive: false });
    host.appendChild(b);
    ctlEls.push({ k, def, v: b.querySelector('b'), cache: '' });
  }
  const adj = document.createElement('div');
  adj.className = 'rc-adj';
  adj.hidden = !ctlActive;
  adj.innerHTML = '<button class="pm" aria-label="下げる">−</button><button class="pm" aria-label="上げる">＋</button>';
  const [dn, up] = adj.querySelectorAll('button');
  repeatButton(dn, () => ctlActive && stepParam(ctlActive, -1));
  repeatButton(up, () => ctlActive && stepParam(ctlActive, 1));
  host.appendChild(adj);
  const nav = document.createElement('div');
  nav.className = 'rc-nav';
  nav.innerHTML = '<button class="btn small" data-go="vent">Controls</button><button class="btn small" data-go="alarm">Alarms</button>';
  nav.querySelectorAll('[data-go]').forEach(b => b.onclick = () => {
    document.querySelector(`.tab[data-tab="${b.dataset.go}"]`).click();
    document.querySelector('.settings').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  host.appendChild(nav);
}
function stepParam(k, dir) {
  const def = PARAMS[k];
  const v = +clamp(roundStep(sim.settings[k] + dir * def.step, def.step), def.min, def.max).toFixed(3);
  sim.setSettings({ [k]: v });
  renderParams();
}
function updateMainControls() {
  for (const el of ctlEls) {
    const str = fmt(sim.settings[el.k] * (el.def.scale || 1), el.def.dec || 0);
    if (str !== el.cache) { el.v.textContent = str; el.cache = str; }
  }
}

// 掃引時間の選択肢（Hamilton は 7 / 14 / 21 / 28 秒）
function renderSweeps() {
  const sel = $('selWin');
  const opts = vendor().sweeps || [6, 10, 20];
  const cur = charts[0].win;
  const pick = opts.reduce((a, b) => Math.abs(b - cur) < Math.abs(a - cur) ? b : a);
  sel.innerHTML = opts.map(s => `<option value="${s}">${s} 秒</option>`).join('');
  sel.value = pick;
  if (pick !== cur) charts.forEach(c => c.setWindow(pick));
}

// ---------------- 操作ボタン ----------------
let running = true, speed = 1;
$('btnRun').onclick = () => {
  running = !running;
  $('btnRun').textContent = running ? '❚❚' : '▶';
  $('btnRun').setAttribute('aria-label', running ? '一時停止' : '再開');
};
$('selSpeed').onchange = e => { speed = +e.target.value; };
$('selWin').onchange = e => { charts.forEach(c => c.setWindow(+e.target.value)); };
$('btnPmus').onclick = () => {
  const on = !chPaw.showOverlay;
  chPaw.showOverlay = on;
  $('btnPmus').setAttribute('aria-pressed', on);
  document.body.classList.toggle('show-pmus', on);
};
$('btnTheme').onclick = () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('vs-theme', root.dataset.theme); } catch (e) {}
};
$('btnInspHold').onclick = () => { if (sim.requestHold('insp')) setStatus('次の強制換気で吸気ホールド（3 秒）を行います…'); };
$('btnExpHold').onclick = () => { sim.requestHold('exp'); setStatus('次の吸気の直前で呼気ホールド（3 秒）を行います…'); };
$('btnRef').onclick = () => loops.forEach(l => l.captureRef());
$('btnRefClear').onclick = () => loops.forEach(l => l.clearRef());

let statusMsg = '', statusUntil = 0;
function setStatus(msg, sec = 8) { statusMsg = msg; statusUntil = performance.now() + sec * 1000; }
function updateStatus() {
  const el = $('status');
  let msg = '';
  if (sim.phase === 'pause' && sim.breath?.hold) msg = '吸気ホールド中… 流量ゼロで肺胞内圧と気道内圧が平衡します';
  else if (sim.phase === 'exphold') msg = '呼気ホールド中… 呼気弁を閉じて総 PEEP を測定しています';
  else if (performance.now() < statusUntil) msg = statusMsg;
  msg = term(msg);
  if (sim.holdReq.insp || sim.holdReq.exp || sim.phase === 'exphold' || sim.breath?.hold && sim.phase === 'pause') {
    $('btnInspHold').classList.toggle('pending', sim.holdReq.insp || (sim.breath?.hold && sim.phase === 'pause'));
    $('btnExpHold').classList.toggle('pending', sim.holdReq.exp || sim.phase === 'exphold');
  } else {
    $('btnInspHold').classList.remove('pending');
    $('btnExpHold').classList.remove('pending');
  }
  if (el.textContent !== msg) el.textContent = msg;
}
let lastPeepTotAt = -1, lastPplatAt = -1;
function checkManeuverResults() {
  const m = sim.meas;
  if (m.peepTotAt !== lastPeepTotAt && m.peepTotAt > 0) {
    lastPeepTotAt = m.peepTotAt;
    setStatus(`呼気ホールド結果：総 PEEP ${fmt(m.peepTot, 1)} cmH₂O（設定 ${sim.settings.peep}）→ auto-PEEP ${fmt(m.autoPeep, 1)} cmH₂O`, 15);
  }
  const lb = sim.lastBreath;
  if (lb?.hold && m.pplatAt !== lastPplatAt) {
    lastPplatAt = m.pplatAt;
    setStatus(`吸気ホールド結果：Pplat ${fmt(m.pplat, 1)} cmH₂O、Cstat ${fmt(m.cstat, 0)} mL/cmH₂O、ΔP ${fmt(m.dp, 0)} cmH₂O`, 15);
  }
}

// ---------------- アラーム表示 ----------------
$('btnSilence').onclick = () => { alarms.silence(120); };
$('btnAlarmReset').onclick = () => { alarms.reset(); };
$('btnSound').onclick = () => {
  const on = !alarms.sound;
  alarms.setSound(on);
  $('btnSound').setAttribute('aria-pressed', on);
};
let alarmCache = '';
function updateAlarmBar() {
  const list = alarms.list();
  const html = list.length
    ? list.map(a => {
      const name = vendor().alarms?.[a.id];
      return `<span class="al ${a.level}${a.active ? ' active' : ' latched'}" title="${name ? a.jp + '：' : ''}${a.hint}">${name || a.jp}</span>`;
    }).join('')
    : '<span class="ok">アラームなし</span>';
  if (html !== alarmCache) { $('alarmList').innerHTML = html; alarmCache = html; }
  const left = alarms.silenceLeft();
  const txt = left ? `消音中 ${left}s` : '消音 2分';
  if ($('btnSilence').textContent !== txt) $('btnSilence').textContent = txt;
}
// アラームチップのヒントもツールチップで
$('alarmList').addEventListener('pointerover', e => {
  const t = e.target.closest('.al');
  if (t && e.pointerType === 'mouse') { showTip(t, t.title); }
});

// ---------------- 非同調パネル ----------------
let asyncCache = '';
function updateAsync() {
  const st = sim.asyncStats(120);
  const idx = st.index;
  const html = `<div class="ai${idx != null && idx >= 10 ? ' warn' : ''}" data-help="as_index">非同調指数 <b>${idx == null ? '--' : fmt(idx, 0) + '%'}</b> <span>${st.n} 件</span></div>` +
    ASYNC_KEYS.map(k => `<div class="ac${st.counts[k] ? ' hit' : ''}" data-help="as_${k}"><span>${ASYNC[k].jp}</span><b>${st.counts[k]}</b></div>`).join('');
  if (html !== asyncCache) { $('asyncPanel').innerHTML = html; asyncCache = html; }
}

// ---------------- 血液ガス ----------------
const BGA_LIVE = [
  { k: 'spo2', label: 'SpO₂', unit: '%', dec: 0, help: 'g_spo2', cls: 'big', lo: 90 },
  { k: 'etco2', label: 'EtCO₂', unit: 'mmHg', dec: 0, help: 'g_etco2', cls: '' },
  { k: 'pf', label: 'P/F', unit: '', dec: 0, help: 'g_pf', cls: '', lo: 200 },
];
const bgaEls = {};
function renderBgaLive() {
  const host = $('bgaLive');
  for (const t of BGA_LIVE) {
    const d = document.createElement('div');
    d.className = 'tile ' + t.cls;
    d.dataset.help = t.help;
    d.innerHTML = `<div class="k"><b>${t.label}</b><span>${t.unit}</span></div><div class="v">--</div>`;
    host.appendChild(d);
    bgaEls[t.k] = { root: d, v: d.querySelector('.v'), cache: '' };
  }
}
function updateBgaLive() {
  const g = gas.values();
  for (const t of BGA_LIVE) {
    const el = bgaEls[t.k];
    const str = g.ready ? fmt(g[t.k], t.dec) : '--';
    if (str !== el.cache) { el.v.textContent = str; el.cache = str; }
    el.root.classList.toggle('alarm', g.ready && t.lo != null && g[t.k] < t.lo - (t.k === 'spo2' ? 2 : 0));
    el.root.classList.toggle('warn', g.ready && t.k === 'spo2' && g.spo2 >= 88 && g.spo2 < 90);
  }
}
const abgLog = [];
const mmss = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
function renderAbg() {
  if (!abgLog.length) { $('bgaTable').innerHTML = '<div class="empty">「血液ガス採取」で結果を記録します</div>'; return; }
  const flag = (v, lo, hi) => v < lo ? 'lo' : v > hi ? 'hi' : '';
  const rows = abgLog.slice(-5).reverse().map(a => `<tr>
    <td>${mmss(a.t)}</td>
    <td class="${flag(a.ph, 7.35, 7.45)}">${a.ph.toFixed(2)}</td>
    <td class="${flag(a.paco2, 35, 45)}">${fmt(a.paco2, 0)}</td>
    <td class="${flag(a.pao2, 80, 500)}">${fmt(a.pao2, 0)}</td>
    <td class="${flag(a.hco3, 22, 26)}">${fmt(a.hco3, 1)}</td>
    <td>${fmt(a.be, 1)}</td>
    <td>${fmt(a.spo2, 0)}</td>
    <td>${fmt(a.pf, 0)}</td></tr>`).join('');
  $('bgaTable').innerHTML = `<table><thead><tr><th>時刻</th><th>pH</th><th>PaCO₂</th><th>PaO₂</th><th>HCO₃</th><th>BE</th><th>SaO₂</th><th>P/F</th></tr></thead><tbody>${rows}</tbody></table>`;
}
$('btnAbg').onclick = () => {
  const g = gas.values();
  if (!g.ready) { setStatus('換気開始直後のため、もう少し待ってから採取してください。'); return; }
  abgLog.push({ t: sim.t, ...g });
  renderAbg();
};

// ---------------- シナリオ ----------------
function resetSim() {
  sim.reset();
  alarms.state = {}; alarms.lastBreathId = 0;
  gas.snap();
  abgLog.length = 0; renderAbg();
  charts.forEach(c => c.setWindow(c.win));
  loops.forEach(l => { l.cur = []; l.prev = []; l.ref = null; });
  lsf.reset();
  pendingMarkers = [];
}
function setMask(on) { $('patientMask').hidden = !on; }
function fastForward(sec) {
  for (let i = 0; i < sec * 10; i++) { sim.advance(0.1); gas.update(0.1); runner.tick(); alarms.update(); }
  setStatus(`${sec} 秒早送りしました`);
}
// シナリオ開始時は換気設定をいったん既定値に戻す（アラーム設定は維持）
function defaultsForScenario() {
  const d = defaultSettings(), s = sim.settings;
  for (const k of ['pmax', 'plow', 'vteHigh', 'vteLow', 'mveHigh', 'mveLow', 'rrHigh']) d[k] = s[k];
  return d;
}
const runner = new ScenarioRunner({
  sim, gas, host: $('scenarioHost'), fastForward, term,
  onStart: ({ settings, patient, gas: g }) => {
    sim.clearEvents();
    sim.setSettings({ ...defaultsForScenario(), ...settings });
    sim.setPatient(patient);
    gas.setParams({ ...GAS.normal, ...g });
    resetSim();
    syncUI();
    setMask(true);
    $('scenarioHost').scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  onEnd: opt => {
    setMask(false);
    if (opt?.reveal) renderPatient();
  },
});
function renderScenList() {
  const rec = loadRecords();
  const tried = SCENARIOS.filter(s => rec[s.id]);
  const avg = tried.length ? tried.reduce((a, s) => a + rec[s.id].best, 0) / tried.length : 0;
  $('scenSummary').textContent = `実施 ${tried.length}/${SCENARIOS.length}${tried.length ? `・平均ベスト ${fmt(avg, 0)} 点` : ''}`;
  $('scenList').innerHTML = SCENARIOS.map(s => {
    const r = rec[s.id];
    return `<div class="sd-card">
      <div class="row"><span class="sc-cat">${s.cat}・${s.level}</span><span class="rec ${r ? '' : 'none'}">${r ? `ベスト <b>${r.best}</b> 点・${r.attempts} 回` : '未実施'}</span></div>
      <div class="t">${term(s.title)}</div>
      <div class="d">${term(s.brief)}</div>
      <div class="row"><span></span><button class="btn on small" data-start="${s.id}">開始</button></div>
    </div>`;
  }).join('');
  $('scenList').querySelectorAll('[data-start]').forEach(b => b.onclick = () => {
    $('scenDialog').close();
    runner.start(b.dataset.start);
  });
}
$('btnScen').onclick = () => { renderScenList(); $('scenDialog').showModal(); };
$('scenClose').onclick = () => $('scenDialog').close();
$('scenDialog').addEventListener('click', e => { if (e.target === $('scenDialog')) $('scenDialog').close(); });
$('scenReset').onclick = () => { if (confirm('この端末の学習記録をすべて消去しますか？')) { resetRecords(); renderScenList(); } };

// ---------------- メインループ ----------------
let pendingMarkers = [];
let lastT = performance.now();
let scaleTimer = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  if (running) { sim.advance(dt * speed); gas.update(dt * speed); runner.tick(); }
  const { samples, markers } = sim.drain();
  const mks = pendingMarkers.concat(markers);
  let mi = 0;
  for (const sm of samples) {
    chPaw.push(sm.t, sm.paw, -sm.pmus, sm.seg);
    chFlow.push(sm.t, sm.flow);
    chVol.push(sm.t, sm.vol);
    // 印はサンプルを書いた後に付ける（書き込み時の消去で消えないように）
    while (mi < mks.length && mks[mi].t <= sm.t + 1e-9) {
      const mk = mks[mi++];
      if (mk.async) chPaw.asyncMark(mk.t, ASYNC_KEYS.indexOf(mk.async) + 1);
      else {
        loops.forEach(l => l.newBreath());
        lsf.endBreath(sim.settings.peep);
        if (mk.triggered) chPaw.mark(mk.t, 1);
      }
    }
    loops.forEach(l => l.push(sm));
    lsf.push(sm);
  }
  pendingMarkers = mks.slice(mi);
  scaleTimer += dt;
  if (scaleTimer > 0.5) { scaleTimer = 0; charts.forEach(c => c.autoscale()); }
  charts.forEach(c => c.draw());
  loops.forEach(l => l.draw());
  lung.update(sim.V, sim.V / (sim.eff.c / 1000), sim.flow, sim.pmus, running ? dt * speed : 0);
  if (running) alarms.update();
  updateAlarmBar();
  updateAsync();
  updateEffective();
  updateModeChip();
  updateTiles();
  updateMmp();
  updateMainControls();
  updateDynLung();
  updateBgaLive();
  checkManeuverResults();
  updateStatus();
  requestAnimationFrame(frame);
}

// シナリオ等で設定・患者を外部から変更したときに画面を同期する
export function syncUI() { renderModes(); renderParams(); renderPatient(); if (!$('tabAlarm').hidden) renderAlarmParams(); }

// ---------------- 表示スタイル（汎用 / Hamilton） ----------------
function applyVendor(key) {
  setVendor(key);
  applyChartLabels();
  renderModes();
  renderParams();
  if (!$('tabAlarm').hidden) renderAlarmParams();
  renderTiles();
  renderMmp();
  renderSweeps();
  dlCache = ''; dlInfo.innerHTML = '';
  alarmCache = ''; chipCache = '';
  if (runner.active) runner.render();
}
const selVendor = $('selVendor');
selVendor.innerHTML = Object.entries(VENDORS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
selVendor.value = vendorKey();
selVendor.onchange = e => applyVendor(e.target.value);

setVendor(vendorKey());
applyChartLabels();
renderModes();
renderParams();
renderPatient();
renderTiles();
renderMmp();
renderSweeps();
renderBgaLive();
renderAbg();
requestAnimationFrame(frame);
window.__sim = sim;
window.__syncUI = syncUI;
window.__gas = gas;
window.__runner = runner;

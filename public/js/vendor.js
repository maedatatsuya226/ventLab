// 表示スタイル（汎用 / Hamilton）：用語・単位・並びの差し替え定義
// 汎用は main.js / engine.js / alarms.js の既定定義をそのまま使い、ここでは上書き分だけを持つ。
// Hamilton は HAMILTON-C1/C3/C6（ソフトウェア 2.0 系）の公開資料（取扱説明書・仕様書）の表記に合わせている。

// I:E 表示（圧制限で吸気が打ち切られた呼吸などで極端な値になるときは --）
export const fmtIE = v => v == null || !isFinite(v) || v > 99 ? '--' : '1:' + v.toFixed(1);

export const VENDORS = {
  generic: { name: '汎用' },
  hamilton: {
    name: 'Hamilton',
    modes: {
      'VC-AC':    { name: '(S)CMV', jp: '量制御 強制換気（同期）' },
      'PC-AC':    { name: 'PCV+',   jp: '圧制御 強制換気' },
      'VC-SIMV':  { name: 'SIMV',   jp: '量制御 同期式間欠的強制換気' },
      'PC-SIMV':  { name: 'PSIMV+', jp: '圧制御 同期式間欠的強制換気' },
      'CPAP-PSV': { name: 'SPONT',  jp: '自発呼吸（Psupport / CPAP）' },
    },
    backupName: 'Apnea backup',
    params: {
      vt:    { label: 'Vt',        unit: 'ml' },
      rr:    { label: 'Rate',      unit: 'b/min' },
      ti:    { label: 'TI' },
      pause: { label: 'Tip',       jp: '吸気ポーズ時間' },
      pinsp: { label: 'Pcontrol',  jp: '吸気圧（PEEP上）', unit: 'cmH2O' },
      rise:  { label: 'P-ramp',    unit: 'ms', scale: 1000, dec: 0 },
      peep:  { label: 'PEEP/CPAP', unit: 'cmH2O' },
      ps:    { label: 'Psupport',  jp: '圧支持（PEEP上）', unit: 'cmH2O' },
      ets:   { label: 'ETS' },
      fio2:  { label: 'Oxygen' },
      apnea: { label: 'Apnea time' },
    },
    flow: { label: 'Flow pattern', options: { square: 'Square', decel: 'Decel. 100%' } },
    trig: { label: 'Trigger', flow: { label: 'Flow trigger', unit: 'l/min' }, pressure: { label: 'P-trigger', unit: 'cmH2O' } },
    // 画面右の丸い主要設定ボタン（実機はモードごとに 3 つ）
    mainControls: {
      'VC-AC': ['vt', 'peep', 'fio2'], 'VC-SIMV': ['vt', 'peep', 'fio2'],
      'PC-AC': ['pinsp', 'peep', 'fio2'], 'PC-SIMV': ['pinsp', 'peep', 'fio2'],
      'CPAP-PSV': ['ps', 'peep', 'fio2'],
    },
    alarmParams: {
      pmax:    { label: 'Pressure ↑',  unit: 'cmH2O' },
      plow:    { label: 'Pressure ↓',  unit: 'cmH2O' },
      vteHigh: { label: 'Vt ↑',        unit: 'ml' },
      vteLow:  { label: 'Vt ↓',        unit: 'ml' },
      mveHigh: { label: 'ExpMinVol ↑', unit: 'l/min' },
      mveLow:  { label: 'ExpMinVol ↓', unit: 'l/min' },
      rrHigh:  { label: 'fTotal ↑',    unit: 'b/min' },
      apnea:   { label: 'Apnea time' },
    },
    alarms: {
      disconnect: 'Disconnection on patient side',
      pmax:       'Pressure high',
      plow:       'Pressure low',
      apnea:      'Apnea',
      mveLow:     'Minute volume low',
      mveHigh:    'Minute volume high',
      vteLow:     'Vt low',
      vteHigh:    'Vt high',
      rrHigh:     'fTotal high',
      leak:       'Leak',
      backup:     'Apnea ventilation',
    },
    // 実測値（Monitoring ウィンドウ相当）。src: 'lsf' は呼吸ごとの最小二乗法（LSF）推定値
    tiles: [
      { k: 'pip',      label: 'Ppeak',     unit: 'cmH2O',  cls: 'paw', help: 'm_pip',   dec: 0 },
      { k: 'pmean',    label: 'Pmean',     unit: 'cmH2O',  cls: 'paw', help: 'm_pmean', dec: 0 },
      { k: 'pplat',    label: 'Pplateau',  unit: 'cmH2O',  cls: 'paw', help: 'm_pplat', dec: 0, stale: 'pplatAt' },
      { k: 'peep',     label: 'PEEP/CPAP', unit: 'cmH2O',  cls: 'paw', help: 'm_peep',  dec: 0 },
      { k: 'autoPeep', label: 'AutoPEEP',  unit: 'cmH2O',  cls: '',    help: 'h_autopeep', dec: 1, src: 'lsf' },
      { k: 'dp',       label: 'ΔP',        unit: 'cmH2O',  cls: 'paw', help: 'm_dp',    dec: 0, stale: 'pplatAt' },
      { k: 'vti',      label: 'VTI',       unit: 'ml',     cls: 'vol', help: 'm_vti',   dec: 0 },
      { k: 'vte',      label: 'VTE',       unit: 'ml',     cls: 'vol', help: 'm_vte',   dec: 0 },
      { k: 'mve',      label: 'ExpMinVol', unit: 'l/min',  cls: 'vol', help: 'm_mve',   dec: 1 },
      { k: 'rr',       label: 'fTotal',    unit: 'b/min',  cls: 'flow', help: 'm_rr',   dec: 0 },
      { k: 'rrSpont',  label: 'fSpont',    unit: 'b/min',  cls: 'flow', help: 'm_rrs',  dec: 0 },
      { k: 'ie',       label: 'I:E',       unit: '',       cls: 'flow', help: 'm_ie',   dec: 1, fmt: fmtIE },
      { k: 'ti',       label: 'TI',        unit: 's',      cls: '',    help: 'm_ti',    dec: 2 },
      { k: 'cstat',    label: 'Cstat',     unit: 'ml/cmH2O', cls: '',  help: 'h_cstat', dec: 0, src: 'lsf' },
      { k: 'rinsp',    label: 'Rinsp',     unit: 'cmH2O/(l/s)', cls: '', help: 'h_rinsp', dec: 0, src: 'lsf' },
      { k: 'rcexp',    label: 'RCexp',     unit: 's',      cls: '',    help: 'h_rcexp', dec: 2, src: 'lsf' },
      { k: 'rsbi',     label: 'RSB',       unit: '1/(l*min)', cls: '', help: 'm_rsbi',  dec: 0 },
    ],
    // 主要モニタリング値 MMP（画面左に常時表示。C3 の既定 5 項目）。hi / lo は横に小さく出すアラーム上下限
    mmp: [
      { k: 'pip', label: 'Ppeak',     unit: 'cmH2O', hi: 'pmax', lo: 'plow' },
      { k: 'mve', label: 'ExpMinVol', unit: 'l/min', dec: 1, hi: 'mveHigh', lo: 'mveLow', hiDec: 1 },
      { k: 'vte', label: 'VTE',       unit: 'ml',    hi: 'vteHigh', lo: 'vteLow' },
      { k: 'rr',  label: 'fTotal',    unit: 'b/min', hi: 'rrHigh', lo: null },
      { k: 'ie',  label: 'I:E',       unit: '',      fmt: fmtIE },
    ],
    charts: {
      paw:  { label: 'Paw',    unit: 'cmH2O', limit: true },
      flow: { label: 'Flow',   unit: 'l/min' },
      vol:  { label: 'Volume', unit: 'ml' },
      pv:   { title: 'P/V',    xLabel: 'Paw cmH2O', yLabel: 'V ml' },
      fv:   { title: 'V/Flow', xLabel: 'V ml',      yLabel: 'Flow l/min' },
    },
    sweeps: [7, 14, 21, 28],
    // 解説文・シナリオ文中の用語の置き換え（語境界で一致するものだけ）
    terms: [
      ['CPAP/PSV', 'SPONT'], ['VC-AC', '(S)CMV'], ['PC-AC', 'PCV+'], ['VC-SIMV', 'SIMV'], ['PC-SIMV', 'PSIMV+'],
      ['PIP', 'Ppeak'], ['Pplat', 'Pplateau'], ['Pinsp', 'Pcontrol'], ['VTe', 'VTE'], ['VTi', 'VTI'],
      ['MVe', 'ExpMinVol'], ['PS', 'Psupport'], ['RSBI', 'RSB'], ['FiO₂', 'Oxygen'], ['Raw', 'Rinsp'],
      ['VT', 'Vt'], ['mL', 'ml'], ['L', 'l'], ['cmH₂O', 'cmH2O'],
    ],
  },
};

let current = 'generic';
try { const v = localStorage.getItem('vs-vendor'); if (VENDORS[v]) current = v; } catch (e) {}

export const vendorKey = () => current;
export const vendor = () => VENDORS[current];
export function setVendor(key) {
  current = VENDORS[key] ? key : 'generic';
  try { localStorage.setItem('vs-vendor', current); } catch (e) {}
  document.documentElement.dataset.vendor = current;
}

// 用語置き換え（汎用では何もしない）
const esc = s => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const termCache = {};
export function term(text) {
  const v = vendor();
  if (!v.terms || typeof text !== 'string') return text;
  const re = termCache[current] || (termCache[current] = new RegExp(
    '(?<![A-Za-z0-9])(' + v.terms.map(([a]) => esc(a)).join('|') + ')(?![A-Za-z0-9])', 'g'));
  const map = Object.fromEntries(v.terms);
  return text.replace(re, m => map[m]);
}

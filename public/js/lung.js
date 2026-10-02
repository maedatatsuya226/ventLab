// 肺・横隔膜・気道のアニメーション（SVG）
// setDynamic(true) で Hamilton の Dynamic Lung 風の表示：
//   肺の大きさ = 身長から求めた「正常」に対する換気量、輪郭 = Cstat、気管支の太さ・色 = Rinsp、
//   横隔膜 = 患者トリガー時だけ表示、回路外れでしぼみ、AutoPEEP 大で過膨張

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
};

// 左右の肺（右肺＝画面左）
const RIGHT_LUNG = 'M92 62 C70 66 52 92 46 128 C40 164 42 196 50 214 C62 222 92 214 112 204 C120 200 124 190 124 176 L124 86 C124 72 108 60 92 62 Z';
const LEFT_LUNG  = 'M148 62 C170 66 188 92 194 128 C200 164 198 196 190 214 C178 222 150 216 132 206 C126 200 124 190 124 180 L124 86 C124 72 134 60 148 62 Z';
// 右肺の気管支樹（左肺は x = 120 で左右反転して使う）
const BRONCHI = 'M94 100 C84 112 76 124 70 140 M70 140 C64 156 60 170 58 188 M70 140 C76 156 80 172 82 192 ' +
  'M94 100 C98 120 100 140 98 160 M98 160 C94 174 92 186 94 202 M98 160 C104 172 108 182 110 196 ' +
  'M82 120 C72 118 62 122 54 130 M76 130 C66 136 58 146 52 156';

// 呼吸力学の区分（Hamilton は Cstat 4 段階・Rinsp 3 段階で描き分ける。境界値は一般的な目安）
export const cstatClass = c => c == null ? null : c < 25 ? 'vlow' : c < 45 ? 'low' : c <= 85 ? 'normal' : 'high';
export const rinspClass = r => r == null ? null : r <= 15 ? 'normal' : r <= 25 ? 'mod' : 'high';
const C_SCALE = { vlow: 0.8, low: 0.9, normal: 1, high: 1.08 };

export class LungView {
  constructor(host) {
    const svg = el('svg', { viewBox: '0 0 240 250', role: 'img', 'aria-label': '肺の動き' }, host);
    this.svg = svg;
    // 胸郭
    el('path', { d: 'M30 60 C26 120 26 190 36 232 L204 232 C214 190 214 120 210 60', class: 'lv-chest' }, svg);
    for (let i = 0; i < 5; i++) {
      const yy = 84 + i * 30;
      el('path', { d: `M34 ${yy} C70 ${yy + 14} 100 ${yy + 10} 118 ${yy + 2}`, class: 'lv-rib' }, svg);
      el('path', { d: `M206 ${yy} C170 ${yy + 14} 140 ${yy + 10} 122 ${yy + 2}`, class: 'lv-rib' }, svg);
    }
    this.lungs = el('g', {}, svg);
    this.rl = el('path', { d: RIGHT_LUNG, class: 'lv-lung' }, this.lungs);
    this.ll = el('path', { d: LEFT_LUNG, class: 'lv-lung' }, this.lungs);
    this.br = el('g', { class: 'lv-br' }, this.lungs);
    el('path', { d: BRONCHI }, this.br);
    el('path', { d: BRONCHI, transform: 'translate(240 0) scale(-1 1)' }, this.br);
    // 気管・気管チューブ
    el('path', { d: 'M114 6 L114 76 L94 100 M126 6 L126 76 L146 100', class: 'lv-airway' }, svg);
    el('rect', { x: 115, y: 0, width: 10, height: 58, rx: 3, class: 'lv-tube' }, svg);
    this.dots = [];
    for (let i = 0; i < 5; i++) this.dots.push(el('circle', { cx: 120, cy: 10, r: 2.4, class: 'lv-dot' }, svg));
    // 横隔膜
    this.dia = el('path', { d: '', class: 'lv-dia' }, svg);
    this.txt = el('text', { x: 120, y: 246, 'text-anchor': 'middle', class: 'lv-text' }, svg);
    this.phase = 0;
    this.clock = 0;
    this.trigAt = -10;
    this.setDynamic(false);
    this.setMechanics({});
  }

  setDynamic(on) {
    this.dynamic = on;
    this.br.style.display = on ? '' : 'none';
    this.txt.style.display = on ? 'none' : '';
  }

  // Dynamic Lung：LSF の Rinsp / Cstat で気管支と肺の輪郭を描き分ける
  setMechanics({ rinsp = null, cstat = null }) {
    const rc = rinspClass(rinsp), cc = cstatClass(cstat);
    this.br.setAttribute('class', 'lv-br' + (rc ? ' r-' + rc : ''));
    this.cClass = cc;
  }

  // 患者トリガーの吸気開始（Dynamic Lung では横隔膜を短時間表示）
  trigger() { this.trigAt = this.clock; }

  // V: 弛緩位からの肺容量 [L], palv: 肺胞内弾性圧, flow: L/s, pmus: 吸気努力
  // opt: { pbw [kg], disconnected, overinflated }（Dynamic Lung 用）
  update(V, palv, flow, pmus, dt, opt = {}) {
    this.clock += dt;
    const dyn = this.dynamic;
    // 肺の大きさ：Dynamic Lung では身長（PBW）から求めた正常な肺の大きさに対する比
    const full = dyn && opt.pbw ? 1.4 * opt.pbw / 70 : 1.4;
    let f = Math.max(0, Math.min(1, (V + 0.1) / full));
    let k = dyn ? C_SCALE[this.cClass] || 1 : 1;
    let state = '';
    if (dyn && opt.disconnected) { f = 0; k *= 0.72; state = ' deflated'; }
    else if (dyn && opt.overinflated) { k *= 1.12; state = ' overinflated'; }
    const sx = (0.82 + 0.22 * f) * k, sy = (0.80 + 0.30 * f) * Math.min(1.12, k);
    this.lungs.setAttribute('transform', `translate(124 62) scale(${sx.toFixed(3)} ${sy.toFixed(3)}) translate(-124 -62)`);
    const cls = (dyn ? 'lv-lung' + (this.cClass ? ' c-' + this.cClass : '')
      : palv >= 30 ? 'lv-lung over' : palv >= 25 ? 'lv-lung warn' : 'lv-lung') + state;
    this.rl.setAttribute('class', cls); this.ll.setAttribute('class', cls);

    const base = 62 + 158 * sy;           // 肺底部
    if (dyn) {
      // 患者トリガーの吸気開始から 0.8 秒だけ横隔膜を表示
      const age = this.clock - this.trigAt;
      const show = age >= 0 && age < 0.8;
      this.dia.setAttribute('d', `M36 ${base + 12} Q80 ${base - 14} 120 ${base - 2} Q160 ${base - 14} 204 ${base + 12}`);
      this.dia.setAttribute('class', 'lv-dia trig');
      this.dia.style.opacity = show ? (1 - Math.max(0, age - 0.5) / 0.3).toFixed(2) : '0';
    } else {
      const dome = Math.max(8, 30 - pmus * 1.2);   // 吸気努力で横隔膜が平坦化
      this.dia.setAttribute('d', `M36 ${base + 12} Q80 ${base - dome} 120 ${base - 2} Q160 ${base - dome} 204 ${base + 12}`);
      this.dia.setAttribute('class', pmus > 0.5 ? 'lv-dia active' : 'lv-dia');
      this.dia.style.opacity = '';
    }

    // 気流の粒子
    this.phase += flow * dt * 70;
    const show = Math.abs(flow) > 0.02;
    this.dots.forEach((d, i) => {
      const y = 6 + (((this.phase + i * 14) % 70) + 70) % 70;
      d.setAttribute('cy', y.toFixed(1));
      d.style.opacity = show ? Math.min(1, Math.abs(flow) * 2).toFixed(2) : '0';
    });
    this.txt.textContent = `Palv ${palv.toFixed(1)} cmH₂O`;
  }
}

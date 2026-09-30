// 肺・横隔膜・気道のアニメーション（SVG）

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
    // 気管・気管チューブ
    el('path', { d: 'M114 6 L114 76 L94 100 M126 6 L126 76 L146 100', class: 'lv-airway' }, svg);
    el('rect', { x: 115, y: 0, width: 10, height: 58, rx: 3, class: 'lv-tube' }, svg);
    this.dots = [];
    for (let i = 0; i < 5; i++) this.dots.push(el('circle', { cx: 120, cy: 10, r: 2.4, class: 'lv-dot' }, svg));
    // 横隔膜
    this.dia = el('path', { d: '', class: 'lv-dia' }, svg);
    this.txt = el('text', { x: 120, y: 246, 'text-anchor': 'middle', class: 'lv-text' }, svg);
    this.phase = 0;
  }

  // V: 弛緩位からの肺容量 [L], palv: 肺胞内弾性圧, flow: L/s, pmus: 吸気努力
  update(V, palv, flow, pmus, dt) {
    const f = Math.max(0, Math.min(1, (V + 0.1) / 1.4));
    const sx = 0.82 + 0.22 * f, sy = 0.80 + 0.30 * f;
    this.lungs.setAttribute('transform', `translate(124 62) scale(${sx.toFixed(3)} ${sy.toFixed(3)}) translate(-124 -62)`);
    const cls = palv >= 30 ? 'lv-lung over' : palv >= 25 ? 'lv-lung warn' : 'lv-lung';
    this.rl.setAttribute('class', cls); this.ll.setAttribute('class', cls);

    const base = 62 + 158 * sy;           // 肺底部
    const dome = Math.max(8, 30 - pmus * 1.2);   // 吸気努力で横隔膜が平坦化
    this.dia.setAttribute('d', `M36 ${base + 12} Q80 ${base - dome} 120 ${base - 2} Q160 ${base - dome} 204 ${base + 12}`);
    this.dia.setAttribute('class', pmus > 0.5 ? 'lv-dia active' : 'lv-dia');

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

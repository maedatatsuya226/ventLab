// 波形（スイープ表示）とループ表示

const NICE = [5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 120, 150, 200, 250, 300, 400, 500, 600, 800, 1000, 1200, 1500, 2000, 3000];
export const niceCeil = x => NICE.find(n => n >= x) ?? Math.ceil(x / 1000) * 1000;

export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

const SEG_COLORS = ['', '--seg-mand', '--seg-assist', '--seg-spont'];

export class SweepChart {
  // opts: { label, unit, color, overlayColor, kind: 'paw'|'flow'|'vol', showSeg }
  constructor(canvas, opts) {
    this.canvas = canvas;
    this.o = opts;
    this.rate = 100;
    this.setWindow(10);
    this.lo = opts.kind === 'flow' ? -60 : opts.kind === 'paw' ? -5 : 0;
    this.hi = opts.kind === 'flow' ? 60 : opts.kind === 'paw' ? 30 : 600;
    this.last = null;
    this.showOverlay = false;
  }

  setWindow(sec) {
    this.win = sec;
    this.n = Math.round(sec * this.rate);
    this.data = new Float32Array(this.n).fill(NaN);
    this.over = new Float32Array(this.n).fill(NaN);
    this.seg = new Uint8Array(this.n);
    this.marks = new Int8Array(this.n);
    this.amarks = new Int8Array(this.n);
    this.idx = 0;
  }

  push(t, v, over, seg) {
    const i = Math.floor((t % this.win) * this.rate) % this.n;
    this.data[i] = v;
    this.over[i] = over ?? NaN;
    this.seg[i] = seg || 0;
    this.marks[i] = 0;
    this.amarks[i] = 0;
    const gap = Math.round(this.rate * 0.25);
    for (let k = 1; k <= gap; k++) {
      const j = (i + k) % this.n;
      this.data[j] = NaN; this.over[j] = NaN; this.seg[j] = 0; this.marks[j] = 0; this.amarks[j] = 0;
    }
    this.idx = i;
    this.last = v;
  }

  mark(t, code) {
    const i = Math.floor((t % this.win) * this.rate) % this.n;
    this.marks[i] = code;
  }

  // 非同調の印（code = ASYNC ラベル配列の添字 + 1）
  asyncMark(t, code) {
    const i = Math.floor((t % this.win) * this.rate) % this.n;
    this.amarks[i] = code;
  }

  autoscale() {
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < this.n; i++) {
      const v = this.data[i];
      if (v === v) { if (v < mn) mn = v; if (v > mx) mx = v; }
      if (this.showOverlay) {
        const o = this.over[i];
        if (o === o && o < mn) mn = o;
      }
    }
    if (mn === Infinity) return;
    const k = this.o.kind;
    if (k === 'flow') {
      const a = niceCeil(Math.max(40, Math.abs(mn), Math.abs(mx)) * 1.1);
      this.lo = -a; this.hi = a;
    } else if (k === 'paw') {
      const lim = typeof this.o.limit === 'function' ? this.o.limit() : 0;
      this.hi = niceCeil(Math.max(20, mx * 1.1, lim * 1.05));
      this.lo = mn < -4 ? -niceCeil(-mn * 1.1) : -5;
    } else {
      this.hi = niceCeil(Math.max(300, mx * 1.1));
      this.lo = mn < -30 ? -niceCeil(-mn * 1.1) : 0;
    }
  }

  draw() {
    const { ctx, w, h } = fitCanvas(this.canvas);
    const padL = 34, padR = 8, padT = 20, padB = this.o.showSeg ? 8 : 4;
    const pw = w - padL - padR, ph = h - padT - padB;
    const y = v => padT + (this.hi - v) / (this.hi - this.lo) * ph;
    const x = i => padL + i / (this.n - 1) * pw;
    ctx.clearRect(0, 0, w, h);

    // グリッド
    const grid = cssVar('--grid'), axis = cssVar('--muted'), zero = cssVar('--zero');
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    const range = this.hi - this.lo;
    const step = range <= 40 ? 10 : range <= 80 ? 20 : range <= 200 ? 50 : range <= 400 ? 100 : range <= 1000 ? 200 : 500;
    for (let v = Math.ceil(this.lo / step) * step; v <= this.hi; v += step) {
      const yy = Math.round(y(v)) + 0.5;
      ctx.strokeStyle = v === 0 ? zero : grid;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke();
      ctx.fillStyle = axis;
      ctx.fillText(String(v), padL - 4, yy);
    }
    for (let s = 1; s < this.win; s++) {
      const xx = Math.round(padL + s / this.win * pw) + 0.5;
      ctx.strokeStyle = grid;
      ctx.beginPath(); ctx.moveTo(xx, padT); ctx.lineTo(xx, padT + ph); ctx.stroke();
    }

    // 吸気区分バー（強制 / 補助 / 自発）
    if (this.o.showSeg) {
      const cols = SEG_COLORS.map(c => c && cssVar(c));
      for (let i = 0; i < this.n; i++) {
        const sg = this.seg[i];
        if (!sg || this.data[i] !== this.data[i]) continue;
        ctx.fillStyle = cols[sg];
        ctx.fillRect(x(i), h - 5, pw / this.n + 0.6, 4);
      }
    }

    // 波形
    const line = (arr, color, dash, width) => {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i < this.n; i++) {
        const v = arr[i];
        if (v !== v) { pen = false; continue; }
        const yy = Math.max(padT - 2, Math.min(padT + ph + 2, y(v)));
        if (!pen) { ctx.moveTo(x(i), yy); pen = true; } else ctx.lineTo(x(i), yy);
      }
      ctx.stroke(); ctx.setLineDash([]);
    };
    // 上限圧アラーム（Pressure ↑）の線
    if (typeof this.o.limit === 'function') {
      const lv = this.o.limit();
      if (lv <= this.hi) {
        const yy = Math.round(y(lv)) + 0.5;
        ctx.strokeStyle = cssVar('--alarm'); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke();
      }
    }
    if (this.showOverlay) line(this.over, cssVar(this.o.overlayColor), [4, 3], 1.5);
    line(this.data, cssVar(this.o.color), [], 2);

    // 患者トリガーの印
    ctx.fillStyle = cssVar('--trigger');
    for (let i = 0; i < this.n; i++) {
      if (this.marks[i] !== 1) continue;
      const xx = x(i);
      ctx.beginPath(); ctx.moveTo(xx, padT + 1); ctx.lineTo(xx - 4, padT - 6); ctx.lineTo(xx + 4, padT - 6); ctx.closePath(); ctx.fill();
    }

    // 非同調の印
    if (this.o.asyncLabels) {
      ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      const col = cssVar('--async'), bg = cssVar('--panel');
      for (let i = 0; i < this.n; i++) {
        const code = this.amarks[i];
        if (!code) continue;
        const label = this.o.asyncLabels[code - 1];
        const xx = x(i), tw = ctx.measureText(label).width + 6;
        ctx.fillStyle = bg; ctx.fillRect(xx - tw / 2, padT + 2, tw, 14);
        ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.strokeRect(xx - tw / 2 + 0.5, padT + 2.5, tw - 1, 13);
        ctx.fillStyle = col; ctx.fillText(label, xx, padT + 4);
        ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(xx, padT + 16); ctx.lineTo(xx, padT + ph); ctx.stroke(); ctx.setLineDash([]);
      }
    }

    // ラベル
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = cssVar(this.o.color);
    ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(this.o.label, padL + 4, 13);
    const lw = ctx.measureText(this.o.label).width;
    ctx.fillStyle = axis; ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(this.o.unit, padL + 10 + lw, 13);
    if (this.showOverlay && this.o.overlayLabel) {
      ctx.fillStyle = cssVar(this.o.overlayColor);
      ctx.textAlign = 'right';
      ctx.fillText(this.o.overlayLabel, w - padR - 4, 13);
    }
  }
}

export class LoopChart {
  // opts: { xKey, yKey, xLabel, yLabel, color }
  constructor(canvas, opts) {
    this.canvas = canvas;
    this.o = opts;
    this.cur = []; this.prev = []; this.ref = null;
  }
  push(sm) { this.cur.push([sm[this.o.xKey], sm[this.o.yKey]]); if (this.cur.length > 3000) this.cur.shift(); }
  newBreath() { if (this.cur.length > 5) this.prev = this.cur; this.cur = []; }
  captureRef() { this.ref = this.prev.length ? this.prev.slice() : null; }
  clearRef() { this.ref = null; }

  draw() {
    const { ctx, w, h } = fitCanvas(this.canvas);
    const padL = 34, padR = 8, padT = 18, padB = 18;
    const pw = w - padL - padR, ph = h - padT - padB;
    ctx.clearRect(0, 0, w, h);
    const all = [...this.cur, ...this.prev, ...(this.ref || [])];
    let xmn = this.o.xMin ?? 0, xmx = 10, ymn = this.o.yMin ?? 0, ymx = 10;
    for (const [a, b] of all) {
      if (a < xmn) xmn = a; if (a > xmx) xmx = a;
      if (b < ymn) ymn = b; if (b > ymx) ymx = b;
    }
    if (this.o.symY) { const m = niceCeil(Math.max(Math.abs(ymn), Math.abs(ymx), 30) * 1.1); ymn = -m; ymx = m; }
    else { ymx = niceCeil(ymx * 1.1); ymn = ymn < -5 ? -niceCeil(-ymn * 1.1) : Math.min(0, ymn); }
    xmx = niceCeil(Math.max(xmx * 1.1, this.o.xMinSpan ?? 20));
    xmn = xmn < -2 ? -niceCeil(-xmn * 1.1) : Math.min(0, xmn);
    const X = v => padL + (v - xmn) / (xmx - xmn) * pw;
    const Y = v => padT + (ymx - v) / (ymx - ymn) * ph;

    const grid = cssVar('--grid'), axis = cssVar('--muted'), zero = cssVar('--zero');
    ctx.strokeStyle = grid; ctx.lineWidth = 1;
    ctx.strokeRect(padL + 0.5, padT + 0.5, pw, ph);
    ctx.strokeStyle = zero;
    if (ymn < 0 && ymx > 0) { ctx.beginPath(); ctx.moveTo(padL, Y(0)); ctx.lineTo(padL + pw, Y(0)); ctx.stroke(); }
    if (xmn < 0 && xmx > 0) { ctx.beginPath(); ctx.moveTo(X(0), padT); ctx.lineTo(X(0), padT + ph); ctx.stroke(); }
    ctx.fillStyle = axis; ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(String(ymx), padL - 4, padT + 4); ctx.fillText(String(ymn), padL - 4, padT + ph - 4);
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(String(xmn), padL + 8, padT + ph + 4); ctx.fillText(String(xmx), padL + pw - 10, padT + ph + 4);
    ctx.fillText(this.o.xLabel, padL + pw / 2, padT + ph + 4);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = cssVar(this.o.color);
    ctx.fillText(this.o.title, padL + 4, 13);
    ctx.fillStyle = axis; ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(this.o.yLabel, padL + 10 + ctx.measureText(this.o.title).width * 1.1, 13);

    const path = (pts, color, width, dash, alpha) => {
      if (pts.length < 2) return;
      ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
      ctx.beginPath(); ctx.moveTo(X(pts[0][0]), Y(pts[0][1]));
      for (let i = 1; i < pts.length; i++) ctx.lineTo(X(pts[i][0]), Y(pts[i][1]));
      ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    };
    if (this.ref) path(this.ref, cssVar('--ref'), 1.5, [5, 4], 1);
    path(this.prev, cssVar(this.o.color), 1.5, [], 0.35);
    path(this.cur, cssVar(this.o.color), 2, [], 1);
  }
}

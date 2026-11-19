/* canvas.js — CanvasRenderingContext2D para el juego, sobre ps.cv_* (native/canvas.c).
 * Guarda en JS lo que el juego puede volver a leer (fillStyle, font...) y manda a C
 * cada cambio. Lo que no se dibuja (sombras, filter) se acepta y se ignora.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
(() => {
  const OPS = ['source-over', 'source-in', 'source-out', 'source-atop', 'destination-over', 'destination-in',
               'destination-out', 'destination-atop', 'xor', 'copy'];
  const CAPS = ['butt', 'round', 'square'], JOINS = ['miter', 'round', 'bevel'];
  const ALIGN = { left: 0, start: 0, center: 1, right: 2, end: 2 };
  const BASE = { alphabetic: 0, ideographic: 0, top: 1, hanging: 1, middle: 2, bottom: 3 };
  const P = { ALPHA: 0, OP: 1, LINE_WIDTH: 2, LINE_CAP: 3, LINE_JOIN: 4, ALIGN: 5, BASELINE: 6 };

  class Gradient {
    constructor(radial, c) { this.radial = radial; this.c = c; this.stops = []; }
    addColorStop(o, color) { this.stops.push(+o, String(color)); }
  }

  class Ctx2D {
    constructor(canvas) {
      this.canvas = canvas;
      this.id = canvas._sid;
      this._reset();
      // Ignorados (no se dibujan), pero el juego los asigna y los lee.
      this.shadowBlur = 0; this.shadowColor = 'rgba(0,0,0,0)'; this.shadowOffsetX = 0; this.shadowOffsetY = 0;
      this.filter = 'none'; this.imageSmoothingEnabled = false; this.imageSmoothingQuality = 'low';
      this.lineDashOffset = 0; this.miterLimit = 10; this.direction = 'inherit'; this.letterSpacing = '0px';
    }

    get fillStyle() { return this._s.fillStyle; }
    set fillStyle(v) { this._paint(false, v); }
    get strokeStyle() { return this._s.strokeStyle; }
    set strokeStyle(v) { this._paint(true, v); }
    _paint(stroke, v) {
      // El mismo color que ya tiene (las partículas lo ponen en cada una): no hace falta volver a mandarlo a C.
      if (typeof v === 'string' && v === this._s[stroke ? 'strokeStyle' : 'fillStyle']) return;
      if (v instanceof Gradient) {
        const c = v.c;
        ps.cv_gradient(this.id, stroke, v.radial, c[0], c[1], c[2], c[3], c[4], c[5], v.stops);
      } else if (!ps.cv_color(this.id, stroke, String(v))) return;   // color inválido: el navegador lo ignora
      this._s[stroke ? 'strokeStyle' : 'fillStyle'] = v;
    }

    get globalAlpha() { return this._s.globalAlpha; }
    set globalAlpha(v) { v = +v; if (!(v >= 0 && v <= 1) || v === this._s.globalAlpha) return; this._s.globalAlpha = v; ps.cv_set(this.id, P.ALPHA, v); }
    get globalCompositeOperation() { return this._s.globalCompositeOperation; }
    set globalCompositeOperation(v) {
      const i = OPS.indexOf(v);
      if (i < 0) return;   // 'lighter', 'multiply'...: no están, se queda la anterior
      this._s.globalCompositeOperation = v; ps.cv_set(this.id, P.OP, i);
    }
    get lineWidth() { return this._s.lineWidth; }
    set lineWidth(v) { v = +v; if (!(v > 0)) return; this._s.lineWidth = v; ps.cv_set(this.id, P.LINE_WIDTH, v); }
    get lineCap() { return this._s.lineCap; }
    set lineCap(v) { const i = CAPS.indexOf(v); if (i >= 0) { this._s.lineCap = v; ps.cv_set(this.id, P.LINE_CAP, i); } }
    get lineJoin() { return this._s.lineJoin; }
    set lineJoin(v) { const i = JOINS.indexOf(v); if (i >= 0) { this._s.lineJoin = v; ps.cv_set(this.id, P.LINE_JOIN, i); } }
    get textAlign() { return this._s.textAlign; }
    set textAlign(v) { if (v in ALIGN) { this._s.textAlign = v; ps.cv_set(this.id, P.ALIGN, ALIGN[v]); } }
    get textBaseline() { return this._s.textBaseline; }
    set textBaseline(v) { if (v in BASE) { this._s.textBaseline = v; ps.cv_set(this.id, P.BASELINE, BASE[v]); } }
    get font() { return this._s.font; }
    set font(v) {
      // "bold 16px Pixelify": de la familia no se hace caso (sólo está la fuente del juego).
      const m = /(\d+(?:\.\d+)?)px/.exec(v);
      if (!m) return;
      this._s.font = v;
      ps.cv_font(this.id, +m[1], /bold|\b[6-9]00\b/.test(v));
    }

    // El estado de un lienzo recién creado o al que se le cambia el tamaño (en C se reinicia igual: cv_resize).
    _reset() {
      this._s = { fillStyle: '#000000', strokeStyle: '#000000', globalAlpha: 1, globalCompositeOperation: 'source-over',
                  lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', font: '10px sans-serif', textAlign: 'start',
                  textBaseline: 'alphabetic', lineDash: [] };
      this._stack = [];
    }
    save() { this._stack.push(Object.assign({}, this._s)); ps.cv_save(this.id); }
    restore() { if (this._stack.length) { this._s = this._stack.pop(); ps.cv_restore(this.id); } }
    setTransform(a, b, c, d, e, f) {
      if (typeof a === 'object' && a) ({ a, b, c, d, e, f } = a);
      ps.cv_setTransform(this.id, a, b, c, d, e, f);
    }
    resetTransform() { ps.cv_setTransform(this.id, 1, 0, 0, 1, 0, 0); }
    transform(a, b, c, d, e, f) { ps.cv_transform(this.id, a, b, c, d, e, f); }
    translate(x, y) { ps.cv_translate(this.id, x, y); }
    scale(x, y) { ps.cv_scale(this.id, x, y); }
    rotate(a) { ps.cv_rotate(this.id, a); }

    // _p: el punto actual (en coordenadas de usuario), para arcTo.
    beginPath() { ps.cv_path(this.id, 0); this._p = null; }
    closePath() { ps.cv_path(this.id, 1); }
    moveTo(x, y) { ps.cv_path(this.id, 2, x, y); this._p = [x, y]; }
    lineTo(x, y) { ps.cv_path(this.id, 3, x, y); this._p = [x, y]; }
    quadraticCurveTo(cx, cy, x, y) { ps.cv_path(this.id, 4, cx, cy, x, y); this._p = [x, y]; }
    bezierCurveTo(a, b, c, d, x, y) { ps.cv_path(this.id, 5, a, b, c, d, x, y); this._p = [x, y]; }
    arc(x, y, r, a0, a1, ccw) { ps.cv_path(this.id, 6, x, y, r, a0, a1, !!ccw); this._p = [x + r * Math.cos(a1), y + r * Math.sin(a1)]; }
    ellipse(x, y, rx, ry, rot, a0, a1, ccw) {
      ps.cv_path(this.id, 7, x, y, rx, ry, rot, a0, a1, !!ccw);
      const ex = rx * Math.cos(a1), ey = ry * Math.sin(a1);
      this._p = [x + ex * Math.cos(rot) - ey * Math.sin(rot), y + ex * Math.sin(rot) + ey * Math.cos(rot)];
    }
    rect(x, y, w, h) { ps.cv_path(this.id, 8, x, y, w, h); this._p = [x, y]; }
    // arcTo: el arco de radio r tangente a (p0→p1) y (p1→p2), como en el navegador.
    arcTo(x1, y1, x2, y2, r) {
      if (!this._p) return this.moveTo(x1, y1);
      const [x0, y0] = this._p;
      const ax = x0 - x1, ay = y0 - y1, bx = x2 - x1, by = y2 - y1;
      const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by), cross = ax * by - ay * bx;
      if (!r || !la || !lb || Math.abs(cross) < 1e-9) return this.lineTo(x1, y1);
      const ang = Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)))), d = r / Math.tan(ang / 2);
      const t0x = x1 + ax / la * d, t0y = y1 + ay / la * d, t1x = x1 + bx / lb * d, t1y = y1 + by / lb * d;
      // El centro, a r de los dos lados, hacia dentro del ángulo.
      const nx = ax / la + bx / lb, ny = ay / la + by / lb, nl = Math.hypot(nx, ny), h = Math.hypot(d, r);
      const cx = x1 + nx / nl * h, cy = y1 + ny / nl * h;
      this.lineTo(t0x, t0y);
      this.arc(cx, cy, r, Math.atan2(t0y - cy, t0x - cx), Math.atan2(t1y - cy, t1x - cx), cross > 0);
    }
    // (las llamadas a C directamente: con arc() cada esquina calculaba y guardaba su punto final, que aquí no hace falta)
    roundRect(x, y, w, h, r) {
      r = Math.min(Array.isArray(r) ? r[0] || 0 : +r || 0, Math.abs(w) / 2, Math.abs(h) / 2);
      if (!r) return this.rect(x, y, w, h);
      const id = this.id, P = Math.PI;
      ps.cv_path(id, 2, x + r, y);
      ps.cv_path(id, 6, x + w - r, y + r, r, -P / 2, 0, false);
      ps.cv_path(id, 6, x + w - r, y + h - r, r, 0, P / 2, false);
      ps.cv_path(id, 6, x + r, y + h - r, r, P / 2, P, false);
      ps.cv_path(id, 6, x + r, y + r, r, P, P * 1.5, false);
      ps.cv_path(id, 1);
      this._p = [x + r, y];
    }
    fill(rule) { ps.cv_paint(this.id, 0, rule === 'evenodd'); }
    stroke() { ps.cv_paint(this.id, 1); }
    clip() { ps.cv_paint(this.id, 2); }
    fillRect(x, y, w, h) { ps.cv_paint(this.id, 3, x, y, w, h); }
    strokeRect(x, y, w, h) { ps.cv_paint(this.id, 4, x, y, w, h); }
    clearRect(x, y, w, h) { ps.cv_paint(this.id, 5, x, y, w, h); }
    isPointInPath() { return false; }

    setLineDash(a) { if (Array.isArray(a)) { this._s.lineDash = a.slice(); ps.cv_dash(this.id, a, this.lineDashOffset); } }
    getLineDash() { return this._s.lineDash.slice(); }

    fillText(t, x, y, max) { ps.cv_text(this.id, false, String(t), x, y, max); }
    strokeText(t, x, y, max) { ps.cv_text(this.id, true, String(t), x, y, max); }
    measureText(t) {
      const size = +(/(\d+(?:\.\d+)?)px/.exec(this._s.font) || [0, 10])[1];
      return { width: ps.cv_measure(this.id, String(t)), actualBoundingBoxAscent: size * 0.8, actualBoundingBoxDescent: size * 0.2,
               fontBoundingBoxAscent: size * 0.8, fontBoundingBoxDescent: size * 0.2, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 };
    }

    createLinearGradient(x0, y0, x1, y1) { return new Gradient(false, [x0, y0, 0, x1, y1, 0]); }
    createRadialGradient(x0, y0, r0, x1, y1, r1) { return new Gradient(true, [x0, y0, r0, x1, y1, r1]); }
    createPattern() { return null; }

    drawImage(img, a, b, c, d, e, f, g, h) {
      const sid = img && img._sid;
      if (sid == null || sid < 0) return;           // imagen sin cargar: el navegador no dibuja nada
      const iw = img.width, ih = img.height;
      if (e === undefined) {                         // (img, dx, dy[, dw, dh])
        ps.cv_draw(this.id, sid, 0, 0, iw, ih, a, b, c === undefined ? iw : c, d === undefined ? ih : d);
      } else {
        ps.cv_draw(this.id, sid, a, b, c, d, e, f, g, h);
      }
    }

    // El destello (sprites.js drawWhite): la silueta en blanco la pinta la GPU, sin copia blanca de la hoja.
    // false si no puede (con giro o recorte por la CPU): el juego usa entonces su copia blanca.
    psWhite(img, a, b, c, d, e, f, g, h) {
      const sid = img && img._sid;
      if (sid == null || sid < 0) return true;      // sin cargar: nada que pintar
      if (e === undefined) return ps.cv_draw(this.id, sid, 0, 0, img.width, img.height, a, b, c, d, 1) === true;
      return ps.cv_draw(this.id, sid, a, b, c, d, e, f, g, h, 1) === true;
    }

    createImageData(w, h) {
      if (typeof w === 'object') ({ width: w, height: h } = w);
      return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    }
    getImageData(x, y, w, h) { return { width: w, height: h, data: new Uint8ClampedArray(ps.cv_getImageData(this.id, x, y, w, h)) }; }
    putImageData(img, dx, dy) { ps.cv_putImageData(this.id, img.data, img.width, img.height, dx, dy); }
  }

  globalThis.CanvasRenderingContext2D = Ctx2D;
  globalThis.CanvasGradient = Gradient;
})();

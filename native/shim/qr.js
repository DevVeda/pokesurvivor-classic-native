/* qr.js — código QR para enseñar en la tele un enlace que se abre con el móvil (YouTube, Ko-fi y lo que la web
 * abriría en otra pestaña). Lo justo: modo byte, corrección L, versiones 1-5 (hasta 106 bytes), máscara 0 (los
 * lectores aceptan cualquiera; la elección por penalización sólo afina). Sigue el algoritmo de Nayuki (MIT).
 *   psQR(texto) -> { size, dark(x, y) } | null si no cabe
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
(() => {
  // Por versión (1-5), corrección L, un solo bloque: palabras de datos y de corrección.
  const DATA = [0, 19, 34, 55, 80, 108], ECC = [0, 7, 10, 15, 20, 26];

  const mul = (x, y) => {   // producto en GF(2^8) con el polinomio 0x11D
    let z = 0;
    for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; }
    return z & 0xff;
  };
  function eccOf(data, n) {   // Reed-Solomon: el resto de dividir los datos por el generador de grado n
    const div = new Array(n).fill(0);
    div[n - 1] = 1;
    let root = 1;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) { div[j] = mul(div[j], root); if (j + 1 < n) div[j] ^= div[j + 1]; }
      root = mul(root, 2);
    }
    const r = new Array(n).fill(0);
    for (const b of data) {
      const f = b ^ r.shift();
      r.push(0);
      div.forEach((c, i) => { r[i] ^= mul(c, f); });
    }
    return r;
  }

  globalThis.psQR = text => {
    const bytes = [...unescape(encodeURIComponent(String(text)))].map(c => c.charCodeAt(0));
    let v = 1;
    while (v <= 5 && 4 + 8 + bytes.length * 8 > DATA[v] * 8) v++;
    if (v > 5) return null;
    // Datos: modo byte (0100), longitud (8 bits), los bytes, fin (hasta 4 ceros) y relleno 0xEC 0x11.
    const bits = [];
    const put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(4, 4); put(bytes.length, 8); bytes.forEach(b => put(b, 8));
    const cap = DATA[v] * 8;
    put(0, Math.min(4, cap - bits.length));
    while (bits.length % 8) bits.push(0);
    for (let p = 0xec; bits.length < cap; p ^= 0xec ^ 0x11) put(p, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
    const words = data.concat(eccOf(data, ECC[v]));

    const size = 17 + 4 * v, mod = [], fn = [];
    for (let y = 0; y < size; y++) { mod.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }
    const set = (x, y, d) => { mod[y][x] = d; fn[y][x] = true; };
    // Patrones fijos: sincronía, los tres buscadores, el de alineación (v >= 2) y el sitio del formato.
    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]])
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
    if (v >= 2) {
      const a = size - 7;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(a + dx, a + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    const format = () => {   // corrección L (01), máscara 0, con su BCH(15,5)
      const d = 1 << 3;
      let r = d;
      for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      const b = ((d << 10) | r) ^ 0x5412, bit = i => ((b >>> i) & 1) === 1;
      for (let i = 0; i <= 5; i++) set(8, i, bit(i));
      set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
      set(8, size - 8, true);   // el módulo oscuro fijo
    };
    format();
    // Los datos en zigzag desde abajo a la derecha, por parejas de columnas (la 6 es de sincronía), con la máscara 0.
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
        if (fn[y][x]) continue;
        const d = i < words.length * 8 ? ((words[i >>> 3] >>> (7 - (i & 7))) & 1) === 1 : false;
        mod[y][x] = d !== ((x + y) % 2 === 0);
        i++;
      }
    }
    return { size, dark: (x, y) => x >= 0 && y >= 0 && x < size && y < size && mod[y][x] };
  };
})();

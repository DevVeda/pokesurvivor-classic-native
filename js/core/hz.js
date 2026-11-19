/* ============ hz.js — extensiones de trampas ============
 * Si el navegador tiene una extensión de trampas (PokéSurvivor Companion / «sobrevida»):
 * Object.prototype tocado, sus variables en window o su HTML en la página, al rato se tapa el juego
 * con un aviso para desactivarla. G.Hz.v (0 nada, 1 prototipo, 2 window, 3 HTML): db.js no sube la partida.
 * Las cadenas van cifradas (XOR) para que la extensión no las encuentre buscando texto.
 */
G.Hz = (() => {
  const dec = a => String.fromCharCode(...a.map((c, i) => c ^ (90 + 13 * i) & 255));
  const WIN = [5, 56, 4, 242, 227, 244, 204, 201, 157, 144, 172, 154, 155, 108, 116, 83, 121, 75, 27, 14, 45, 4, 26, 247, 247, 233, 197, 221, 167, 131, 137, 129, 149, 115, 123];   // __psmod|__psmodNS|__sobrevidaPiloto
  const DOM = [121, 20, 27, 227, 252, 254, 222, 220, 166, 174, 241, 129, 153, 112, 100, 49, 9, 68, 50, 124, 61, 4, 20, 228, 191, 252, 223, 202, 234, 240, 147, 155, 215, 100, 123, 77, 79, 22, 34, 58, 5, 0, 80, 210, 255, 199, 238, 128, 232, 167, 151, 156, 145, 111, 53, 7, 111, 19, 23, 58, 10, 18, 243, 254, 176, 154, 150, 177, 189, 182, 135, 145, 47, 45, 65];   // #sobrevida-host,#sv-cola-css,#sv-cola-jogo,[id^="psmod-"],[class*="psmod-"]
  const PROTO = [57, 8, 26, 242, 250, 233, 221, 214, 182, 160, 174, 149, 169, 92, 116, 120, 76, 94, 42, 52, 25, 14, 12, 241, 247, 237, 243, 230, 186, 140, 191, 137, 159, 97, 125, 79, 75, 104, 45, 33, 22, 10, 14, 214, 201, 223, 216, 220, 185, 152, 147, 159, 174, 121, 119, 85, 87, 77, 56, 32, 26, 44, 223, 225, 245, 200, 223, 180, 190, 156, 141, 129, 118, 106, 110, 118, 105, 63, 15, 2, 6, 24, 235, 250, 235, 219, 235, 160, 166, 171, 137, 139, 89, 76, 92, 68, 73, 23, 38, 14, 26, 20, 252, 236, 210, 202, 243, 175, 170, 147, 130, 146, 122, 114, 86, 69, 71, 2, 43, 32, 28, 10, 225, 252, 212, 210, 162, 161, 191, 155, 128, 110, 93, 111, 90, 92, 44, 40, 32, 31, 23, 239, 229, 248, 229, 209, 184, 142, 129, 155, 138, 106, 102, 112, 115, 102, 58, 39, 15, 33, 21, 228, 245, 205, 203, 232, 188, 167, 139, 129, 155];   // las propiedades de serie de Object.prototype
  const MSG = {
    es: [102, 23, 74, 189, 236, 165, 253, 219, 163, 239, 185, 145, 130, 102, 126, 110, 67, 196, 42, 113, 58, 14, 20, 165, 252, 254, 218, 220, 161, 178, 132, 130, 136, 39, 122, 78, 14, 94, 59, 117, 1, 0, 17, 249, 247, 215, 217, 223, 166, 178, 196, 146, 145, 101, 56, 64, 94, 31, 38, 44, 3, 20, 239, 163, 166, 136, 214, 255, 242, 244, 152, 203, 62, 127, 34, 109, 83, 48, 49, 62, 30, 30, 242, 240, 190, 199, 217, 182, 242, 186, 148, 141, 99, 125, 83, 68, 85, 41, 49, 18, 78, 31, 237, 181, 199, 220, 200, 168, 246, 148, 149, 159, 42, 63, 71, 89, 76, 36, 53, 0, 72, 80, 163, 252, 222, 199, 165, 163, 169, 142, 155, 111, 125, 50, 8, 76, 98, 61, 57, 10, 23, 241, 247, 252, 138, 219, 165, 241, 174, 10, 159, 108, 124, 126, 12, 73, 39, 33, 1, 77, 16, 242, 243, 192, 220, 149, 244, 250, 146, 209, 128, 91, 115, 64, 81, 79, 45, 54, 22],
    en: [102, 23, 74, 189, 236, 165, 233, 149, 160, 189, 179, 158, 133, 102, 98, 61, 79, 79, 48, 52, 48, 24, 17, 234, 252, 191, 197, 202, 230, 189, 143, 153, 218, 100, 123, 76, 94, 90, 60, 60, 0, 3, 25, 169, 225, 202, 196, 213, 234, 163, 140, 148, 222, 108, 121, 72, 87, 17, 112, 118, 4, 77, 188, 162, 234, 153, 136, 177, 240, 159, 129, 134, 99, 109, 112, 76, 22, 55, 56, 56, 74, 18, 252, 229, 251, 197, 203, 172, 189, 177, 159, 217, 96, 124, 82, 13, 78, 47, 61, 18, 78, 8, 225, 225, 199, 143, 148, 170, 190, 145, 159, 144, 111, 45, 11, 30, 91, 51, 44, 0, 28, 12, 229, 246, 200, 192, 233, 237, 187, 137, 144, 33, 124, 126, 68, 90, 35, 43, 124, 29, 30, 230, 176, 237, 203, 208, 161, 241, 170, 132, 216, 117, 126, 126, 85, 23, 122, 124, 16, 83, 6, 213, 241, 205, 193, 218, 172]
  };
  let v = 0, shown = false, timer = 0;
  function detect() {
    if (v) return v;
    try {
      const own = dec(PROTO).split('|');
      if (Object.getOwnPropertyNames(Object.prototype).some(k => !own.includes(k))) v = 1;
      else if (dec(WIN).split('|').some(k => k in window)) v = 2;
      else if (document.querySelector(dec(DOM))) v = 3;
    } catch (e) {}
    return v;
  }
  function show() {
    if (shown) return;
    shown = true;
    const en = !/^es/i.test(G.I18n && G.I18n.lang || navigator.language || '');
    const [text, btn] = dec(en ? MSG.en : MSG.es).split('|');
    const el = document.createElement('div');
    el.setAttribute('translate', 'no');
    el.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:#0b1020;color:#fff;font-family:Pixelify,system-ui,sans-serif;text-align:center;padding:20px';
    el.innerHTML = '<div style="max-width:560px"><h1 style="color:#ffd23f;margin:0 0 12px">PokéSurvivor</h1>' + text + '<button style="margin-top:14px;padding:8px 18px;font:inherit;cursor:pointer">' + btn + '</button></div>';
    el.querySelector('button').onclick = () => location.reload();
    (document.body || document.documentElement).appendChild(el);
  }
  // El aviso, al rato (6-20 s) y no al cargar: que no se sepa qué lo ha disparado.
  function later() {
    if (!timer && !shown) timer = setTimeout(show, 6000 + 14000 * Math.random());
  }
  detect();
  function boot() {
    setInterval(() => { if (detect()) later(); }, 2500 + 2000 * Math.random());
    if (detect()) later();
    return false;
  }
  return { boot, get v() { return v; } };
})();

;

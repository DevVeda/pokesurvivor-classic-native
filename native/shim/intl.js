/* intl.js — Intl para QuickJS, que no lo trae (lo cargan browser.js y tiles-worker.js: el hilo del suelo tiene que
 * saber la misma fecha que el juego, o cree que no es Halloween y pinta el suelo normal).
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
// Intl: sólo lo que usa el juego. La fecha de "hoy" en Madrid (tienda y ranking cambian a medianoche
// de Madrid): UTC+1, y UTC+2 desde el último domingo de marzo hasta el último de octubre (a la 01:00 UTC).
if (typeof Intl === 'undefined') {
  const lastSunday = (y, m) => { const d = new Date(Date.UTC(y, m + 1, 0, 1)); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.getTime(); };
  const madrid = date => {
    const t = date.getTime(), y = date.getUTCFullYear();
    const summer = t >= lastSunday(y, 2) && t < lastSunday(y, 9);
    return new Date(t + (summer ? 2 : 1) * 3600000);
  };
  const pad = n => String(n).padStart(2, '0');
  // Números con los separadores del idioma (sin locale: el del sistema, ps.LANG) y notation 'compact' (9,8 M).
  // ponytail: tabla corta (las familias de separadores, no CLDR entero); sin Intl, un idioma raro sale como el inglés.
  const HOST = (typeof ps !== 'undefined' && ps.LANG) || 'es-ES';
  const sepOf = loc => {
    const l = String(Array.isArray(loc) ? loc[0] : loc || HOST).toLowerCase(), b = l.split(/[-_]/)[0];
    if (/^(fr|ru|pl|cs|sk|uk|sv|fi|nb|no|nn|hu|bg|lt|lv|et)$/.test(b) || l === 'pt-pt') return [' ', ',', b];
    if (/^(es|de|it|pt|nl|da|id|tr|el|ro|hr|sl|sr|ca|vi)$/.test(b)) return ['.', ',', b];
    return [',', '.', b];
  };
  const SHORT = { es: [' mil', ' M', ' mil M'], pt: [' mil', ' mi', ' bi'], fr: [' k', ' M', ' Md'], de: [' Tsd.', ' Mio.', ' Mrd.'],
                  it: ['K', ' Mln', ' Mrd'], en: ['K', 'M', 'B'] };
  function numFmt(n, loc, o = {}) {
    n = +n;
    if (!isFinite(n)) return String(n);
    const [g, d, b] = sepOf(loc);
    if (o.notation === 'compact' && Math.abs(n) >= 1000) {
      const e = Math.min(3, Math.floor(Math.log10(Math.abs(n)) / 3)), v = n / 1000 ** e;
      const f = o.maximumFractionDigits == null ? (Math.abs(v) < 100 ? 1 : 0) : o.maximumFractionDigits;
      return numFmt(+v.toFixed(f), loc, {}) + (SHORT[b] || SHORT.en)[e - 1];
    }
    const f = o.maximumFractionDigits == null ? 3 : o.maximumFractionDigits;
    let [i, frac = ''] = Math.abs(+n.toFixed(f)).toString().split('.');
    frac = frac.padEnd(o.minimumFractionDigits || 0, '0');
    if (i.length > (b === 'es' ? 4 : 3)) i = i.replace(/\B(?=(\d{3})+$)/g, g);   // (es: 1234 sin punto, como CLDR)
    return (n < 0 ? '-' : '') + i + (frac ? d + frac : '');
  }
  // QuickJS: Number#toLocaleString es toString (sin separadores).
  Number.prototype.toLocaleString = function (loc, o) { return numFmt(this, loc, o); };
  globalThis.Intl = {
    DateTimeFormat: class DateTimeFormat {
      constructor(loc, o = {}) { this.o = o; }
      // Sólo los campos pedidos (sin ninguno, año-mes-día), en el orden de en-CA: 2026-10-30, 07:05.
      formatToParts(date = new Date()) {
        const d = this.o.timeZone === 'Europe/Madrid' ? madrid(new Date(+date)) : new Date(+date), o = this.o;
        const any = ['year', 'month', 'day', 'hour', 'minute'].some(k => o[k]);
        const want = k => (any ? o[k] : k === 'year' || k === 'month' || k === 'day');
        const out = [], add = (type, value, sep) => { if (out.length) out.push({ type: 'literal', value: sep }); out.push({ type, value }); };
        if (want('year')) add('year', String(d.getUTCFullYear()), '-');
        if (want('month')) add('month', pad(d.getUTCMonth() + 1), '-');
        if (want('day')) add('day', pad(d.getUTCDate()), '-');
        if (want('hour')) add('hour', pad(d.getUTCHours()), ', ');
        if (want('minute')) add('minute', pad(d.getUTCMinutes()), ':');
        return out;
      }
      format(date) { return this.formatToParts(date).map(p => p.value).join(''); }
      resolvedOptions() { return { locale: 'es-ES', timeZone: this.o.timeZone || 'UTC' }; }
    },
    ListFormat: class ListFormat {
      constructor(loc) { this.and = /^en/.test(loc) ? ' and ' : /^fr/.test(loc) ? ' et ' : /^it/.test(loc) ? ' e ' : /^pt/.test(loc) ? ' e ' : /^zh/.test(loc) ? '和' : ' y '; }
      format(a) { a = [...a]; return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + this.and + a[a.length - 1]; }
    },
    NumberFormat: class NumberFormat {
      constructor(loc, o = {}) { this.loc = loc; this.o = o; }
      format(n) { return numFmt(n, this.loc, this.o); }
    },
    PluralRules: class PluralRules { select(n) { return n === 1 ? 'one' : 'other'; } },
    Collator: class Collator { compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; } },
  };
}

// Recibe el informe de tools/ps5/probe.html desde la PS5 y lo guarda aquí al lado.
// Uso: node tools/ps5/probe-recv.cjs   (escucha en el puerto 8787)
const http = require('http'), fs = require('fs'), path = require('path');
const PORT = +process.env.PORT || 8787;

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.end('ok');
  let body = '';
  req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
  req.on('end', () => {
    let rep;
    try { rep = JSON.parse(body); } catch (e) { res.statusCode = 400; return res.end('json'); }
    const file = path.join(__dirname, `probe-report-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(rep, null, 2));
    for (const [k, r] of Object.entries(rep.results || {}))
      console.log(`${r.ok === null ? '…' : r.ok ? 'sí' : 'NO'}\t${k}\t${r.info || ''}`);
    console.log('Guardado en', file);
    res.end('ok');
  });
}).listen(PORT, () => {
  const ips = Object.values(require('os').networkInterfaces()).flat()
    .filter(i => i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log(`Esperando informe en http://${ips[0] || 'IP-DEL-MAC'}:${PORT}`);
});

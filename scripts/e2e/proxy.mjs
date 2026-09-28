// Minimal stand-in for the Supabase API gateway: /auth/v1 -> GoTrue, /rest/v1 -> PostgREST
import http from 'node:http';
const routes = [['/auth/v1', 9999], ['/rest/v1', 3000]];
http.createServer((req, res) => {
  const cors = { 'access-control-allow-origin': req.headers.origin || '*', 'access-control-allow-headers': req.headers['access-control-request-headers'] || '*', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'access-control-expose-headers': 'content-range, x-total-count', 'access-control-allow-credentials': 'true' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const r = routes.find(([p]) => req.url.startsWith(p));
  if (!r) { res.writeHead(404, cors); return res.end('not found'); }
  const headers = { ...req.headers, host: `127.0.0.1:${r[1]}` };
  const up = http.request({ host: '127.0.0.1', port: r[1], path: req.url.slice(r[0].length) || '/', method: req.method, headers }, (u) => {
    const h = { ...u.headers, ...cors };
    res.writeHead(u.statusCode, h); u.pipe(res);
  });
  up.on('error', (e) => { res.writeHead(502, cors); res.end(String(e)); });
  req.pipe(up);
}).listen(54321, '127.0.0.1', () => console.log('proxy on 54321'));

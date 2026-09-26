import http from 'node:http';

const args = process.argv;
const cwd = args[args.indexOf('--workspace') + 1];
const port = Number(args[args.indexOf('--port') + 1]);
http.createServer(async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"status":"ok"}');
    return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ cwd, path: req.url, body: Buffer.concat(chunks).toString() }));
}).listen(port, '127.0.0.1');

import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'

const listenPort = Number(process.env.CODER_PREVIEW_PORT || 4172)
const listenHost = process.env.CODER_PREVIEW_BIND || '127.0.0.1'
const blockedPorts = new Set([2375, 2376, 4170, 4171, 4172, 4173, 11434])

function target(req) {
  const host = (req.headers.host || '').split(':')[0].toLowerCase()
  const match = /^p(s?)(\d{1,5})\.localhost$/.exec(host)
  const port = match ? Number(match[2]) : 0
  if (!match || port < 1 || port > 65535 || blockedPorts.has(port)) return null
  return { secure: Boolean(match[1]), port }
}

function proxy(req, res) {
  const selected = target(req)
  if (!selected) {
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end('{"error":"Invalid preview host."}')
    return
  }
  const transport = selected.secure ? https : http
  const upstream = transport.request({
    hostname: '127.0.0.1', port: selected.port, path: req.url,
    method: req.method, rejectUnauthorized: false,
    headers: { ...req.headers, host: `localhost:${selected.port}` },
  }, incoming => {
    const headers = { ...incoming.headers }
    if (typeof headers.location === 'string') {
      try {
        const location = new URL(headers.location)
        if (['localhost', '127.0.0.1'].includes(location.hostname)
          && Number(location.port || (location.protocol === 'https:' ? 443 : 80)) === selected.port) {
          headers.location = `${location.pathname}${location.search}${location.hash}`
        }
      } catch { /* Relative redirects already remain on the gateway origin. */ }
    }
    res.writeHead(incoming.statusCode || 502, headers)
    incoming.pipe(res)
  })
  upstream.on('error', error => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: error.message }))
    } else res.destroy(error)
  })
  req.on('aborted', () => upstream.destroy())
  req.pipe(upstream)
}

function upgrade(req, socket, head) {
  const selected = target(req)
  if (!selected) return socket.destroy()
  const upstream = selected.secure
    ? tls.connect({ host: '127.0.0.1', port: selected.port, rejectUnauthorized: false })
    : net.connect({ host: '127.0.0.1', port: selected.port })
  upstream.on('error', () => socket.destroy())
  socket.on('error', () => upstream.destroy())
  upstream.once(selected.secure ? 'secureConnect' : 'connect', () => {
    const headers = []
    for (let index = 0; index < req.rawHeaders.length; index += 2) {
      const name = req.rawHeaders[index]
      headers.push(`${name}: ${name.toLowerCase() === 'host' ? `localhost:${selected.port}` : req.rawHeaders[index + 1]}`)
    }
    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers.join('\r\n')}\r\n\r\n`)
    if (head.length) upstream.write(head)
    socket.pipe(upstream).pipe(socket)
  })
}

const server = http.createServer(proxy)
server.on('upgrade', upgrade)
server.listen(listenPort, listenHost, () => console.log(`PeakUI private preview bridge listening on ${listenHost}:${listenPort}`))


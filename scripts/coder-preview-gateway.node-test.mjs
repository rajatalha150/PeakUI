import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHmac } from 'node:crypto'
import http from 'node:http'
import net from 'node:net'
import { after, before, test } from 'node:test'

const secret = 'test-preview-secret-that-is-long-enough-for-production'
let bridge
let gateway
let bridgePort
let gatewayPort

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => resolve(address.port))
    })
  })
}

function ticket(port = 8081) {
  const payload = Buffer.from(JSON.stringify({ p: port, s: false, e: Math.floor(Date.now() / 1000) + 300, u: 'admin-1' })).toString('base64url')
  const signature = createHmac('sha256', secret).update(`peakui-preview:${payload}`).digest('base64url')
  return `${payload}.${signature}`
}

function waitForPort(port) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 5_000
    const attempt = () => {
      const socket = net.connect(port, '127.0.0.1')
      socket.once('connect', () => { socket.destroy(); resolve() })
      socket.once('error', () => Date.now() < deadline ? setTimeout(attempt, 25) : reject(new Error('gateway did not start')))
    }
    attempt()
  })
}

before(async () => {
  bridgePort = await freePort()
  gatewayPort = await freePort()
  bridge = http.createServer((req, res) => {
    assert.equal(req.headers.host, `p8081.localhost:${bridgePort}`)
    if (req.url === '/login') {
      res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'app_session=abc; Domain=localhost; HttpOnly; Path=/' })
      res.end('<h1>Login</h1>')
      return
    }
    if (req.url === '/api/me') {
      const authenticated = req.headers.cookie === 'app_session=abc'
      res.writeHead(authenticated ? 200 : 401, { 'content-type': 'application/json' })
      res.end(JSON.stringify(authenticated ? { id: 'user-1' } : { error: 'unauthorized' }))
      return
    }
    res.writeHead(302, { location: '/login' })
    res.end()
  })
  await new Promise(resolve => bridge.listen(bridgePort, '127.0.0.1', resolve))
  gateway = spawn(process.execPath, ['scripts/coder-preview-gateway.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      JWT_SECRET: secret,
      CODER_PREVIEW_GATEWAY_PORT: String(gatewayPort),
      CODER_PREVIEW_BRIDGE_URL: `http://127.0.0.1:${bridgePort}`,
    },
    stdio: 'inherit',
  })
  await waitForPort(gatewayPort)
})

after(async () => {
  gateway?.kill('SIGTERM')
  await new Promise(resolve => bridge?.close(resolve))
})

test('launches at a clean root and preserves application authentication cookies', async () => {
  const launch = await fetch(`http://127.0.0.1:${gatewayPort}/__peakui/open?ticket=${encodeURIComponent(ticket())}&path=%2F`, { redirect: 'manual' })
  assert.equal(launch.status, 302)
  assert.equal(launch.headers.get('location'), '/')
  const route = launch.headers.get('set-cookie')?.split(';')[0]
  assert.ok(route?.startsWith('__peakui_preview_route='))

  const root = await fetch(`http://127.0.0.1:${gatewayPort}/`, { headers: { cookie: route }, redirect: 'manual' })
  assert.equal(root.status, 302)
  assert.equal(root.headers.get('location'), '/login')

  const login = await fetch(`http://127.0.0.1:${gatewayPort}/login`, { headers: { cookie: route } })
  assert.equal(await login.text(), '<h1>Login</h1>')
  assert.equal(login.headers.get('set-cookie'), 'app_session=abc; HttpOnly; Path=/')

  const me = await fetch(`http://127.0.0.1:${gatewayPort}/api/me`, { headers: { cookie: `${route}; app_session=abc` } })
  assert.equal(me.status, 200)
  assert.deepEqual(await me.json(), { id: 'user-1' })
})

test('rejects direct and tampered access', async () => {
  assert.equal((await fetch(`http://127.0.0.1:${gatewayPort}/__peakui/health`)).status, 200)
  assert.equal((await fetch(`http://127.0.0.1:${gatewayPort}/`)).status, 401)
  assert.equal((await fetch(`http://127.0.0.1:${gatewayPort}/__peakui/open?ticket=${ticket()}x`)).status, 401)
})

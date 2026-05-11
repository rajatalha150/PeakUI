import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'

const SCREENCAST_PORT = parseInt(process.env.SCREENCAST_PORT || '3001', 10)

// Start the Next.js standalone server by importing it
const { default: nextServer } = await import('./server.js')

// The Next.js standalone server creates an HTTP server on the PORT env var.
// We need to find it and attach our WebSocket handler.
// Since Next.js standalone creates its own server, we'll use a different approach:
// Start a separate WebSocket server that the client can connect to directly.

// For same-origin WebSocket, the client connects to the same host at /ws/screencast
// We need to intercept the upgrade on the Next.js HTTP server.
// Unfortunately, Next.js standalone doesn't expose its HTTP server easily.

// Strategy: Run a small HTTP+WS proxy on the same port 3000 that forwards
// HTTP to Next.js and handles WebSocket upgrades at /ws/screencast.

console.log('[start-with-ws] Starting PeakUI with WebSocket support...')
console.log('[start-with-ws] Screencast WebSocket will be available at /ws/screencast')
console.log('[start-with-ws] Also starting standalone WS server on port', SCREENCAST_PORT)
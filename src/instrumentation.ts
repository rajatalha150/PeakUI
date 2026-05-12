export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    console.log('[screencast] register() called, setting up...')
    const screencast = await import('./lib/screencast-server')
    screencast.startScreencastServer()

    // Find the Next.js HTTP server by searching active handles for a TCP server
    // listening on the Next.js port. We check for handle._server (TCP handle → server)
    // and also for handles that are http.Server instances directly.
    const http = await import('node:http')
    const nextPort = parseInt(process.env.PORT || '3000', 10)

    const findAndAttach = (): boolean => {
      const handles = (process as any)._getActiveHandles?.() || []
      for (const handle of handles) {
        // Check if this is a TCP server listening on our port
        const server = handle?._server ?? handle
        if (server instanceof http.Server) {
          const addr = server.address()
          if (addr && typeof addr === 'object' && addr.port === nextPort) {
            try {
              screencast.attachToHttpServer(server)
              console.log(`[screencast] Attached WebSocket upgrade handler to Next.js HTTP server at /ws/screencast (port ${nextPort})`)
              return true
            } catch (err) {
              console.warn('[screencast] Could not attach to HTTP server:', err instanceof Error ? err.message : String(err))
            }
          }
        }
      }
      return false
    }

    // Try immediately
    if (!findAndAttach()) {
      // Poll every 500ms for up to 10 seconds
      let attempts = 0
      const interval = setInterval(() => {
        attempts++
        if (findAndAttach()) {
          clearInterval(interval)
        } else if (attempts >= 20) {
          console.warn('[screencast] Could not find Next.js HTTP server after 10s — WebSocket only available on standalone port 3001')
          clearInterval(interval)
        }
      }, 500)
    }

    // Graceful shutdown
    const cleanup = async () => {
      await screencast.stopScreencastServer()
      process.exit(0)
    }
    process.on('SIGTERM', cleanup)
    process.on('SIGINT', cleanup)
  }
}
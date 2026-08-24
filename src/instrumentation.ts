export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    console.log('[live-browser] register() called, setting up...')
    const liveBrowser = await import('./lib/live-browser-server')
    liveBrowser.startLiveBrowserServer()
    const automationWorker = await import('./lib/workspace-tool-automation-worker')
    automationWorker.startWorkspaceToolAutomationWorker()

    // Find the Next.js HTTP server by searching active handles for a TCP server
    // listening on the Next.js port. We check for handle._server (TCP handle → server)
    // and also for handles that are http.Server instances directly.
    const http = await import('node:http')
    const nextPort = parseInt(process.env.PORT || '3000', 10)
    const processWithHandles = process as typeof process & {
      _getActiveHandles?: () => unknown[]
    }

    const findAndAttach = (): boolean => {
      const handles = processWithHandles._getActiveHandles?.() || []
      for (const handle of handles) {
        // Check if this is a TCP server listening on our port
        const server = typeof handle === 'object' && handle !== null && '_server' in handle
          ? (handle as { _server?: unknown })._server ?? handle
          : handle
        if (server instanceof http.Server) {
          const addr = server.address()
          if (addr && typeof addr === 'object' && addr.port === nextPort) {
            try {
              liveBrowser.attachToHttpServer(server)
              console.log(`[live-browser] Attached WebSocket upgrade handler to Next.js HTTP server (port ${nextPort})`)
              return true
            } catch (err) {
              console.warn('[live-browser] Could not attach to HTTP server:', err instanceof Error ? err.message : String(err))
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
          console.warn('[live-browser] Could not find Next.js HTTP server after 10s — standalone bridge remains available on port 3001')
          clearInterval(interval)
        }
      }, 500)
    }

    // Graceful shutdown
    const cleanup = async () => {
      automationWorker.stopWorkspaceToolAutomationWorker()
      await liveBrowser.stopLiveBrowserServer()
      process.exit(0)
    }
    process.on('SIGTERM', cleanup)
    process.on('SIGINT', cleanup)
  }
}

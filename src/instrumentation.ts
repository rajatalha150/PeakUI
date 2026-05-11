export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startScreencastServer } = await import('./lib/screencast-server')
    startScreencastServer()

    // Try to attach WebSocket upgrade handler to Next.js HTTP server
    // This enables same-origin WebSocket at /ws/screencast (no separate port needed)
    setTimeout(async () => {
      try {
        const { attachToHttpServer } = await import('./lib/screencast-server')
        // Find the HTTP server from active handles
        const handles = (process as any)._getActiveHandles?.() || []
        const http = await import('node:http')
        for (const handle of handles) {
          if (handle?._server && handle._server instanceof http.Server) {
            attachToHttpServer(handle._server)
            console.log('[screencast] Attached WebSocket upgrade handler to Next.js HTTP server at /ws/screencast')
            break
          }
        }
      } catch (err) {
        console.warn('[screencast] Could not attach to Next.js HTTP server:', err instanceof Error ? err.message : String(err))
        console.warn('[screencast] WebSocket will only be available on standalone port')
      }
    }, 1000) // Wait for Next.js server to be ready

    // Graceful shutdown
    const cleanup = async () => {
      const { stopScreencastServer } = await import('./lib/screencast-server')
      await stopScreencastServer()
      process.exit(0)
    }
    process.on('SIGTERM', cleanup)
    process.on('SIGINT', cleanup)
  }
}
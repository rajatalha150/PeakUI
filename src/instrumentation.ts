export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startScreencastServer } = await import('./lib/screencast-server')
    startScreencastServer()

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
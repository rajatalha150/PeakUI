import {
  runAutomationTick,
  updateAutomationWorkerSnapshot,
} from './openclaw-automation'

const globalForAutomationWorker = globalThis as unknown as {
  openClawAutomationWorkerStarted?: boolean
  openClawAutomationWorkerTimer?: ReturnType<typeof setInterval>
}

const AUTOMATION_TICK_MS = 30_000

export function startOpenClawAutomationWorker() {
  if (globalForAutomationWorker.openClawAutomationWorkerStarted) {
    return
  }

  globalForAutomationWorker.openClawAutomationWorkerStarted = true
  updateAutomationWorkerSnapshot({
    running: true,
    startedAt: new Date().toISOString(),
    lastError: null,
  })

  const tick = async () => {
    try {
      await runAutomationTick()
      updateAutomationWorkerSnapshot({ lastError: null })
    } catch (error) {
      updateAutomationWorkerSnapshot({
        lastError: error instanceof Error ? error.message : String(error),
      })
      console.error('[openclaw/automation] Worker tick failed:', error)
    }
  }

  void tick()
  globalForAutomationWorker.openClawAutomationWorkerTimer = setInterval(() => {
    void tick()
  }, AUTOMATION_TICK_MS)
}

export function stopOpenClawAutomationWorker() {
  if (globalForAutomationWorker.openClawAutomationWorkerTimer) {
    clearInterval(globalForAutomationWorker.openClawAutomationWorkerTimer)
    globalForAutomationWorker.openClawAutomationWorkerTimer = undefined
  }
  globalForAutomationWorker.openClawAutomationWorkerStarted = false
  updateAutomationWorkerSnapshot({ running: false })
}

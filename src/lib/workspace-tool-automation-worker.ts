import {
  runAutomationTick,
  updateAutomationWorkerSnapshot,
} from './workspace-tool-automation'

const globalForAutomationWorker = globalThis as unknown as {
  workspaceToolAutomationWorkerStarted?: boolean
  workspaceToolAutomationWorkerTimer?: ReturnType<typeof setInterval>
}

const AUTOMATION_TICK_MS = 30_000

export function startWorkspaceToolAutomationWorker() {
  if (globalForAutomationWorker.workspaceToolAutomationWorkerStarted) {
    return
  }

  globalForAutomationWorker.workspaceToolAutomationWorkerStarted = true
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
      console.error('[workspace-tool/automation] Worker tick failed:', error)
    }
  }

  void tick()
  globalForAutomationWorker.workspaceToolAutomationWorkerTimer = setInterval(() => {
    void tick()
  }, AUTOMATION_TICK_MS)
}

export function stopWorkspaceToolAutomationWorker() {
  if (globalForAutomationWorker.workspaceToolAutomationWorkerTimer) {
    clearInterval(globalForAutomationWorker.workspaceToolAutomationWorkerTimer)
    globalForAutomationWorker.workspaceToolAutomationWorkerTimer = undefined
  }
  globalForAutomationWorker.workspaceToolAutomationWorkerStarted = false
  updateAutomationWorkerSnapshot({ running: false })
}

# PeakUI Coder Runtime — durable facts

Pinned facts about this coding runtime that should survive every session and
never be consolidated away. Treat this as read-only orientation.

## Environment

- Workspace volumes: `/workspace` (primary project cwd) and `/apps` (second
  project root). Both are persistent mounted volumes.
- Runtime image: Node 22 + Java 17 (`$JAVA_HOME`), Android SDK/NDK
  (`$ANDROID_SDK_ROOT`), Go, Python 3, and a real-browser verification harness
  under `/opt/qwen-code/browser/`.
- Persistent state: Coder config at `~/.qwen/`, SSH/Git identity at `/root/.ssh`,
  caches at `/root/.gradle`, `/root/.android`, `/root/.npm`, `/root/.cache/pip`.
- Model routing: Ollama is reached via the `openai` auth type over
  `http://127.0.0.1:11434/v1`. The daemon's model list is synced from Ollama's
  `/api/tags` at boot (`sync-coder-models.mjs`).

## Verification expectations

- A passing test/typecheck/build is the evidence of record — always report the
  command and its output, never claim "it works" without it.
- Real browser checks: `node /opt/qwen-code/browser/verify-site.mjs <site-dir>`
  (run from `/opt/qwen-code/browser`). Screenshots are readable — the main model
  is vision-capable and a vision bridge is configured.

## Safety boundaries (do not violate)

- Never run broad cleanup (`apt autoremove`, `apt clean`, `rm -rf /root`,
  recursive SDK/cache deletion). Do not delete `/usr/lib/jvm`,
  `/opt/android-sdk`, `/root/.gradle`, `/root/.android`, `/root/.npm`,
  `/root/.qwen`, `/root/.ssh`, `/workspace`, or `/apps`.
- Never overwrite or delete user files to "simplify" a task.

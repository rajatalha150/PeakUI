---
name: Headless browser verification setup
description: Chrome/puppeteer harness baked into the image at /opt/qwen-code/browser — reusable, present on every fresh VM, no downloads needed
type: reference
---

**The browser harness is baked into the image and always present.** Do NOT claim
"no browser" or "no Chromium" — both Chrome builds are installed at build time
and survive every recreate.

- Harness script: `/opt/qwen-code/browser/verify-site.mjs` (source in
  `scripts/coder-browser/`). Run it as
  `node /opt/qwen-code/browser/verify-site.mjs /workspace/<site>` — it serves
  the site on a loopback port, drives it with headless Chrome, prints a JSON
  report and writes `/tmp/verify-light.png` + dark.
- Chrome headless shell:
  `/root/.cache/puppeteer/chrome-headless-shell/linux-153.0.8010.36/chrome-headless-shell-linux64/chrome-headless-shell`
- Full Chrome (for bare `puppeteer.launch()`):
  `/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome`
- Set `CHROME_BIN` to the full Chrome path when launching puppeteer with a
  custom `executablePath`.

**Fonts and Chrome runtime libs are already installed** (fontconfig,
fonts-liberation, fonts-noto-color-emoji, and the ~20 libnss3/libgbm1/libx11/etc.
runtime libraries). `ldd <chrome> | grep -c "not found"` → 0. No font crash, no
`LD_LIBRARY_PATH` needed.

**Gotcha (ESM resolution):** an ESM script resolves `import "puppeteer"`
relative to *its own* location, not the cwd. Author scratch harnesses inside
`/opt/qwen-code/browser` (where `node_modules` lives), or `cd` there first.
The old `/workspace/.qwen/tmp/browser` location is GONE — do not reference it.

**Port 8080 is occupied** by a pre-existing service in the image — serve scratch
harnesses on another port.

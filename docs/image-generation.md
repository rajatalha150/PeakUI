# Image Generation

PeakUI can generate images through a self-hosted **ComfyUI** engine that runs
alongside Ollama. This document covers the engine setup, model download, and
generation flow.

> **Why ComfyUI?** Ollama does not support image generation (its `routes.go`
> explicitly rejects image-generation models). ComfyUI is the de-facto standard
> self-hosted diffusion engine and runs FLUX, SDXL, SD1.5, and the newest
> models.

## Architecture

```
PeakUI (Next.js, Docker)
├── Ollama          → chat / vision / embedding   (host, :11434)
├── ComfyUI         → image generation            (host, :8188)
└── Hugging Face    → model search + download     (direct HTTP)
```

ComfyUI runs on the **host** (not in Docker), the same way Ollama does. Its
`models/` directory is mounted into the app container at
`/mnt/comfyui/models` via `COMFYUI_MODELS_DIR`.

## Engine setup (host)

ComfyUI is not installed by the PeakUI installer — it is a separate host-side
dependency. The known-good install (verified on an RTX 3060, CUDA 12.8):

```bash
# 1. Clone ComfyUI
git clone https://github.com/comfyanonymous/ComfyUI.git ~/ComfyUI

# 2. Create a venv (uv is the simplest path; system pip/venv also works)
uv venv ~/ComfyUI/.venv --python 3.12

# 3. Install PyTorch with CUDA (must be 2.10+ for current comfy-kitchen)
uv pip install --python ~/ComfyUI/.venv/bin/python \
  torch==2.10.0 torchvision torchaudio \
  --index-url https://download.pytorch.org/whl/cu128

# 4. Install the rest of ComfyUI's dependencies
uv pip install --python ~/ComfyUI/.venv/bin/python -r ~/ComfyUI/requirements.txt

# 5. Run it
cd ~/ComfyUI && .venv/bin/python main.py --listen 127.0.0.1 --port 8188
```

Two version gotchas to watch for:

- **torch must be 2.10+** — older torch (2.6) fails on `comfy-kitchen`'s
  `list[int]` custom-op schema.
- **torchaudio must match torch exactly** — a mismatched torchaudio fails with
  an undefined-symbol error on import.

> ComfyUI is not yet a systemd service in this repo. On a reboot it must be
> restarted manually (or wrapped in a systemd unit / launch script).

## Model download

From Settings → **Image Generation** → **Search Hugging Face**, search for
text-to-image models. Results are classified by file layout:

| Kind | Meaning | Downloadable? |
|---|---|---|
| `checkpoint` | single-file `.safetensors`/`.ckpt` | ✅ yes |
| `diffusers` | `unet/` + `vae/` + `text_encoder/` folders | ✅ yes (multi-file) |
| `collection` | loose files/folders, no single checkpoint | ❌ no |
| `unknown` | no model files | ❌ no |

Downloads are **resumable** (HTTP Range), persist across restarts, and show
live progress with pause/resume/delete.

- Single-file checkpoints land in `models/checkpoints/`.
- Diffusers models land in `models/diffusers/<repo-name>/` (preserving the
  `unet/`/`vae/`/`text_encoder/` structure).

## Generation

1. Select a model in Settings → Image Generation → **Image Model**.
2. Toggle **Image Gen** on in the chat mode menu (next to Internet / RAG /
   Accountant).
3. Ask the model to generate an image (e.g. "generate a picture of a cat").

The model emits an `image_generation` tool call, the backend submits a
workflow to ComfyUI, polls for completion, fetches the image bytes, persists
them as a Canvas artifact, and returns an absolute URL that renders inline and
is downloadable.

## VRAM

Image models are large and share the GPU with the chat model:

- SD-Turbo ≈ 4.9 GB (single-file, fits alongside a chat model on 12 GB)
- SDXL ≈ 7 GB (diffusers, needs the chat model unloaded)
- FLUX ≈ 23 GB (won't fit a 12 GB card)

The in-flight model tracking / GPU arbiter coordinates the two consumers, but
on a small card expect sequential (not parallel) use.

## API

- `GET /api/image-gen/search?q=...` — Hugging Face search; `?id=...` for detail.
- `GET /api/image-gen/downloads` — list downloads.
- `POST /api/image-gen/downloads` — `queue` / `queue-diffusers` / `start` /
  `start-model` / `pause` / `delete`.
- `GET /api/image-gen/models` — ComfyUI health + model listing.
- `POST /api/image-gen/generate` — submit a generation and persist the result.

/**
 * Fetch-based SSE client with cursor/epoch resume for the Qwen Code event
 * stream.
 *
 * The daemon frames each event as `id: <decimal>\n` (a bus event id, when one
 * exists) followed by `data: <json>\n\n` — no `event:` line, so every frame
 * dispatches to the default channel and the caller reads `type` / `sessionUpdate`
 * from the JSON itself. On reconnect the daemon replays events after the cursor:
 *
 *   - `Last-Event-ID: <decimal>`  — the last `id:` the client saw (standard SSE
 *     resume; the ring buffer replays everything after it).
 *   - `X-Qwen-Event-Epoch: <n>`   — the session's event-bus epoch, returned by
 *     the daemon on the `X-Qwen-Event-Epoch` response header. Echoing it lets
 *     the daemon detect that the client's `Last-Event-ID` belongs to a *replaced*
 *     event bus (the session was recreated) and refuse a bogus replay.
 *
 * The browser `EventSource` cannot set custom headers (so it can't send the
 * epoch) and cannot read response headers, which is why this exists as a manual
 * fetch loop instead.
 */

export interface SseFrame {
  /** Bus event id, when the frame carried an `id:` line. */
  id?: string;
  /** The JSON payload from the frame's `data:` line(s). */
  data: string;
}

/** Parse one raw frame body (the text between two `\n\n` separators). */
function parseFrame(raw: string): SseFrame | null {
  const dataLines: string[] = [];
  let id: string | undefined;
  for (const line of raw.split('\n')) {
    if (line.startsWith(':')) continue; // comment / heartbeat
    if (line.startsWith('id:')) {
      id = line.slice(3).trim();
    } else if (line.startsWith('event:')) {
      // The daemon emits no `event:` line; ignored for spec completeness.
    } else if (line.startsWith('data:')) {
      // The daemon writes `data: <json>`; drop the single leading space.
      dataLines.push(line.slice(5).replace(/^ /, ''));
    }
  }
  if (dataLines.length === 0) return null; // heartbeat / comment-only frame
  return { ...(id ? { id } : {}), data: dataLines.join('\n') };
}

/**
 * Streaming SSE frame parser. Accumulates a raw text buffer across chunk
 * boundaries and emits each complete frame (split on the blank-line terminator)
 * via `onFrame`. A frame whose terminator has not arrived yet stays buffered.
 */
export function createSseParser(onFrame: (frame: SseFrame) => void): {
  push: (chunk: string) => void;
} {
  let buffer = '';
  let endedWithCr = false;
  return {
    push(chunk: string) {
      if (!chunk) return;
      // CRLF can be split across network chunks. SSE also permits bare CR.
      if (endedWithCr && chunk.startsWith('\n')) chunk = chunk.slice(1);
      endedWithCr = chunk.endsWith('\r');
      if (chunk.length) {
        buffer += chunk.replace(/\r\n?/g, '\n');
      }
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const frame = parseFrame(raw);
        if (frame) onFrame(frame);
      }
      if (buffer.length > 2 * 1024 * 1024) throw new Error('SSE frame exceeds the buffer limit');
    },
  };
}

/**
 * Subscribe to a daemon SSE endpoint with resume, returning a `close()` handle.
 *
 * The loop reconnects automatically with the tracked `Last-Event-ID` /
 * `X-Qwen-Event-Epoch` headers, so a dropped or re-established stream replays
 * the events the client missed rather than only delivering frames emitted after
 * the resubscribe (which silently dropped the first response on a fast send).
 * An external `signal` (e.g. component unmount) stops the loop for good.
 */
export function streamSessionEvents(
  url: string,
  onFrame: (frame: SseFrame) => void,
  opts: { onReconnecting?: () => void; onError?: (status: number) => void; signal?: AbortSignal } = {},
): () => void {
  let closed = false;
  let lastEventId: string | undefined;
  let lastEpoch: string | undefined;

  const abort = new AbortController();
  const onExternalAbort = () => abort.abort();
  opts.signal?.addEventListener('abort', onExternalAbort);
  if (opts.signal?.aborted) abort.abort();

  const sleep = (ms: number) => new Promise<void>(resolve => {
    if (abort.signal.aborted) { resolve(); return; }
    const finish = () => { clearTimeout(timer); abort.signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, ms);
    abort.signal.addEventListener('abort', finish, { once: true });
  });

  const run = async () => {
    let backoff = 500;
    while (!closed && !abort.signal.aborted) {
      try {
        const headers: Record<string, string> = { Accept: 'text/event-stream' };
        if (lastEventId !== undefined) headers['last-event-id'] = lastEventId;
        if (lastEpoch !== undefined) headers['x-qwen-event-epoch'] = lastEpoch;

        const res = await fetch(url, { headers, signal: abort.signal });
        if (!res.ok || !res.body) {
          await res.body?.cancel();
          if ([401, 403, 404].includes(res.status)) {
            opts.onError?.(res.status);
            break;
          }
          if (res.status === 409) { lastEventId = undefined; lastEpoch = undefined; }
          opts.onReconnecting?.();
          await sleep(backoff);
          backoff = Math.min(backoff * 2, 15000);
          continue;
        }

        const epochHeader = res.headers.get('x-qwen-event-epoch');
        if (epochHeader && epochHeader !== lastEpoch) lastEventId = undefined;
        if (epochHeader) lastEpoch = epochHeader;
        backoff = 500;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const parser = createSseParser(frame => {
          if (frame.id !== undefined) lastEventId = frame.id;
          onFrame(frame);
        });

        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done || closed || abort.signal.aborted) break;
            parser.push(decoder.decode(value, { stream: true }));
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      } catch {
        // Network error or abort; the loop condition decides whether to stop.
      }

      if (closed || abort.signal.aborted) break;
      opts.onReconnecting?.();
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 15000);
    }
  };

  void run().finally(() => opts.signal?.removeEventListener('abort', onExternalAbort));

  return () => {
    closed = true;
    abort.abort();
    opts.signal?.removeEventListener('abort', onExternalAbort);
  };
}

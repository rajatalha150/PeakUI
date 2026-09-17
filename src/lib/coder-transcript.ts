/**
 * Rebuild a coding conversation from the Qwen Code daemon's transcript.
 *
 * The daemon emits the whole turn as a flat list of `session_update` events:
 * `user_message_chunk`, `agent_thought_chunk`, `agent_message_chunk`,
 * `tool_call`, `tool_call_update` (and a few others). These helpers fold that
 * stream back into ordered messages + a tool-activity feed, and can serialize
 * the whole thing to a pasteable text dump.
 *
 * This is the single source of truth for the chat surface: instead of mutating
 * state from the SSE stream (which races the subscription and collides turn
 * boundaries when every message shares a `live-` id), the UI polls the
 * transcript and rebuilds deterministically from these pure functions. The
 * same builder powers the "copy session" button, so what the user pastes back
 * is exactly what the agent did — thinking, tool input, tool output, everything.
 */

export interface CoderChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  ack?: 'sending' | 'accepted' | 'error';
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface ToolActivity {
  id: string;
  title: string;
  status: string;
  detail: string;
  toolName?: string;
  rawInput?: unknown;
  rawOutput?: string;
}

export interface CoderTranscriptEvent {
  type?: string;
  data?: Record<string, unknown>;
}

/** One page of the daemon's paginated transcript. */
export interface CoderTranscriptPage {
  events: CoderTranscriptEvent[];
  hasMore?: boolean;
  nextCursor?: string;
}

/**
 * Walk the daemon's paginated transcript into one full event list.
 *
 * `qwen serve` caps `GET /session/:id/transcript` at
 * `SESSION_TRANSCRIPT_DEFAULT_LIMIT` (100) events per page and returns
 * `{ hasMore, nextCursor }` when there is more. Fetching a single unpaginated
 * page was the bug that made every message after the first two turns "vanish"
 * — the data was there, the UI just never asked for the rest.
 *
 * `fetchPage` is injected so this stays pure and testable; it receives the
 * next cursor (or `undefined` for the first page) and returns the raw page.
 * The caller is responsible for the page size (pass `limit=500`, the daemon's
 * hard cap, so a single request almost always suffices and cursor-following is
 * only a safety net for very long sessions).
 */
export async function fetchFullTranscript(
  fetchPage: (cursor?: string) => Promise<CoderTranscriptPage>,
): Promise<CoderTranscriptEvent[]> {
  const events: CoderTranscriptEvent[] = [];
  let cursor: string | undefined;
  // Bounded so a daemon that keeps reporting `hasMore` with an unchanged
  // cursor can't loop forever.
  let guard = 0;

  do {
    const page = await fetchPage(cursor);
    const pageEvents = Array.isArray(page?.events) ? page.events : [];
    events.push(...pageEvents);
    if (!page?.hasMore) break;
    const next = typeof page.nextCursor === 'string' && page.nextCursor ? page.nextCursor : undefined;
    if (!next || next === cursor) break;
    cursor = next;
    guard += 1;
  } while (guard < 100);

  return events;
}

/** Pull readable text out of the daemon's content-block shapes. */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          const rec = part as Record<string, unknown>;
          if (typeof rec.text === 'string') return rec.text;
          if ('content' in rec) return contentText(rec.content);
          // A diff block has oldText/newText but no prose; skip it for message
          // text but the tool activity path still surfaces the raw input.
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (content && typeof content === 'object') {
    const rec = content as Record<string, unknown>;
    if (typeof rec.text === 'string') return rec.text;
  }
  return '';
}

function usageOf(d: Record<string, unknown>): CoderChatMessage['usage'] {
  const meta = (d._meta || {}) as Record<string, unknown>;
  const u = (meta.usage || {}) as Record<string, unknown>;
  if (!u || typeof u !== 'object') return undefined;
  const out: NonNullable<CoderChatMessage['usage']> = {};
  if (typeof u.inputTokens === 'number') out.inputTokens = u.inputTokens;
  if (typeof u.outputTokens === 'number') out.outputTokens = u.outputTokens;
  return out.inputTokens !== undefined || out.outputTokens !== undefined ? out : undefined;
}

function toolNameOf(d: Record<string, unknown>): string | undefined {
  const meta = d._meta;
  if (meta && typeof meta === 'object' && typeof (meta as Record<string, unknown>).toolName === 'string') {
    return (meta as Record<string, unknown>).toolName as string;
  }
  return undefined;
}

/**
 * Fold transcript events into ordered messages + a tool-activity feed.
 *
 * Turn boundaries are the `user_message_chunk` events: each one opens a fresh
 * user message and a fresh assistant message. `agent_thought_chunk` appends to
 * the current assistant message's `thinking`; `agent_message_chunk` appends to
 * its `content` (empty chunks only carry `usage`, which is attached to the
 * message). `tool_call`/`tool_call_update` accumulate into the activity feed
 * keyed by `toolCallId` so an in-progress call and its completion merge.
 */
export function buildConversation(events: CoderTranscriptEvent[]): {
  messages: CoderChatMessage[];
  activity: ToolActivity[];
} {
  const messages: CoderChatMessage[] = [];
  const activity: ToolActivity[] = [];
  let assistant: CoderChatMessage | null = null;

  const ensureAssistant = (): CoderChatMessage => {
    if (!assistant) {
      assistant = { id: `a-${messages.length}`, role: 'assistant', content: '', thinking: '' };
      messages.push(assistant);
    }
    return assistant;
  };

  for (const evt of events) {
    const d = (evt.data || {}) as Record<string, unknown>;
    const su = typeof d.sessionUpdate === 'string' ? d.sessionUpdate : '';

    if (su === 'user_message_chunk') {
      const text = contentText(d.content);
      if (text) {
        messages.push({ id: `u-${messages.length}`, role: 'user', content: text });
        assistant = null;
      }
    } else if (su === 'agent_thought_chunk') {
      const text = contentText(d.content);
      if (text) {
        const a = ensureAssistant();
        a.thinking = (a.thinking || '') + text;
      }
    } else if (su === 'agent_message_chunk') {
      const text = contentText(d.content);
      if (text) ensureAssistant().content += text;
      const usage = usageOf(d);
      if (usage) ensureAssistant().usage = usage;
    } else if (su === 'tool_call' || su === 'tool_call_update') {
      const id = typeof d.toolCallId === 'string' && d.toolCallId ? d.toolCallId : `t-${activity.length}`;
      const toolName = toolNameOf(d);
      const title = typeof d.title === 'string' && d.title ? d.title : (toolName || 'tool');
      const status = typeof d.status === 'string' ? d.status : (su === 'tool_call' ? 'in_progress' : 'update');
      const detail = contentText(d.content);
      const rawOutput = typeof d.rawOutput === 'string' ? d.rawOutput : '';

      if (su === 'tool_call') {
        activity.push({
          id,
          title,
          status,
          detail,
          ...(toolName ? { toolName } : {}),
          ...(d.rawInput !== undefined ? { rawInput: d.rawInput } : {}),
        });
      } else {
        const existing = activity.find(a => a.id === id);
        if (existing) {
          existing.status = status;
          if (detail) existing.detail = detail;
          if (rawOutput) existing.rawOutput = rawOutput;
          if (existing.rawInput === undefined && d.rawInput !== undefined) existing.rawInput = d.rawInput;
        } else {
          activity.push({
            id,
            title,
            status,
            detail,
            ...(toolName ? { toolName } : {}),
            ...(d.rawInput !== undefined ? { rawInput: d.rawInput } : {}),
            ...(rawOutput ? { rawOutput } : {}),
          });
        }
      }
    }
  }

  return { messages, activity };
}

/** Render an object (e.g. a tool call's `rawInput`) as readable text. */
function prettyInput(input: unknown): string {
  if (input === null || input === undefined) return '';
  if (typeof input === 'string') return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

/**
 * Serialize a full transcript into a pasteable text dump — every user message,
 * thought, assistant reply, and tool call (input + output) in order, nothing
 * filtered or truncated. This is what the "copy session" button puts on the
 * clipboard so the whole session can be shared verbatim.
 */
export function serializeConversation(
  events: CoderTranscriptEvent[],
  header: { sessionId?: string; model?: string; workspace?: string; approval?: string } = {},
): string {
  const lines: string[] = [];
  lines.push('=== Coding session transcript ===');
  if (header.sessionId) lines.push(`session: ${header.sessionId}`);
  if (header.model) lines.push(`model: ${header.model}`);
  if (header.workspace) lines.push(`workspace: ${header.workspace}`);
  if (header.approval) lines.push(`approval mode: ${header.approval}`);
  lines.push('');

  for (const evt of events) {
    const d = (evt.data || {}) as Record<string, unknown>;
    const su = typeof d.sessionUpdate === 'string' ? d.sessionUpdate : '';

    if (su === 'user_message_chunk') {
      const text = contentText(d.content);
      if (text) lines.push(`[user]\n${text}`);
    } else if (su === 'agent_thought_chunk') {
      const text = contentText(d.content);
      if (text) lines.push(`[thinking]\n${text}`);
    } else if (su === 'agent_message_chunk') {
      const text = contentText(d.content);
      if (text) lines.push(`[assistant]\n${text}`);
    } else if (su === 'tool_call' || su === 'tool_call_update') {
      const title = typeof d.title === 'string' ? d.title : (toolNameOf(d) || 'tool');
      const status = typeof d.status === 'string' ? d.status : '';
      const rawInput = prettyInput(d.rawInput);
      const rawOutput = typeof d.rawOutput === 'string' ? d.rawOutput : '';
      const detail = contentText(d.content);
      lines.push(`\n[tool ${su === 'tool_call' ? 'call' : 'update'}] ${title} (${status})`);
      if (rawInput) lines.push(`input:\n${rawInput}`);
      if (detail) lines.push(`detail:\n${detail}`);
      if (rawOutput) lines.push(`output:\n${rawOutput}`);
    }
  }

  return lines.join('\n');
}

import { describe, expect, it } from 'vitest'
import { buildConversation, fetchFullTranscript, serializeConversation, type CoderTranscriptEvent } from './coder-transcript'

const event = (sessionUpdate: string, data: Record<string, unknown>): CoderTranscriptEvent => ({
  type: 'session_update',
  data: { sessionUpdate, ...data },
})

describe('buildConversation', () => {
  it('orders user → assistant → tool activity across one turn', () => {
    const events = [
      event('user_message_chunk', { content: { type: 'text', text: 'write a file' } }),
      event('agent_thought_chunk', { content: { type: 'text', text: 'I should write a file.' } }),
      event('tool_call', {
        toolCallId: 'c1',
        title: 'WriteFile: hello.txt',
        status: 'in_progress',
        rawInput: { file_path: '/workspace/hello.txt', content: 'hi\n' },
      }),
      event('tool_call_update', {
        toolCallId: 'c1',
        status: 'completed',
        content: [{ type: 'content', content: { type: 'text', text: 'wrote it' } }],
      }),
      event('agent_message_chunk', { content: { type: 'text', text: 'Done.' } }),
    ];

    const { messages, activity } = buildConversation(events);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: 'user', content: 'write a file' });
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].thinking).toBe('I should write a file.');
    expect(messages[1].content).toBe('Done.');

    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({
      id: 'c1',
      status: 'completed',
    });
    expect(activity[0].title).toBe('WriteFile: hello.txt');
    expect(activity[0].rawInput).toEqual({ file_path: '/workspace/hello.txt', content: 'hi\n' });
  });

  it('does not drop the first assistant message when the stream opens mid-turn', () => {
    // The subscription can start after the user message; the first event seen is
    // an assistant chunk. It must still land on a real message, not vanish.
    const { messages } = buildConversation([
      event('agent_thought_chunk', { content: { type: 'text', text: 'thinking' } }),
      event('agent_message_chunk', { content: { type: 'text', text: 'hello' } }),
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('assistant');
    expect(messages[0].content).toBe('hello');
    expect(messages[0].thinking).toBe('thinking');
  });

  it('starts a fresh assistant message at each new user turn', () => {
    const { messages } = buildConversation([
      event('user_message_chunk', { content: { type: 'text', text: 'q1' } }),
      event('agent_message_chunk', { content: { type: 'text', text: 'a1' } }),
      event('user_message_chunk', { content: { type: 'text', text: 'q2' } }),
      event('agent_message_chunk', { content: { type: 'text', text: 'a2' } }),
    ]);

    expect(messages).toHaveLength(4);
    expect(messages.map(m => [m.role, m.content])).toEqual([
      ['user', 'q1'], ['assistant', 'a1'],
      ['user', 'q2'], ['assistant', 'a2'],
    ]);
  });

  it('carries usage from the empty trailing agent chunk onto the message', () => {
    const { messages } = buildConversation([
      event('agent_message_chunk', { content: { type: 'text', text: 'hi' } }),
      event('agent_message_chunk', {
        content: { type: 'text', text: '' },
        _meta: { usage: { inputTokens: 10, outputTokens: 3 } },
      }),
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0].usage).toEqual({ inputTokens: 10, outputTokens: 3 });
  });
});

describe('serializeConversation', () => {
  it('renders user, thinking, assistant, and tool activity without truncating', () => {
    const longOutput = 'x'.repeat(2000);
    const events = [
      event('user_message_chunk', { content: { type: 'text', text: 'run it' } }),
      event('agent_thought_chunk', { content: { type: 'text', text: 'ok' } }),
      event('tool_call', {
        toolCallId: 'c1',
        title: 'Shell: echo',
        status: 'in_progress',
        rawInput: { command: 'echo hi' },
      }),
      event('tool_call_update', {
        toolCallId: 'c1',
        status: 'completed',
        rawOutput: longOutput,
      }),
      event('agent_message_chunk', { content: { type: 'text', text: 'done' } }),
    ];

    const dump = serializeConversation(events, { sessionId: 's1', model: 'm' });

    expect(dump).toContain('[user]\nrun it');
    expect(dump).toContain('[thinking]\nok');
    expect(dump).toContain('[assistant]\ndone');
    expect(dump).toContain('[tool call] Shell: echo (in_progress)');
    expect(dump).toContain('input:\n{');
    expect(dump).toContain(`output:\n${longOutput}`);
    expect(dump).toContain('session: s1');
    expect(dump).toContain('model: m');
  });
});

describe('fetchFullTranscript', () => {
  it('returns a single page as-is when hasMore is absent/false', async () => {
    const events = [event('user_message_chunk', { content: { type: 'text', text: 'hi' } })];
    const result = await fetchFullTranscript(async () => ({ events, hasMore: false }));
    expect(result).toEqual(events);
  });

  it('follows nextCursor until hasMore is false', async () => {
    const e1 = [event('agent_message_chunk', { content: { type: 'text', text: 'one' } })];
    const e2 = [event('agent_message_chunk', { content: { type: 'text', text: 'two' } })];
    const e3 = [event('agent_message_chunk', { content: { type: 'text', text: 'three' } })];
    const calls: Array<string | undefined> = [];
    const result = await fetchFullTranscript(async (cursor) => {
      calls.push(cursor);
      if (cursor === undefined) return { events: e1, hasMore: true, nextCursor: 'c2' };
      if (cursor === 'c2') return { events: e2, hasMore: true, nextCursor: 'c3' };
      return { events: e3, hasMore: false };
    });
    expect(calls).toEqual([undefined, 'c2', 'c3']);
    expect(result).toEqual([...e1, ...e2, ...e3]);
  });

  it('stops on a repeating cursor to avoid an infinite loop', async () => {
    const e1 = [event('agent_message_chunk', { content: { type: 'text', text: 'x' } })];
    let calls = 0;
    const result = await fetchFullTranscript(async () => {
      calls += 1;
      return { events: e1, hasMore: true, nextCursor: 'stuck' };
    });
    expect(calls).toBe(2);
    expect(result).toEqual([...e1, ...e1]);
  });

  it('stops when hasMore is true but nextCursor is absent', async () => {
    const e1 = [event('agent_message_chunk', { content: { type: 'text', text: 'x' } })];
    const result = await fetchFullTranscript(async () => ({ events: e1, hasMore: true }));
    expect(result).toEqual(e1);
  });
});

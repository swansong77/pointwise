import { describe, expect, it, vi } from 'vitest';
import { applyStreamEvent, parseSse, StreamError, streamChat } from '../src/lib/ai';
import { confidenceLabel, five24Chip, highlightParts, oddsChip, parsePoints, points, signedMoney, statusTone, uptime } from '../src/lib/strategy';

describe('strategy helpers', () => {
  it('confidence bands', () => {
    expect(confidenceLabel(0.85)).toEqual({
      label: 'High confidence (85 %)',
      tone: 'green',
    });
    expect(confidenceLabel(0.6)).toEqual({
      label: 'Medium confidence (60 %)',
      tone: 'amber',
    });
    expect(confidenceLabel(0.25)).toEqual({
      label: 'Low confidence (25 %)',
      tone: 'red',
    });
  });

  it('5/24 chip', () => {
    const base = {
      blockedByRule: false,
      underLimitAgainAt: null,
      usesLastSlot: false,
    };
    expect(
      five24Chip({
        ...base,
        countsToward: false,
        before: 2,
        after: 2,
        slotCostCents: 0,
      }),
    ).toBe('Not on 5/24');
    expect(
      five24Chip({
        ...base,
        countsToward: true,
        before: 5,
        after: 6,
        slotCostCents: 0,
      }),
    ).toBe('No slot used (5/24)');
    expect(
      five24Chip({
        ...base,
        countsToward: true,
        before: 3,
        after: 4,
        slotCostCents: 15000,
      }),
    ).toBe('5/24: 3 → 4');
    expect(
      five24Chip({
        ...base,
        countsToward: true,
        before: 4,
        after: 5,
        slotCostCents: 30000,
        usesLastSlot: true,
      }),
    ).toBe('5/24: 4 → 5 (last slot)');
  });

  it('money, points and parsing', () => {
    expect(signedMoney(101_600)).toBe('$1,016');
    expect(signedMoney(-32_500)).toBe('-$325');
    expect(points(64000)).toBe('64,000');
    expect(parsePoints('60,000')).toBe(60000);
    expect(parsePoints('60k')).toBe(60000);
    expect(parsePoints('1.5M')).toBe(1_500_000);
    expect(parsePoints(' 0 ')).toBe(0);
    expect(parsePoints('abc')).toBeNull();
    expect(parsePoints('-5')).toBeNull();
  });

  it('status tones and uptime', () => {
    expect(['ok', 'CLOSED', 'ACTIVE', 'degraded', 'DISABLED', 'down', 'OPEN', 'ERROR', 'x'].map(statusTone)).toEqual([
      'green',
      'green',
      'green',
      'amber',
      'amber',
      'red',
      'red',
      'red',
      'slate',
    ]);
    expect(uptime(59)).toBe('0 min');
    expect(uptime(3 * 3600 + 5 * 60)).toBe('3 h 5 min');
    expect(uptime(2 * 86400 + 4 * 3600)).toBe('2 d 4 h');
  });
});

describe('SSE parsing and stream state', () => {
  it('parses complete blocks and keeps the unfinished remainder', () => {
    const r = parseSse('event: start\ndata: {"type":"start","conversationId":"c","agent":"a"}\n\nevent: delta\ndata: {"type":"delta","text":"Hi"}\n\nevent: del');
    expect(r.events).toEqual([
      { type: 'start', conversationId: 'c', agent: 'a' },
      { type: 'delta', text: 'Hi' },
    ]);
    expect(r.rest).toBe('event: del');
    expect(parseSse('event: x\r\ndata: {bad json}\r\n\r\n: comment\n\n').events).toEqual([]);
  });

  it('applies deltas, resets and tool progress', () => {
    let s = {
      text: '',
      tools: [] as Array<{
        name: string;
        status: 'running' | 'done' | 'error';
      }>,
    };
    s = applyStreamEvent(s, { type: 'delta', text: 'Checking' });
    s = applyStreamEvent(s, {
      type: 'tool',
      name: 'plan_award',
      status: 'running',
    });
    s = applyStreamEvent(s, {
      type: 'tool',
      name: 'get_offers',
      status: 'running',
    });
    s = applyStreamEvent(s, {
      type: 'tool',
      name: 'plan_award',
      status: 'done',
    });
    s = applyStreamEvent(s, {
      type: 'tool',
      name: 'get_offers',
      status: 'error',
    });
    s = applyStreamEvent(s, { type: 'tool', name: 'x', status: 'done' }); // done without running → appended
    expect(s.tools).toEqual([
      { name: 'plan_award', status: 'done' },
      { name: 'get_offers', status: 'error' },
      { name: 'x', status: 'done' },
    ]);
    s = applyStreamEvent(s, { type: 'reset' });
    expect(s.text).toBe('');
    expect(applyStreamEvent(s, { type: 'start', conversationId: 'c', agent: 'a' })).toBe(s);
  });
});

function sseResponse(chunks: string[], status = 200) {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('streamChat', () => {
  const result = { conversationId: 'c', answer: 'Hello world' };
  it('emits events across chunk boundaries and resolves with the done result', async () => {
    const fetchFn = vi.fn(async () =>
      sseResponse([
        'data: {"type":"start","conversationId":"c","agent":"a"}\n\ndata: {"type":"del',
        'ta","text":"Hello "}\n\n',
        `data: {"type":"delta","text":"world"}\n\ndata: ${JSON.stringify({ type: 'done', result })}`,
      ]),
    );
    const seen: string[] = [];
    const r = await streamChat({ message: 'hi' }, 'tok', (e) => seen.push(e.type), fetchFn as unknown as typeof fetch);
    expect(r).toEqual(result);
    expect(seen).toEqual(['start', 'delta', 'delta', 'done']);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/ai/chat/stream');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer tok',
      Accept: 'text/event-stream',
    });
  });

  it('throws StreamError on error events, HTTP errors and truncated streams', async () => {
    const err = vi.fn(async () => sseResponse(['data: {"type":"error","status":403,"message":"Turn on the AI assistant"}\n\n']));
    await expect(streamChat({}, undefined, () => undefined, err as unknown as typeof fetch)).rejects.toMatchObject({
      status: 403,
      message: 'Turn on the AI assistant',
    });
    const http = vi.fn(async () => new Response(JSON.stringify({ message: ['message should not be empty'] }), { status: 400 }));
    await expect(streamChat({}, undefined, () => undefined, http as unknown as typeof fetch)).rejects.toMatchObject({
      status: 400,
      message: 'message should not be empty',
    });
    const html = vi.fn(async () => new Response('<html>', { status: 404, statusText: 'Not Found' }));
    await expect(streamChat({}, undefined, () => undefined, html as unknown as typeof fetch)).rejects.toBeInstanceOf(StreamError);
    const cut = vi.fn(async () => sseResponse(['data: {"type":"delta","text":"Hal"}\n\n']));
    await expect(streamChat({}, undefined, () => undefined, cut as unknown as typeof fetch)).rejects.toMatchObject({ status: 502 });
  });
});

describe('Phase F helpers', () => {
  it('approval odds chips', () => {
    expect(oddsChip('LIKELY')).toEqual({ label: 'Approval likely', tone: 'green' });
    expect(oddsChip('POSSIBLE')).toEqual({ label: 'Approval uncertain', tone: 'amber' });
    expect(oddsChip('UNLIKELY')).toEqual({ label: 'Approval unlikely', tone: 'red' });
    expect(oddsChip('UNKNOWN')).toBeNull();
  });
  it('splits highlighted snippets without HTML', () => {
    expect(highlightParts('Airport «lounge» «access» included')).toEqual([
      { text: 'Airport ', hit: false },
      { text: 'lounge', hit: true },
      { text: ' ', hit: false },
      { text: 'access', hit: true },
      { text: ' included', hit: false },
    ]);
    expect(highlightParts('<script>x</script>')).toEqual([{ text: '<script>x</script>', hit: false }]);
  });
});

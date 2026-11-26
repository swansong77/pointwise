import { modelHistory, redactForModel } from '../../../src/ai/privacy';

describe('privacy boundary', () => {
  it('redacts card-number-like digit runs and emails, keeps ordinary numbers', () => {
    expect(redactForModel('card 4111-1111-1111-1111 or 4111111111111111, mail a.b@c.io')).toBe('card [number removed] or [number removed], mail [email removed]');
    expect(redactForModel('Log $15 of my dining credit on 2026-11-21, last 4 is 1234')).toBe('Log $15 of my dining credit on 2026-11-21, last 4 is 1234');
  });
  it('modelHistory drops private turns and starts at a user turn', () => {
    expect(
      modelHistory([
        { role: 'tool', results: [] },
        { role: 'user', text: 'q1 me@x.com' },
        { role: 'assistant', text: 'secret', toolCalls: [], private: true },
        { role: 'assistant', text: 'public', toolCalls: [] },
      ]),
    ).toEqual([
      { role: 'user', text: 'q1 [email removed]' },
      { role: 'assistant', text: 'public', toolCalls: [] },
    ]);
    expect(modelHistory([{ role: 'assistant', text: 'x', toolCalls: [] }])).toEqual([]);
  });
});

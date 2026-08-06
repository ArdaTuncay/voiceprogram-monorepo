import { describe, expect, it } from 'vitest';
import { shouldGroupMessages } from '../utils';
import type { ChatMessage } from '../types';

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    content: 'hi',
    file_url: null,
    file_type: null,
    user_id: 'u1',
    username: 'ardatuncay',
    inserted_at: '2026-08-06T14:32:00',
    is_edited: false,
    reactions: [],
    is_deleted: false,
    ...overrides,
  };
}

describe('shouldGroupMessages', () => {
  it('groups a message from the same author sent in the same minute', () => {
    const prev = makeMessage({ user_id: 'u1', inserted_at: '2026-08-06T14:32:00' });
    const current = makeMessage({ user_id: 'u1', inserted_at: '2026-08-06T14:32:59' });

    expect(shouldGroupMessages(prev, current)).toBe(true);
  });

  it('does not group when a different user sent the previous message', () => {
    const prev = makeMessage({ user_id: 'u1', inserted_at: '2026-08-06T14:32:00' });
    const current = makeMessage({ user_id: 'u2', inserted_at: '2026-08-06T14:32:05' });

    expect(shouldGroupMessages(prev, current)).toBe(false);
  });

  it('does not group across a minute boundary, even for the same author', () => {
    const prev = makeMessage({ user_id: 'u1', inserted_at: '2026-08-06T14:32:59' });
    const current = makeMessage({ user_id: 'u1', inserted_at: '2026-08-06T14:33:00' });

    expect(shouldGroupMessages(prev, current)).toBe(false);
  });

  it('does not group the first message in a list (no previous message)', () => {
    const current = makeMessage({ user_id: 'u1' });

    expect(shouldGroupMessages(undefined, current)).toBe(false);
  });

  it('treats a UTC timestamp missing its trailing "Z" the same as one that has it', () => {
    const prev = makeMessage({ user_id: 'u1', inserted_at: '2026-08-06T14:32:00Z' });
    const current = makeMessage({ user_id: 'u1', inserted_at: '2026-08-06T14:32:30' });

    expect(shouldGroupMessages(prev, current)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { applyMention, findMentionQuery } from '../mentions';

describe('findMentionQuery', () => {
  it('finds the @word being typed at the end of the draft', () => {
    expect(findMentionQuery('selam @ard')).toBe('ard');
    expect(findMentionQuery('@')).toBe('');
    expect(findMentionQuery('satır\n@ali')).toBe('ali');
  });

  it('ignores an @ that is finished, mid-word or absent', () => {
    expect(findMentionQuery('selam @arda ')).toBeNull();
    expect(findMentionQuery('mail@example')).toBeNull();
    expect(findMentionQuery('selam')).toBeNull();
  });
});

describe('applyMention', () => {
  it('replaces the partial @word with the full username and a space', () => {
    expect(applyMention('selam @ard', 'arda_t')).toBe('selam @arda_t ');
    expect(applyMention('@', 'ali')).toBe('@ali ');
  });
});

import { useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { fetchServerMembers } from '../services/api';
import type { ServerMember } from '../types';
import { applyMention, findMentionQuery } from '../utils/mentions';

const MAX_SUGGESTIONS = 6;

/**
 * "@" autocomplete for a server channel's message box. The member list is
 * fetched the first time the user starts a mention in a server (not on every
 * server switch), then filtered by the typed prefix.
 *
 * `handleKeyDown` returns true when it consumed the key (arrows, Enter/Tab
 * to pick, Escape to dismiss), so the caller skips its own handling.
 */
export function useMentionSuggestions(
  serverId: string | null,
  draft: string,
  setDraft: (value: string) => void,
  myUserId: string
) {
  const [members, setMembers] = useState<{ serverId: string; list: ServerMember[] } | null>(null);
  const [index, setIndex] = useState(0);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  const query = findMentionQuery(draft);
  const active = query !== null && serverId !== null && dismissedFor !== draft;

  useEffect(() => {
    if (!active || !serverId || members?.serverId === serverId) return;
    let cancelled = false;
    fetchServerMembers(serverId).then(({ data }) => {
      if (!cancelled && data) setMembers({ serverId, list: data });
    });
    return () => {
      cancelled = true;
    };
  }, [active, serverId, members?.serverId]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  const suggestions =
    active && members?.serverId === serverId
      ? members.list
          .filter(
            (m) =>
              m.user_id !== myUserId &&
              m.username &&
              m.username.toLowerCase().startsWith((query ?? '').toLowerCase())
          )
          .slice(0, MAX_SUGGESTIONS)
      : [];

  function pick(username: string) {
    setDraft(applyMention(draft, username));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (suggestions.length === 0) return false;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setIndex((i) => (i + step + suggestions.length) % suggestions.length);
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const chosen = suggestions[Math.min(index, suggestions.length - 1)];
      if (chosen.username) pick(chosen.username);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setDismissedFor(draft);
      return true;
    }
    return false;
  }

  return { suggestions, activeIndex: Math.min(index, Math.max(suggestions.length - 1, 0)), pick, handleKeyDown };
}

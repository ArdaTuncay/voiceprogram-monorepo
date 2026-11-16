// Usernames are letters, digits and underscores (see Backend.Accounts.User).
const TYPING_MENTION = /(?:^|\s)@([A-Za-z0-9_]*)$/;

/** The partial username after an "@" being typed at the very end of the
 * draft (possibly empty right after the "@"), or null when not mid-mention. */
export function findMentionQuery(draft: string): string | null {
  const match = draft.match(TYPING_MENTION);
  return match ? match[1] : null;
}

/** Completes the "@partial" at the end of the draft to "@username ". */
export function applyMention(draft: string, username: string): string {
  return draft.replace(/@[A-Za-z0-9_]*$/, `@${username} `);
}

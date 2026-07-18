import type { Reaction } from '../types';

const QUICK_EMOJIS = ['👍', '❤️', '🔥', '😂', '😮'];

interface Props {
  reactions: Reaction[];
  currentUserId: string;
  onToggle: (emoji: string) => void;
}

/** Shared by Chat.tsx and DMChatView.tsx — the hover quick-react bar (shown
 * via CSS when the parent `.message` is hovered, see `.message-reaction-picker`
 * in Chat.css) plus the persistent row of reaction pills under a message's
 * content. Both pieces just call `onToggle`; the actual add/remove state
 * lives server-side (see Backend.Chat.toggle_reaction/4) and comes back
 * through the "reaction_toggled" broadcast, so there's nothing optimistic
 * to reconcile here. */
export default function MessageReactions({ reactions, currentUserId, onToggle }: Props) {
  return (
    <>
      <div className="message-reaction-picker">
        {QUICK_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            className="message-reaction-picker-btn"
            onClick={() => onToggle(emoji)}
            title={`${emoji} ile tepki ver`}
            aria-label={`${emoji} ile tepki ver`}
          >
            {emoji}
          </button>
        ))}
      </div>

      {reactions.length > 0 && (
        <div className="message-reactions">
          {reactions.map((r) => {
            const mine = r.user_ids.includes(currentUserId);
            return (
              <button
                key={r.emoji}
                type="button"
                className={`message-reaction-pill${mine ? ' mine' : ''}`}
                onClick={() => onToggle(r.emoji)}
                title={mine ? 'Tepkini kaldır' : 'Tepki ver'}
              >
                <span className="message-reaction-emoji">{r.emoji}</span>
                <span className="message-reaction-count">{r.count}</span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

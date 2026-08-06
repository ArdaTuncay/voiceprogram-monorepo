import type { Reaction } from '../types';

const QUICK_EMOJIS = ['👍', '❤️', '🔥', '😂', '😮'];

interface Props {
  reactions: Reaction[];
  currentUserId: string;
  onToggle: (emoji: string) => void;
  /** Called when the mouse leaves the quick-react picker itself — MessageItem
   * uses this to close its `reactionPickerForced` state (set by
   * MessageContextMenu's "İfade Bırak"). Deliberately scoped to just this
   * element rather than the whole `.message` row: the context menu that
   * opens the picker is a `position: fixed` overlay, so it can render
   * outside `.message`'s own box — moving the cursor onto it (to click
   * "İfade Bırak" in the first place) already fires a real `mouseleave` on
   * `.message`, which used to immediately undo the very state the click
   * had just set. */
  onPickerMouseLeave?: () => void;
}

/** Shared by Chat.tsx and DMChatView.tsx — the quick-react picker (opened via
 * MessageContextMenu's "İfade Bırak", see `.message.reaction-picker-open` in
 * Chat.css) plus the persistent row of reaction pills under a message's
 * content. Both pieces just call `onToggle`; the actual add/remove state
 * lives server-side (see Backend.Chat.toggle_reaction/4) and comes back
 * through the "reaction_toggled" broadcast, so there's nothing optimistic
 * to reconcile here. */
export default function MessageReactions({ reactions, currentUserId, onToggle, onPickerMouseLeave }: Props) {
  return (
    <>
      <div className="message-reaction-picker" onMouseLeave={onPickerMouseLeave}>
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

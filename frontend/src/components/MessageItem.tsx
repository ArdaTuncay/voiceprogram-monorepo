import { useState } from 'react';
import { CornerUpLeft } from 'lucide-react';
import type { KeyboardEvent, MouseEvent } from 'react';
import type { ChatMessage } from '../types';
import { resolveFileUrl } from '../config';
import { useAutoGrowTextarea } from '../hooks/useAutoGrowTextarea';
import { userColor, initials } from '../utils';
import { formatMessageTime } from '../utils/formatMessageTime';
import { isMentioned } from '../services/notificationPreferences';
import AvatarFace from './AvatarFace';
import FileAttachment from './FileAttachment';
import MessageContent from './MessageContent';
import MessageReactions from './MessageReactions';
import MessageContextMenu from './MessageContextMenu';

interface Props {
  message: ChatMessage;
  currentUserId: string;
  onToggleReaction: (emoji: string) => void;
  onEditMessage: (content: string) => void;
  onDeleteMessage: () => void;
  onImageClick: (fileUrl: string) => void;
  /** Lets the delete option's author-only gate also pass when the viewer
   * may moderate this message's author — the server's owner, or a
   * moderator on a regular member's message (see utils/permissions'
   * canModerate). Chat.tsx passes this, DMChatView never does, so delete
   * in a DM stays author-only, same as edit. */
  canModerate?: boolean;
  /** Opens the report dialog for this message; offered only on other people's messages. */
  onReport?: () => void;
  /** Starts a reply to this message. */
  onReply?: () => void;
  /** Scrolls to the message a reply quotes. */
  onJumpToMessage?: (messageId: string) => void;
  /** The viewer's username — a message mentioning it is highlighted. */
  currentUsername?: string;
  /** True while this message is the target of a just-completed search
   * "jump to message" — flashes a highlight background (see Chat.css
   * `.message-highlighted`). */
  isHighlighted?: boolean;
  /** True when this message immediately follows another from the same
   * author within the same minute (see utils.ts's shouldGroupMessages) —
   * Discord-style consecutive-message grouping. Suppresses the
   * avatar/name/timestamp header entirely (not just visually), including
   * for a deleted message's placeholder — there's no special case for it. */
  isGrouped?: boolean;
}

/** Shared by Chat.tsx and DMChatView.tsx — a single message row, including
 * its own inline-edit mode (author only). Editing state is local to this
 * component rather than the Zustand stores: it's purely ephemeral per-row
 * UI, never shared or persisted, same reasoning as why the reaction picker
 * (MessageReactions) needs no store state of its own either. */
export default function MessageItem({
  message,
  currentUserId,
  onToggleReaction,
  onEditMessage,
  onDeleteMessage,
  onImageClick,
  canModerate,
  onReport,
  onReply,
  onJumpToMessage,
  currentUsername,
  isHighlighted,
  isGrouped,
}: Props) {
  const [isEditing, setIsEditing] = useState(false);
  // KORUMA: Eğer message.content null ise state'e boş dize ('') veriyoruz
  const [editDraft, setEditDraft] = useState(message.content || '');
  const editTextareaRef = useAutoGrowTextarea(editDraft);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  // Set by MessageContextMenu's "İfade Bırak" (see the matching
  // `.message.reaction-picker-open` rule in Chat.css), cleared by
  // MessageReactions' own onMouseLeave — deliberately NOT tied to
  // `.message`'s onMouseLeave: the context menu that sets this is a
  // `position: fixed` overlay that can render outside `.message`'s own
  // box, so moving the cursor onto it to click "İfade Bırak" already fires
  // a real mouseleave on `.message`, which used to undo this in the same
  // instant it was set.
  const [reactionPickerForced, setReactionPickerForced] = useState(false);

  const color = userColor(message.user_id);
  const name = message.username ?? 'Unknown';
  const isOwnMessage = message.user_id === currentUserId;
  const grouped = !!isGrouped && !message.reply_to;
  const mentionsMe =
    !!currentUsername && !message.is_deleted && !!message.content && isMentioned(message.content, currentUsername);
  const canDelete = isOwnMessage || !!canModerate;

  // KORUMA: editDraft'ın null/undefined olma ihtimaline karşı güvenli trim kontrolü
  const canSave = (editDraft || '').trim() !== '' || !!message.file_url;

  function startEditing() {
    setEditDraft(message.content || '');
    setIsEditing(true);
  }

  function cancelEditing() {
    setIsEditing(false);
  }

  function saveEdit() {
    const trimmed = (editDraft || '').trim();
    if (!trimmed && !message.file_url) return;
    if (trimmed !== (message.content || '')) onEditMessage(trimmed);
    setIsEditing(false);
  }

  function handleEditKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditing();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      saveEdit();
    }
  }

  function handleDeleteClick() {
    if (window.confirm('Bu mesajı silmek istediğine emin misin?')) {
      onDeleteMessage();
    }
  }

  function handleContextMenu(e: MouseEvent<HTMLDivElement>) {
    if (message.is_deleted) return;
    e.preventDefault();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
  }

  return (
    <div
      id={`message-${message.id}`}
      className={`message${isHighlighted ? ' message-highlighted' : ''}${mentionsMe ? ' message-mentioned' : ''}${reactionPickerForced ? ' reaction-picker-open' : ''}`}
      onContextMenu={handleContextMenu}
    >
      {!grouped && (
        <div className="message-avatar" style={{ background: color }} title={name}>
          <AvatarFace url={message.avatar_url} fallback={initials(name)} />
        </div>
      )}
      <div className={`message-body${grouped ? ' message-content-grouped' : ''}`}>
        {message.reply_to && (
          <button
            type="button"
            className="message-reply-quote"
            onClick={() => onJumpToMessage?.(message.reply_to!.id)}
          >
            <CornerUpLeft size={12} />
            <span className="message-reply-author">@{message.reply_to.username ?? 'Bilinmeyen'}</span>
            <span className="message-reply-text">
              {message.reply_to.is_deleted
                ? 'Orijinal mesaj silindi'
                : message.reply_to.content || (message.reply_to.has_file ? 'Ek' : '')}
            </span>
          </button>
        )}
        {!grouped && (
          <div className="message-header">
            <span className="message-author" style={{ color }}>
              {name}
            </span>
            <span className="message-timestamp">{formatMessageTime(message.inserted_at)}</span>
            {!message.is_deleted && message.is_edited && (
              <span className="message-edited-tag">(düzenlendi)</span>
            )}
          </div>
        )}

        {message.is_deleted ? (
          <p className="message-deleted-placeholder">Bu mesaj silindi</p>
        ) : isEditing ? (
          <div className="message-edit-box">
            <textarea
              ref={editTextareaRef}
              autoFocus
              className="message-edit-input"
              rows={1}
              value={editDraft}
              onChange={(e) => setEditDraft(e.target.value)}
              onKeyDown={handleEditKeyDown}
              maxLength={4000}
            />
            <div className="message-edit-actions">
              <button type="button" className="message-edit-save-btn" onClick={saveEdit} disabled={!canSave}>
                Kaydet
              </button>
              <button type="button" className="message-edit-cancel-btn" onClick={cancelEditing}>
                İptal
              </button>
            </div>
          </div>
        ) : (
          <>
            {message.content && <MessageContent content={message.content} />}
            {message.file_url &&
              (message.file_type?.startsWith('image/') ? (
                <img
                  src={resolveFileUrl(message.file_url)}
                  alt="ek"
                  className="message-attachment-image"
                  onClick={() => onImageClick(message.file_url!)}
                />
              ) : (
                <FileAttachment
                  fileUrl={message.file_url}
                  fileType={message.file_type}
                  fileName={message.file_name}
                  fileSize={message.file_size}
                />
              ))}
          </>
        )}

        <MessageReactions
          reactions={message.reactions}
          currentUserId={currentUserId}
          onToggle={onToggleReaction}
          onPickerMouseLeave={() => setReactionPickerForced(false)}
        />
      </div>

      {contextMenuPos && (
        <MessageContextMenu
          x={contextMenuPos.x}
          y={contextMenuPos.y}
          canEdit={isOwnMessage}
          canDelete={canDelete}
          onReport={isOwnMessage ? undefined : onReport}
          onReply={onReply}
          onEdit={startEditing}
          onDelete={handleDeleteClick}
          onReact={() => setReactionPickerForced(true)}
          onClose={() => setContextMenuPos(null)}
        />
      )}
    </div>
  );
}

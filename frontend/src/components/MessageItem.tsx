import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Pencil } from 'lucide-react';
import type { ChatMessage } from '../types';
import { resolveFileUrl } from '../config';
import { useAutoGrowTextarea } from '../hooks/useAutoGrowTextarea';
import { userColor, initials } from '../utils';
import MessageContent from './MessageContent';
import MessageReactions from './MessageReactions';

interface Props {
  message: ChatMessage;
  currentUserId: string;
  onToggleReaction: (emoji: string) => void;
  onEditMessage: (content: string) => void;
  onImageClick: (fileUrl: string) => void;
  /** True while this message is the target of a just-completed search
   * "jump to message" — flashes a highlight background (see Chat.css
   * `.message-highlighted`). */
  isHighlighted?: boolean;
}

function formatTime(raw: string): string {
  // Elixir sends UTC without "Z"; append it so Date parses correctly.
  const d = new Date(raw.includes('Z') ? raw : raw + 'Z');
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
  onImageClick,
  isHighlighted,
}: Props) {
  const [isEditing, setIsEditing] = useState(false);
  // KORUMA: Eğer message.content null ise state'e boş dize ('') veriyoruz
  const [editDraft, setEditDraft] = useState(message.content || '');
  const editTextareaRef = useAutoGrowTextarea(editDraft);

  const color = userColor(message.user_id);
  const name = message.username ?? 'Unknown';
  const isOwnMessage = message.user_id === currentUserId;
  
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

  return (
    <div id={`message-${message.id}`} className={`message${isHighlighted ? ' message-highlighted' : ''}`}>
      <div className="message-avatar" style={{ background: color }} title={name}>
        {initials(name)}
      </div>
      <div className="message-body">
        <div className="message-header">
          <span className="message-author" style={{ color }}>
            {name}
          </span>
          <span className="message-timestamp">{formatTime(message.inserted_at)}</span>
          {message.is_edited && <span className="message-edited-tag">(düzenlendi)</span>}
          {isOwnMessage && !isEditing && (
            <button
              type="button"
              className="message-edit-btn"
              onClick={startEditing}
              title="Mesajı düzenle"
              aria-label="Mesajı düzenle"
            >
              <Pencil size={14} />
            </button>
          )}
        </div>

        {isEditing ? (
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
            {message.file_url && message.file_type?.startsWith('image/') && (
              <img
                src={resolveFileUrl(message.file_url)}
                alt="ek"
                className="message-attachment-image"
                onClick={() => onImageClick(message.file_url!)}
              />
            )}
          </>
        )}

        <MessageReactions reactions={message.reactions} currentUserId={currentUserId} onToggle={onToggleReaction} />
      </div>
    </div>
  );
}
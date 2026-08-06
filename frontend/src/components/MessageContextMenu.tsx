import { useEffect } from 'react';
import { Pencil, Trash2, Smile } from 'lucide-react';
import './MessageContextMenu.css';

interface Props {
  /** Viewport coordinates (e.clientX/clientY from the triggering
   * onContextMenu) — same anchor-point idea as RadialServerSwitcher's
   * `anchor` state, just following the cursor instead of a fixed trigger
   * element. */
  x: number;
  y: number;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onReact: () => void;
  onClose: () => void;
}

/** Right-click menu for a message row — reusable across Chat.tsx and
 * DMChatView.tsx via MessageItem. Closes on ESC, on clicking the backdrop,
 * or after any item is picked (same three closing paths as
 * RadialServerSwitcher, which this is modeled on). The caller is
 * responsible for not rendering this at all for a deleted message — it
 * has no "is_deleted" awareness of its own. */
export default function MessageContextMenu({ x, y, canEdit, canDelete, onEdit, onDelete, onReact, onClose }: Props) {
  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  function pick(action: () => void) {
    action();
    onClose();
  }

  return (
    <div className="message-context-menu-overlay" onClick={onClose} role="presentation">
      <div
        className="message-context-menu"
        style={{ left: x, top: y }}
        onClick={(e) => e.stopPropagation()}
        role="menu"
      >
        {canEdit && (
          <button type="button" role="menuitem" className="message-context-menu-item" onClick={() => pick(onEdit)}>
            <Pencil size={14} />
            Düzenle
          </button>
        )}
        {canDelete && (
          <button type="button" role="menuitem" className="message-context-menu-item" onClick={() => pick(onDelete)}>
            <Trash2 size={14} />
            Sil
          </button>
        )}
        <button type="button" role="menuitem" className="message-context-menu-item" onClick={() => pick(onReact)}>
          <Smile size={14} />
          İfade Bırak
        </button>
      </div>
    </div>
  );
}

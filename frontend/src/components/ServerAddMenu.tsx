import { useEffect, useRef, useState } from 'react';
import { Plus, LogIn } from 'lucide-react';
import './ServerAddMenu.css';

interface Props {
  onCreateServer: () => void;
  onJoinServer: () => void;
}

/** Single "+" trigger (bottom of ServerSidebar's rail) that replaces what
 * used to be two separate icon buttons — opens a small dropdown ("Sunucu
 * Oluştur" / "Bir Sunucuya Katıl") instead. Same click-outside/ESC-closing
 * pattern as ChannelAddMenu/MessageContextMenu. */
export default function ServerAddMenu({ onCreateServer, onJoinServer }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  function pick(action: () => void) {
    action();
    setOpen(false);
  }

  return (
    <div className="server-add-menu" ref={rootRef}>
      <button
        type="button"
        className="server-icon server-icon-create"
        onClick={() => setOpen((o) => !o)}
        title="Sunucu Ekle"
        aria-label="Sunucu Ekle"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Plus size={20} strokeWidth={2} />
      </button>
      {open && (
        <div className="server-add-menu-dropdown" role="menu">
          <button
            type="button"
            role="menuitem"
            className="server-add-menu-option"
            onClick={() => pick(onCreateServer)}
          >
            <Plus size={14} />
            Sunucu Oluştur
          </button>
          <button
            type="button"
            role="menuitem"
            className="server-add-menu-option"
            onClick={() => pick(onJoinServer)}
          >
            <LogIn size={14} />
            Bir Sunucuya Katıl
          </button>
        </div>
      )}
    </div>
  );
}

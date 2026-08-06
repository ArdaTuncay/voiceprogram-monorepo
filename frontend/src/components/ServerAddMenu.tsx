import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, LogIn } from 'lucide-react';
import './ServerAddMenu.css';

interface Props {
  onCreateServer: () => void;
  onJoinServer: () => void;
}

// Only used to clamp the anchor so the dropdown can't start close enough to
// the right edge to run off-screen on a narrow viewport — the box's real
// rendered width (180-240px, see ServerAddMenu.css) is still what actually
// shows; this just needs to be a safe upper-bound estimate for that math.
const MENU_ESTIMATED_WIDTH = 200;
const MENU_MARGIN = 8;

/** Single "+" trigger (bottom of ServerSidebar's rail) that replaces what
 * used to be two separate icon buttons — opens a small dropdown ("Sunucu
 * Oluştur" / "Bir Sunucuya Katıl") instead. Same click-outside/ESC-closing
 * pattern as ChannelAddMenu/MessageContextMenu.
 *
 * Positioned with `position: fixed` and a JS-computed anchor (same pattern
 * as RadialServerSwitcher's `open()`), not CSS `position: absolute` relative
 * to the trigger. Reason: `.server-sidebar` has `overflow-y: auto`, which
 * per the CSS overflow spec forces its `overflow-x` to also compute as
 * non-`visible` (see the comment on `.server-icon.active::before` in
 * ServerSidebar.css — this exact trap bit that element too). That silently
 * clips any `position: absolute` descendant that flies out past the
 * sidebar's own 72px-wide box: the dropdown was still rendering, just
 * invisible and unclickable, with clicks falling through to whatever DOM
 * content sat behind it (confirmed via `elementFromPoint` — it returned the
 * channel list, not the menu). `position: fixed` escapes that clipping
 * entirely, same as how RadialServerSwitcher's own overlay/panel (also
 * nested inside `.server-sidebar`) never has this problem. */
export default function ServerAddMenu({ onCreateServer, onJoinServer }: Props) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState({ left: 0, bottom: 0 });
  const rootRef = useRef<HTMLDivElement>(null);

  const openMenu = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      // Flies out to the right of the trigger, bottom-aligned with it —
      // clamped so it never starts past the point where even its smallest
      // width would run off the right edge of a narrow viewport.
      const maxLeft = window.innerWidth - MENU_ESTIMATED_WIDTH - MENU_MARGIN;
      setAnchor({
        left: Math.max(MENU_MARGIN, Math.min(rect.right + MENU_MARGIN, maxLeft)),
        bottom: window.innerHeight - rect.bottom,
      });
    }
    setOpen(true);
  }, []);

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
        onClick={() => (open ? setOpen(false) : openMenu())}
        title="Sunucu Ekle"
        aria-label="Sunucu Ekle"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Plus size={20} strokeWidth={2} />
      </button>
      {open && (
        <div
          className="server-add-menu-dropdown"
          style={{ left: anchor.left, bottom: anchor.bottom }}
          role="menu"
        >
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

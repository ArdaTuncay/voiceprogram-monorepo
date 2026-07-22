import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import type { Server } from '../types';
import { circularLayout } from '../utils/circularLayout';
import { serverInitials } from '../utils';
import './RadialServerSwitcher.css';

interface Props {
  servers: Server[];
  activeServerId: string | null;
  onSelectServer: (id: string) => void;
  /** The element (ServerSidebar's Home/logo button) that opens the switcher
   * on a long press. Listeners are attached imperatively to this ref rather
   * than asking the caller to change the trigger's own onClick, so its
   * existing behavior (a normal tap still does whatever it always did — go
   * to DMs) is never touched. */
  triggerRef: RefObject<HTMLElement | null>;
  /** Above this many servers a circle stops being legible, so the overlay
   * falls back to a plain scrollable grid — same pattern/threshold as
   * VoiceOrbit's maxOrbitSize. */
  maxRadialSize?: number;
}

const LONG_PRESS_MS = 450;
const RADIUS = 90;
const ITEM_SIZE = 48;
const PANEL_SIZE = RADIUS * 2 + ITEM_SIZE;

/** Optional radial quick-switcher layered on top of ServerSidebar's plain
 * server rail. Long-pressing the trigger (rather than a plain click, which
 * stays reserved for the trigger's normal action) opens a circle of server
 * avatars around the press point; picking one calls the same
 * setActiveServerId the rail itself uses. Closes on ESC, on clicking the
 * backdrop, or on selecting a server. */
export default function RadialServerSwitcher({
  servers,
  activeServerId,
  onSelectServer,
  triggerRef,
  maxRadialSize = 8,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [anchor, setAnchor] = useState({ x: 0, y: 0 });
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const close = useCallback(() => setIsOpen(false), []);

  const open = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      // Anchor to the right of the trigger rather than centered on it: the
      // trigger sits in the far corner of the narrow server rail, so a
      // circle centered exactly on it would mostly clip off the edge of
      // the viewport. Offsetting into the open canvas area keeps the whole
      // circle on-screen while still reading as "attached to the logo".
      const margin = 16;
      setAnchor({
        x: rect.right + RADIUS + margin,
        // Also keep the circle's top edge clear of the channel header bar
        // above the message area, not just the viewport's top edge.
        y: Math.max(rect.top + rect.height / 2, RADIUS + ITEM_SIZE + 20),
      });
    }
    setIsOpen(true);
  }, [triggerRef]);

  // Long-press detection, wired directly to the DOM node rather than through
  // React props on the trigger — see the triggerRef doc comment above.
  useEffect(() => {
    const el = triggerRef.current;
    if (!el) return;

    let timer: number | undefined;
    let longPressFired = false;

    function startPress() {
      longPressFired = false;
      timer = window.setTimeout(() => {
        longPressFired = true;
        open();
      }, LONG_PRESS_MS);
    }

    function cancelPress() {
      if (timer !== undefined) window.clearTimeout(timer);
    }

    // Capture phase, so this runs (and can swallow the event) before it
    // reaches React's own delegated click handler on the trigger button —
    // otherwise releasing a long press would ALSO fire the button's normal
    // click action right after opening the switcher.
    function interceptClick(e: MouseEvent) {
      if (longPressFired) {
        e.preventDefault();
        e.stopPropagation();
        longPressFired = false;
      }
    }

    el.addEventListener('pointerdown', startPress);
    el.addEventListener('pointerup', cancelPress);
    el.addEventListener('pointerleave', cancelPress);
    el.addEventListener('pointercancel', cancelPress);
    el.addEventListener('click', interceptClick, true);

    return () => {
      cancelPress();
      el.removeEventListener('pointerdown', startPress);
      el.removeEventListener('pointerup', cancelPress);
      el.removeEventListener('pointerleave', cancelPress);
      el.removeEventListener('pointercancel', cancelPress);
      el.removeEventListener('click', interceptClick, true);
    };
  }, [triggerRef, open]);

  // ESC closes; opening focuses the active server's item (or the first).
  useEffect(() => {
    if (!isOpen) return;

    function handleEscape(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('keydown', handleEscape);

    const activeIndex = Math.max(
      0,
      servers.findIndex((s) => s.id === activeServerId),
    );
    itemRefs.current[activeIndex]?.focus();

    return () => document.removeEventListener('keydown', handleEscape);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, close]);

  const n = servers.length;
  const useGrid = n > maxRadialSize;

  const positions = useMemo(() => {
    if (useGrid) return [];
    const center = PANEL_SIZE / 2;
    if (n === 1) return [{ x: center, y: center }];
    return circularLayout({ count: n, radius: RADIUS }).map(({ x, y }) => ({ x: center + x, y: center + y }));
  }, [n, useGrid]);

  function handleSelect(id: string) {
    onSelectServer(id);
    close();
  }

  // Minimal focus management: Tab/Shift+Tab and the arrow keys all just
  // move focus to the next/previous item in array order and wrap around,
  // trapping focus inside the switcher without needing a full radial
  // spatial-navigation pattern.
  function handleContainerKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const buttons = itemRefs.current.filter((b): b is HTMLButtonElement => b !== null);
    if (buttons.length === 0) return;

    const forwardKeys = ['ArrowRight', 'ArrowDown'];
    const backwardKeys = ['ArrowLeft', 'ArrowUp'];
    if (e.key === 'Tab' || forwardKeys.includes(e.key) || backwardKeys.includes(e.key)) {
      e.preventDefault();
      const forward = forwardKeys.includes(e.key) || (e.key === 'Tab' && !e.shiftKey);
      const currentIndex = buttons.findIndex((b) => b === document.activeElement);
      const base = currentIndex === -1 ? 0 : currentIndex;
      const nextIndex = forward ? (base + 1) % buttons.length : (base - 1 + buttons.length) % buttons.length;
      buttons[nextIndex].focus();
    }
  }

  if (!isOpen) return null;

  return (
    <div className="radial-switcher-overlay" onClick={close} role="presentation">
      <div
        className="radial-switcher-panel"
        style={
          useGrid
            ? { left: anchor.x, top: anchor.y }
            : { left: anchor.x, top: anchor.y, width: PANEL_SIZE, height: PANEL_SIZE }
        }
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleContainerKeyDown}
        role="menu"
        aria-label="Sunucu hızlı geçiş"
      >
        {useGrid ? (
          <div className="radial-switcher-grid">
            {servers.map((server, i) => (
              <button
                key={server.id}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitem"
                className={`radial-switcher-item${server.id === activeServerId ? ' active' : ''}`}
                onClick={() => handleSelect(server.id)}
                title={server.name}
              >
                {serverInitials(server.name)}
              </button>
            ))}
          </div>
        ) : (
          servers.map((server, i) => {
            const pos = positions[i] ?? { x: PANEL_SIZE / 2, y: PANEL_SIZE / 2 };
            return (
              <button
                key={server.id}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitem"
                className={`radial-switcher-item${server.id === activeServerId ? ' active' : ''}`}
                style={{ left: pos.x - ITEM_SIZE / 2, top: pos.y - ITEM_SIZE / 2 }}
                onClick={() => handleSelect(server.id)}
                title={server.name}
              >
                {serverInitials(server.name)}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

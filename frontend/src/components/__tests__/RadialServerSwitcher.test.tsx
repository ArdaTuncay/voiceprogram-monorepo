import { useRef } from 'react';
import { act } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import RadialServerSwitcher from '../RadialServerSwitcher';
import type { Server } from '../../types';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function makeServers(count: number): Server[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `server-${i}`,
    name: `Server ${i}`,
    owner_id: 'owner',
  }));
}

function Harness({
  servers,
  activeServerId = null,
  onSelectServer,
  onTriggerClick,
  maxRadialSize,
}: {
  servers: Server[];
  activeServerId?: string | null;
  onSelectServer: (id: string) => void;
  onTriggerClick: () => void;
  maxRadialSize?: number;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={ref} onClick={onTriggerClick}>
        trigger
      </button>
      <RadialServerSwitcher
        servers={servers}
        activeServerId={activeServerId}
        onSelectServer={onSelectServer}
        triggerRef={ref}
        maxRadialSize={maxRadialSize}
      />
    </>
  );
}

/** Mirrors a real press-and-hold: pointerdown, wait past the long-press
 * threshold, pointerup, then the 'click' a real browser fires right after
 * release (jsdom won't synthesize that click for us). Wrapped in act()
 * since the timer callback updates state outside of any React event
 * handler — without it the update wouldn't be flushed before assertions. */
function longPress(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger);
  act(() => {
    vi.advanceTimersByTime(500);
  });
  fireEvent.pointerUp(trigger);
  fireEvent.click(trigger);
}

function shortClick(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger);
  fireEvent.pointerUp(trigger);
  fireEvent.click(trigger);
}

describe('RadialServerSwitcher', () => {
  it('stays closed on a normal short click and leaves the trigger\'s own click alone', () => {
    vi.useFakeTimers();
    const onTriggerClick = vi.fn();
    render(<Harness servers={makeServers(3)} onSelectServer={vi.fn()} onTriggerClick={onTriggerClick} />);

    shortClick(screen.getByText('trigger'));

    expect(onTriggerClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens on a long press and swallows the trailing click so the trigger\'s own action does not also fire', () => {
    vi.useFakeTimers();
    const onTriggerClick = vi.fn();
    render(<Harness servers={makeServers(3)} onSelectServer={vi.fn()} onTriggerClick={onTriggerClick} />);

    longPress(screen.getByText('trigger'));

    expect(screen.getByRole('menu')).not.toBeNull();
    expect(onTriggerClick).not.toHaveBeenCalled();
  });

  it('arranges servers in a circle and selects one on click, closing the overlay', () => {
    vi.useFakeTimers();
    const onSelectServer = vi.fn();
    render(<Harness servers={makeServers(3)} onSelectServer={onSelectServer} onTriggerClick={vi.fn()} />);

    longPress(screen.getByText('trigger'));
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(3);

    fireEvent.click(items[1]);

    expect(onSelectServer).toHaveBeenCalledWith('server-1');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on Escape', () => {
    vi.useFakeTimers();
    render(<Harness servers={makeServers(3)} onSelectServer={vi.fn()} onTriggerClick={vi.fn()} />);

    longPress(screen.getByText('trigger'));
    expect(screen.getByRole('menu')).not.toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes when clicking the backdrop outside the panel', () => {
    vi.useFakeTimers();
    render(<Harness servers={makeServers(3)} onSelectServer={vi.fn()} onTriggerClick={vi.fn()} />);

    longPress(screen.getByText('trigger'));
    expect(screen.getByRole('menu')).not.toBeNull();

    fireEvent.click(screen.getByRole('presentation'));

    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('falls back to a plain grid past maxRadialSize', () => {
    vi.useFakeTimers();
    render(<Harness servers={makeServers(5)} onSelectServer={vi.fn()} onTriggerClick={vi.fn()} maxRadialSize={4} />);

    longPress(screen.getByText('trigger'));

    expect(document.querySelector('.radial-switcher-grid')).not.toBeNull();
    expect(screen.getAllByRole('menuitem')).toHaveLength(5);
  });

  it('stays in circular mode at exactly maxRadialSize', () => {
    vi.useFakeTimers();
    render(<Harness servers={makeServers(4)} onSelectServer={vi.fn()} onTriggerClick={vi.fn()} maxRadialSize={4} />);

    longPress(screen.getByText('trigger'));

    expect(document.querySelector('.radial-switcher-grid')).toBeNull();
    expect(screen.getAllByRole('menuitem')).toHaveLength(4);
  });

  it('arrow keys move focus between items, wrapping around', () => {
    vi.useFakeTimers();
    render(<Harness servers={makeServers(3)} onSelectServer={vi.fn()} onTriggerClick={vi.fn()} />);

    longPress(screen.getByText('trigger'));
    const items = screen.getAllByRole('menuitem');
    const panel = screen.getByRole('menu');

    items[0].focus();
    fireEvent.keyDown(panel, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(items[1]);

    fireEvent.keyDown(panel, { key: 'ArrowLeft' });
    fireEvent.keyDown(panel, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(items[2]);
  });
});

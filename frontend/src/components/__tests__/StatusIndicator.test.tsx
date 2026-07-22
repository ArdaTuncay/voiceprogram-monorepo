import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import StatusIndicator from '../StatusIndicator';

afterEach(cleanup);

describe('StatusIndicator', () => {
  it('renders a filled dot for online', () => {
    render(<StatusIndicator status="online" />);
    const el = screen.getByRole('img', { name: 'Çevrimiçi' });
    expect(el).toHaveClass('status-indicator-online');
    expect(el.querySelector('.status-indicator-dot')).toBeNull();
  });

  it('renders a dashed ring for idle', () => {
    render(<StatusIndicator status="idle" />);
    const el = screen.getByRole('img', { name: 'Boşta' });
    expect(el).toHaveClass('status-indicator-idle');
    expect(el.querySelector('.status-indicator-dot')).toBeNull();
  });

  it('renders an inner dot plus outer ring for in_voice', () => {
    render(<StatusIndicator status="in_voice" />);
    const el = screen.getByRole('img', { name: 'Sesli görüşmede' });
    expect(el).toHaveClass('status-indicator-in_voice');
    expect(el.querySelector('.status-indicator-dot')).not.toBeNull();
  });

  it('renders a faint ring-only outline for offline', () => {
    render(<StatusIndicator status="offline" />);
    const el = screen.getByRole('img', { name: 'Çevrimdışı' });
    expect(el).toHaveClass('status-indicator-offline');
    expect(el.querySelector('.status-indicator-dot')).toBeNull();
  });

  it('applies the size prop as pixel dimensions', () => {
    render(<StatusIndicator status="online" size={20} />);
    const el = screen.getByRole('img', { name: 'Çevrimiçi' });
    expect(el.style.width).toBe('20px');
    expect(el.style.height).toBe('20px');
  });

  it('merges a caller-provided className for positioning', () => {
    render(<StatusIndicator status="online" className="dm-room-status-dot" />);
    const el = screen.getByRole('img', { name: 'Çevrimiçi' });
    expect(el).toHaveClass('status-indicator');
    expect(el).toHaveClass('dm-room-status-dot');
  });
});

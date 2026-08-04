import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ServerSidebar from '../ServerSidebar';
import { useServerStore } from '../../stores/useServerStore';
import type { Server } from '../../types';

vi.mock('../../services/api', () => ({
  fetchServerChannels: vi.fn().mockResolvedValue({ data: [] }),
}));

const servers: Server[] = [{ id: 'server-1', name: 'Test Sunucusu', owner_id: 'owner-1' }];

afterEach(cleanup);

beforeEach(() => {
  useServerStore.setState({
    servers,
    activeServerId: null,
    channels: [],
    activeChannelId: null,
    unreadChannelIds: new Set(),
    unreadServerIds: new Set(),
  });
});

describe('ServerSidebar', () => {
  it('renders a dedicated Arkadaşlar icon separate from Home', () => {
    render(<ServerSidebar friendsActive={false} onSelectFriends={vi.fn()} onNavigate={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Direkt Mesajlar' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Arkadaşlar' })).not.toBeNull();
  });

  it('calls onSelectFriends when the Arkadaşlar icon is clicked', () => {
    const onSelectFriends = vi.fn();
    render(<ServerSidebar friendsActive={false} onSelectFriends={onSelectFriends} onNavigate={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Arkadaşlar' }));

    expect(onSelectFriends).toHaveBeenCalledTimes(1);
  });

  it('marks the Arkadaşlar icon active (and Home inactive) when friendsActive is true', () => {
    render(<ServerSidebar friendsActive={true} onSelectFriends={vi.fn()} onNavigate={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Arkadaşlar' })).toHaveClass('active');
    expect(screen.getByRole('button', { name: 'Direkt Mesajlar' })).not.toHaveClass('active');
  });

  it('calls onNavigate (closing the Arkadaşlar view) when Home is clicked', () => {
    const onNavigate = vi.fn();
    render(<ServerSidebar friendsActive={true} onSelectFriends={vi.fn()} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole('button', { name: 'Direkt Mesajlar' }));

    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('calls onNavigate when a server icon is clicked', () => {
    const onNavigate = vi.fn();
    render(<ServerSidebar friendsActive={true} onSelectFriends={vi.fn()} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByTitle('Test Sunucusu'));

    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});

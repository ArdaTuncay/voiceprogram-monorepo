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

describe('ServerSidebar — sunucu ekleme menüsü', () => {
  it('menü kapalıyken sadece tek bir "+" tetikleyici butonu var, ayrı bir katıl butonu yok', () => {
    render(<ServerSidebar friendsActive={false} onSelectFriends={vi.fn()} onNavigate={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Sunucu Ekle' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Bir Sunucuya Katıl' })).toBeNull();
    expect(screen.queryByText('Sunucu Oluştur')).toBeNull();
  });

  it('"+" butonuna tıklayınca iki seçenekli menü açılır', () => {
    render(<ServerSidebar friendsActive={false} onSelectFriends={vi.fn()} onNavigate={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Sunucu Ekle' }));

    expect(screen.getByRole('menuitem', { name: /Sunucu Oluştur/ })).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: /Bir Sunucuya Katıl/ })).not.toBeNull();
  });

  it('"Sunucu Oluştur" seçilince Sunucu Oluştur modalı açılır ve menü kapanır', () => {
    render(<ServerSidebar friendsActive={false} onSelectFriends={vi.fn()} onNavigate={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Sunucu Ekle' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Sunucu Oluştur/ }));

    expect(screen.getByRole('heading', { name: 'Sunucu Oluştur' })).not.toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Sunucu Oluştur/ })).toBeNull();
  });

  it('"Bir Sunucuya Katıl" seçilince Katıl modalı açılır ve menü kapanır', () => {
    render(<ServerSidebar friendsActive={false} onSelectFriends={vi.fn()} onNavigate={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Sunucu Ekle' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Bir Sunucuya Katıl/ }));

    expect(screen.getByRole('heading', { name: 'Bir Sunucuya Katıl' })).not.toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Bir Sunucuya Katıl/ })).toBeNull();
  });

  it('dışarı tıklayınca menü kapanır', () => {
    render(<ServerSidebar friendsActive={false} onSelectFriends={vi.fn()} onNavigate={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Sunucu Ekle' }));
    expect(screen.getByRole('menuitem', { name: /Sunucu Oluştur/ })).not.toBeNull();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole('menuitem', { name: /Sunucu Oluştur/ })).toBeNull();
  });

  it('ESC ile menü kapanır', () => {
    render(<ServerSidebar friendsActive={false} onSelectFriends={vi.fn()} onNavigate={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Sunucu Ekle' }));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('menuitem', { name: /Sunucu Oluştur/ })).toBeNull();
  });
});

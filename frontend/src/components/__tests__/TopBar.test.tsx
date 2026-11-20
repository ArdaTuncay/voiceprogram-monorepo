import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import TopBar, { TopBarSearch, TopBarSlot } from '../TopBar';
import type { User } from '../../types';

afterEach(cleanup);

const user: User = { id: 'u1', username: 'ardatuncay', email: 'arda@example.com' };

function renderBar(overrides: Partial<Parameters<typeof TopBar>[0]> = {}) {
  const props = {
    user,
    isConnected: true,
    pendingRequestCount: 0,
    onOpenPendingRequests: vi.fn(),
    onOpenSettings: vi.fn(),
    onLogout: vi.fn(),
    slotRef: vi.fn(),
    ...overrides,
  };
  render(<TopBar {...props} />);
  return props;
}

describe('TopBar', () => {
  it('bekleyen istek varken zilde sayı gösterir ve tıklayınca isteklere götürür', () => {
    const props = renderBar({ pendingRequestCount: 2 });

    const bell = screen.getByRole('button', { name: 'Bildirimler: 2 arkadaşlık isteği' });
    expect(bell.textContent).toContain('2');
    fireEvent.click(bell);
    expect(props.onOpenPendingRequests).toHaveBeenCalledTimes(1);
  });

  it('istek yokken zilde rozet yok', () => {
    renderBar();
    expect(screen.getByRole('button', { name: 'Bildirimler' }).textContent).toBe('');
  });

  it('ayarlar düğmesi kullanıcı ayarlarını açar', () => {
    const props = renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Kullanıcı Ayarları' }));
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('profil menüsünden çıkış yapılır; ESC menüyü kapatır', () => {
    const props = renderBar();
    const trigger = screen.getByRole('button', { name: 'Profil menüsü' });

    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).not.toBeNull();
    expect(screen.getByText('Çevrimiçi')).not.toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Çıkış yap' }));
    expect(props.onLogout).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('bağlantı yokken menüde "Bağlantı Kesildi" yazar', () => {
    renderBar({ isConnected: false });
    fireEvent.click(screen.getByRole('button', { name: 'Profil menüsü' }));
    expect(screen.getByText('Bağlantı Kesildi')).not.toBeNull();
  });
});

describe('TopBarSlot', () => {
  it('üstte TopBar yokken içeriği yerinde gösterir', () => {
    render(<TopBarSlot><span>başlık</span></TopBarSlot>);
    expect(screen.getByText('başlık')).not.toBeNull();
  });
});

describe('TopBarSearch', () => {
  it('kapalıyken "Ara" yazar, açılınca içeriği gösterir', () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <TopBarSearch open={false} onToggle={onToggle}><input placeholder="içerik" /></TopBarSearch>,
    );
    expect(screen.getByText('Ara')).not.toBeNull();
    expect(screen.queryByPlaceholderText('içerik')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Mesajlarda ara' }));
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(<TopBarSearch open onToggle={onToggle}><input placeholder="içerik" /></TopBarSearch>);
    expect(screen.queryByText('Ara')).toBeNull();
    expect(screen.getByPlaceholderText('içerik')).not.toBeNull();
  });
});

describe('TopBar — profil menüsü klavye', () => {
  it('ok tuşları öğeler arasında gezer', () => {
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Profil menüsü' }));
    const items = screen.getAllByRole('menuitem');
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(document, { key: 'End' });
    expect(document.activeElement).toBe(items[1]);
  });
});

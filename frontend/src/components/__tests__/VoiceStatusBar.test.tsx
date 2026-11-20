import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import VoiceStatusBar from '../VoiceStatusBar';

afterEach(cleanup);

const baseProps = {
  isMuted: false,
  isDeafened: false,
  onToggleMute: vi.fn(),
  onToggleDeafen: vi.fn(),
  onLeave: vi.fn(),
};

describe('VoiceStatusBar — render koşulları', () => {
  it('roomName verilmediğinde kanal/sunucu adı bloğu render edilmez', () => {
    render(<VoiceStatusBar {...baseProps} />);

    expect(screen.queryByText('genel')).toBeNull();
    expect(screen.queryByText('Test Sunucu')).toBeNull();
  });

  it('roomName verildiğinde kanal adı (ve varsa sunucu adı) gösterilir', () => {
    render(<VoiceStatusBar {...baseProps} roomName="genel" serverName="Test Sunucu" />);

    expect(screen.getByText('genel')).not.toBeNull();
    expect(screen.getByText('Test Sunucu')).not.toBeNull();
  });

  it('roomName verilip serverName verilmediğinde sadece kanal adı gösterilir', () => {
    render(<VoiceStatusBar {...baseProps} roomName="genel" />);

    expect(screen.getByText('genel')).not.toBeNull();
    expect(screen.queryByText('Test Sunucu')).toBeNull();
  });

  it('varsayılan (belirtilmeyen) variant "inline" — kendi konumlandırma/arkaplan stilini taşımaz', () => {
    const { container } = render(<VoiceStatusBar {...baseProps} />);

    expect(container.querySelector('.voice-status-bar-inline')).not.toBeNull();
    expect(container.querySelector('.voice-status-bar-fixed')).toBeNull();
  });

  it('variant="fixed" verildiğinde sabit-konumlu sınıf uygulanır', () => {
    const { container } = render(<VoiceStatusBar {...baseProps} variant="fixed" />);

    expect(container.querySelector('.voice-status-bar-fixed')).not.toBeNull();
    expect(container.querySelector('.voice-status-bar-inline')).toBeNull();
  });
});

describe('VoiceStatusBar — üç buton doğru action\'ları çağırıyor', () => {
  it('mikrofon butonu onToggleMute\'u çağırır ve isMuted durumunu yansıtır', () => {
    const onToggleMute = vi.fn();
    render(<VoiceStatusBar {...baseProps} isMuted onToggleMute={onToggleMute} />);

    const btn = screen.getByRole('button', { name: 'Mikrofonu Aç' });
    expect(btn).toHaveClass('active');

    fireEvent.click(btn);
    expect(onToggleMute).toHaveBeenCalledTimes(1);
  });

  it('kulaklık (sağırlaştır) butonu onToggleDeafen\'ı çağırır ve isDeafened durumunu yansıtır', () => {
    const onToggleDeafen = vi.fn();
    render(<VoiceStatusBar {...baseProps} isDeafened onToggleDeafen={onToggleDeafen} />);

    const btn = screen.getByRole('button', { name: 'Sağırlaştırmayı Kaldır' });
    expect(btn).toHaveClass('active');

    fireEvent.click(btn);
    expect(onToggleDeafen).toHaveBeenCalledTimes(1);
  });

  it('"Kanaldan Ayrıl" butonu onLeave\'i çağırır', () => {
    const onLeave = vi.fn();
    render(<VoiceStatusBar {...baseProps} onLeave={onLeave} />);

    fireEvent.click(screen.getByRole('button', { name: 'Kanaldan Ayrıl' }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });
});

describe('VoiceStatusBar — ekran paylaşımı ve Birlikte İzle', () => {
  it('işleyici verilmezse bu iki buton gösterilmez', () => {
    render(<VoiceStatusBar {...baseProps} />);
    expect(screen.queryByRole('button', { name: 'Ekranı Paylaş' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Birlikte İzle' })).toBeNull();
  });

  it('verilince gösterilir, durumu ve tıklamayı yansıtır', () => {
    const onToggleScreenShare = vi.fn();
    const onToggleWatchParty = vi.fn();
    render(
      <VoiceStatusBar
        {...baseProps}
        isScreenSharing
        onToggleScreenShare={onToggleScreenShare}
        isWatchPartyOpen
        onToggleWatchParty={onToggleWatchParty}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ekranı Durdur' }));
    expect(onToggleScreenShare).toHaveBeenCalledTimes(1);

    const watch = screen.getByRole('button', { name: 'Birlikte İzle' });
    expect(watch.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(watch);
    expect(onToggleWatchParty).toHaveBeenCalledTimes(1);
  });
});

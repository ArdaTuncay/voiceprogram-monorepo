import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import VoiceOrbit from '../VoiceOrbit';
import type { OrbitParticipant } from '../VoiceOrbit';

afterEach(cleanup);

function makeParticipants(count: number, overrides: Partial<OrbitParticipant> = {}): OrbitParticipant[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `user-${i}`,
    displayName: `User ${i}`,
    initials: `U${i}`,
    avatarColor: '#123456',
    isSpeaking: false,
    isMuted: false,
    isDeafened: false,
    isReconnecting: false,
    statusText: 'Ses Bağlantısı Aktif',
    ...overrides,
  }));
}

describe('VoiceOrbit', () => {
  it('renders a single centered avatar for 1 participant, skipping orbit geometry', () => {
    const { container } = render(<VoiceOrbit participants={makeParticipants(1)} />);
    expect(container.querySelectorAll('.voice-orbit-single .voice-orbit-avatar')).toHaveLength(1);
    expect(container.querySelectorAll('.voice-orbit')).toHaveLength(0);
    expect(container.querySelectorAll('.voice-participant')).toHaveLength(0);
  });

  it('renders nothing (no avatars) for 0 participants', () => {
    const { container } = render(<VoiceOrbit participants={[]} />);
    expect(container.querySelectorAll('.voice-orbit-avatar')).toHaveLength(0);
  });

  it('arranges 3 participants in a circle with distinct positions', () => {
    const { container } = render(<VoiceOrbit participants={makeParticipants(3)} />);
    const slots = container.querySelectorAll<HTMLElement>('.voice-orbit-participant');
    expect(slots).toHaveLength(3);

    const points = Array.from(slots).map((el) => ({
      left: parseFloat(el.style.left),
      top: parseFloat(el.style.top),
    }));
    // All three positions should be distinct (a real circle, not stacked on
    // top of each other).
    const uniquePairs = new Set(points.map((p) => `${p.left.toFixed(1)},${p.top.toFixed(1)}`));
    expect(uniquePairs.size).toBe(3);

    // First participant (index 0) is placed at the top of the circle, so
    // its horizontal position should sit at the container's center.
    const container_ = container.querySelector<HTMLElement>('.voice-orbit')!;
    const containerSize = parseFloat(container_.style.width);
    expect(points[0].left + 15).toBeCloseTo(containerSize / 2, 0); // +15 = half of base avatar size (30px)
  });

  it('stays in orbit mode at exactly maxOrbitSize participants', () => {
    const { container } = render(<VoiceOrbit participants={makeParticipants(8)} />);
    expect(container.querySelectorAll('.voice-orbit-participant')).toHaveLength(8);
    expect(container.querySelectorAll('.voice-participant')).toHaveLength(0);
  });

  it('falls back to the stacked list one participant past maxOrbitSize', () => {
    const { container } = render(<VoiceOrbit participants={makeParticipants(9)} />);
    expect(container.querySelectorAll('.voice-participant')).toHaveLength(9);
    expect(container.querySelectorAll('.voice-orbit')).toHaveLength(0);
    expect(container.querySelectorAll('.voice-orbit-participant')).toHaveLength(0);
  });

  it('honors a custom maxOrbitSize override for the fallback boundary', () => {
    const orbitStillFits = render(<VoiceOrbit participants={makeParticipants(4)} maxOrbitSize={4} />);
    expect(orbitStillFits.container.querySelectorAll('.voice-orbit-participant')).toHaveLength(4);
    cleanup();

    const fallsBack = render(<VoiceOrbit participants={makeParticipants(5)} maxOrbitSize={4} />);
    expect(fallsBack.container.querySelectorAll('.voice-participant')).toHaveLength(5);
  });

  it('grows and rings a speaking participant', () => {
    const participants = makeParticipants(3, { isSpeaking: false });
    participants[1].isSpeaking = true;
    const { container } = render(<VoiceOrbit participants={participants} />);
    const avatars = container.querySelectorAll<HTMLElement>('.voice-orbit-avatar');
    const speaking = container.querySelector<HTMLElement>('.voice-orbit-avatar.speaking')!;
    expect(speaking).not.toBeNull();
    const speakingWidth = parseFloat(speaking.style.width);
    const nonSpeakingWidth = parseFloat(
      Array.from(avatars).find((el) => !el.classList.contains('speaking'))!.style.width,
    );
    expect(speakingWidth).toBeGreaterThan(nonSpeakingWidth);
  });

  it('shows a mute badge for a muted participant', () => {
    const participants = makeParticipants(2, { isMuted: false });
    participants[0].isMuted = true;
    const { container } = render(<VoiceOrbit participants={participants} />);
    expect(container.querySelectorAll('.voice-orbit-badge-mute')).toHaveLength(1);
  });

  it('preserves fallback-list mute/deafen icons and reconnecting text past maxOrbitSize', () => {
    const participants = makeParticipants(9, { isMuted: false, isDeafened: false, isReconnecting: false });
    participants[0].isMuted = true;
    participants[1].isDeafened = true;
    participants[2].isReconnecting = true;
    participants[2].statusText = 'Yeniden Bağlanıyor...';
    const { container } = render(<VoiceOrbit participants={participants} />);
    expect(container.querySelectorAll('.mute-icon')).toHaveLength(1);
    expect(container.querySelectorAll('.deafen-icon')).toHaveLength(1);
    expect(container.querySelector('.voice-participant-status.reconnecting')?.textContent).toContain(
      'Yeniden Bağlanıyor...',
    );
  });
});

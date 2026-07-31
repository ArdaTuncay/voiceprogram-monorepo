import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import EmptyState from '../EmptyState';

afterEach(cleanup);

describe('EmptyState', () => {
  it('renders the mascot image and the given message', () => {
    render(<EmptyState message="Sohbet etmeye başlamak için bir kişi veya kanal seç" />);

    const img = screen.getByRole('img', { name: 'Zircle maskotu' });
    expect(img.getAttribute('src')).toBeTruthy();
    expect(screen.getByText('Sohbet etmeye başlamak için bir kişi veya kanal seç')).not.toBeNull();
  });

  it('renders whatever message it is given, not a hardcoded one', () => {
    render(<EmptyState message="Bir kanal seç" />);
    expect(screen.getByText('Bir kanal seç')).not.toBeNull();
  });
});

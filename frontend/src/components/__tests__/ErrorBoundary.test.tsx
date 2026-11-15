import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ErrorBoundary from '../ErrorBoundary';

function Boom(): never {
  throw new Error('render patladı');
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('renders its children normally', () => {
    render(
      <ErrorBoundary>
        <p>her şey yolunda</p>
      </ErrorBoundary>
    );

    expect(screen.getByText('her şey yolunda')).not.toBeNull();
  });

  it('shows a recovery screen instead of a blank page when a child throws while rendering', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );

    expect(screen.getByRole('alert')).not.toBeNull();
    expect(screen.getByText('Bir şeyler ters gitti')).not.toBeNull();
    expect(consoleError).toHaveBeenCalled();
  });

  it('reloads the page from the recovery screen', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload });

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sayfayı yenile' }));

    expect(reload).toHaveBeenCalled();
  });
});

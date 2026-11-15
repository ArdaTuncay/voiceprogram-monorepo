import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import ReportModal from '../ReportModal';

vi.mock('../../services/api', () => ({ reportMessage: vi.fn() }));

import { reportMessage } from '../../services/api';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ReportModal', () => {
  it('needs a reason before it can be sent', () => {
    render(<ReportModal target={{ kind: 'message', id: 'm1' }} onClose={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'Raporla' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('sends the reason and trimmed details, then thanks the user', async () => {
    vi.mocked(reportMessage).mockResolvedValue({ data: { id: 'r1' } });
    render(<ReportModal target={{ kind: 'message', id: 'm1' }} onClose={vi.fn()} />);

    fireEvent.click(screen.getByLabelText('Taciz veya zorbalık'));
    fireEvent.change(screen.getByLabelText('Açıklama (isteğe bağlı)'), { target: { value: '  sürekli  ' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Raporla' }));
    });

    expect(reportMessage).toHaveBeenCalledWith({ kind: 'message', id: 'm1' }, 'harassment', 'sürekli');
    expect(screen.getByText(/raporun iletildi/i)).not.toBeNull();
  });

  it('tells a DM reporter it goes to the Zircle team', () => {
    render(<ReportModal target={{ kind: 'dm', id: 'd1' }} onClose={vi.fn()} />);
    expect(screen.getByText(/Zircle ekibine/)).not.toBeNull();
  });

  it('shows the server error, e.g. a duplicate report', async () => {
    vi.mocked(reportMessage).mockResolvedValue({ error: 'Bu mesajı zaten raporladın' });
    render(<ReportModal target={{ kind: 'message', id: 'm1' }} onClose={vi.fn()} />);

    fireEvent.click(screen.getByLabelText('Spam'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Raporla' }));
    });

    expect(screen.getByText('Bu mesajı zaten raporladın')).not.toBeNull();
  });
});

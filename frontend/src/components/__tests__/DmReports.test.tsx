import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import DmReports from '../DmReports';
import type { DmReport } from '../../types';

vi.mock('../../services/api', () => ({
  fetchDmReports: vi.fn(),
  reviewDmReport: vi.fn(),
}));

import { fetchDmReports, reviewDmReport } from '../../services/api';

function report(overrides: Partial<DmReport>): DmReport {
  return {
    id: 'r1',
    reason: 'harassment',
    details: 'sürekli yazıyor',
    content: 'özelden taciz',
    file_url: null,
    file_type: null,
    dm_message_id: 'm1',
    status: 'open',
    created_at: '2026-11-16T10:00:00Z',
    reporter: { id: 'u1', username: 'ayse' },
    reported_user: { id: 'u2', username: 'mehmet' },
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DmReports', () => {
  it('lists each open report with who, why and the copy of the message', async () => {
    vi.mocked(fetchDmReports).mockResolvedValue({ data: [report({})] });
    render(<DmReports />);

    const item = await screen.findByRole('listitem');
    expect(within(item).getByText('mehmet')).toBeInTheDocument();
    expect(within(item).getByText('Taciz veya zorbalık')).toBeInTheDocument();
    expect(within(item).getByText(/Raporlayan: ayse/)).toBeInTheDocument();
    expect(within(item).getByText('özelden taciz')).toBeInTheDocument();
    expect(within(item).getByText('sürekli yazıyor')).toBeInTheDocument();
  });

  it('shows an attached image, and links any other file', async () => {
    vi.mocked(fetchDmReports).mockResolvedValue({
      data: [
        report({ id: 'img', content: '', file_url: '/api/files/a', file_type: 'image/png' }),
        report({ id: 'pdf', content: '', file_url: '/api/files/b', file_type: 'application/pdf' }),
      ],
    });
    render(<DmReports />);

    const [image, pdf] = await screen.findAllByRole('listitem');
    expect(within(image).getByRole('img').getAttribute('src')).toMatch(/\/api\/files\/a$/);
    const link = within(pdf).getByRole('link', { name: 'Eki aç' });
    expect(link.getAttribute('href')).toMatch(/\/api\/files\/b$/);
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('closes a report as resolved or dismissed, taking it off the list', async () => {
    vi.mocked(fetchDmReports).mockResolvedValue({ data: [report({ id: 'a' }), report({ id: 'b' })] });
    vi.mocked(reviewDmReport).mockResolvedValue({ data: { id: 'a', status: 'resolved' } });
    render(<DmReports />);

    const [first] = await screen.findAllByRole('listitem');
    fireEvent.click(within(first).getByRole('button', { name: 'Çözüldü' }));

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    expect(reviewDmReport).toHaveBeenCalledWith('a', 'resolved');

    vi.mocked(reviewDmReport).mockResolvedValue({ data: { id: 'b', status: 'dismissed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Yoksay' }));

    expect(await screen.findByText('Açık rapor yok.')).toBeInTheDocument();
    expect(reviewDmReport).toHaveBeenLastCalledWith('b', 'dismissed');
  });

  it('keeps a report whose review failed, and says why', async () => {
    vi.mocked(fetchDmReports).mockResolvedValue({ data: [report({})] });
    vi.mocked(reviewDmReport).mockResolvedValue({ error: 'Rapor bulunamadı' });
    render(<DmReports />);

    fireEvent.click(await screen.findByRole('button', { name: 'Yoksay' }));

    expect(await screen.findByText('Rapor bulunamadı')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('says so when the list could not be loaded', async () => {
    vi.mocked(fetchDmReports).mockResolvedValue({ error: 'Yasak' });
    render(<DmReports />);

    expect(await screen.findByText('Yasak')).toBeInTheDocument();
  });
});

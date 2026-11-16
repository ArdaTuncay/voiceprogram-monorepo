import { useEffect, useState } from 'react';
import { Paperclip } from 'lucide-react';
import type { DmReport } from '../types';
import { fetchDmReports, reviewDmReport } from '../services/api';
import { resolveFileUrl } from '../config';
import { reportReasonLabel } from '../utils/reports';
import { currentLocale, useT } from '../i18n';
import './DmReports.css';

function formatWhen(iso: string): string {
  const date = new Date(iso.includes('Z') ? iso : `${iso}Z`);
  return date.toLocaleString(currentLocale(), { dateStyle: 'medium', timeStyle: 'short' });
}

/** Settings → DM Raporları, for platform admins only (see
 * BackendWeb.AdminReportController): the open reports on direct messages,
 * which have no server staff to review them. Each keeps a copy of the
 * message, so it's still here after the message is deleted. */
export default function DmReports() {
  const t = useT();
  const [reports, setReports] = useState<DmReport[] | null>(null);
  const [error, setError] = useState('');
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchDmReports().then(({ data, error }) => {
      if (cancelled) return;
      if (data) setReports(data);
      else setError(error ?? t('Raporlar alınamadı'));
    });
    return () => {
      cancelled = true;
    };
  }, [t]);

  async function review(reportId: string, status: 'resolved' | 'dismissed') {
    setReviewingId(reportId);
    setError('');
    const { error } = await reviewDmReport(reportId, status);
    setReviewingId(null);
    if (error) {
      setError(error);
      return;
    }
    setReports((prev) => prev?.filter((r) => r.id !== reportId) ?? prev);
  }

  if (!reports) {
    return <p className="user-settings-placeholder">{error || t('Yükleniyor…')}</p>;
  }

  return (
    <div className="dm-reports">
      {error && <p className="account-form-message account-form-message-error">{error}</p>}
      <ul className="dm-reports-list">
        {reports.map((report) => (
          <li key={report.id} className="dm-report">
            <div className="dm-report-head">
              <span className="dm-report-user">{report.reported_user.username ?? t('Bilinmeyen')}</span>
              <span className="dm-report-reason">{reportReasonLabel(report.reason)}</span>
              <span className="dm-report-meta">
                {t('Raporlayan: {name}', { name: report.reporter.username ?? t('Bilinmeyen') })} ·{' '}
                {formatWhen(report.created_at)}
              </span>
            </div>
            {(report.content || !report.file_url) && (
              <div className="dm-report-content">{report.content || t('(boş mesaj)')}</div>
            )}
            {report.file_url &&
              (report.file_type?.startsWith('image/') ? (
                <img className="dm-report-image" src={resolveFileUrl(report.file_url)} alt={t('Dosya eki')} />
              ) : (
                <a
                  className="dm-report-file"
                  href={resolveFileUrl(report.file_url)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Paperclip size={14} aria-hidden="true" />
                  {t('Eki aç')}
                </a>
              ))}
            {report.details && <div className="dm-report-meta">{report.details}</div>}
            <div className="dm-report-actions">
              <button
                type="button"
                className="dm-report-btn"
                onClick={() => void review(report.id, 'dismissed')}
                disabled={reviewingId === report.id}
              >
                {t('Yoksay')}
              </button>
              <button
                type="button"
                className="account-form-submit-btn"
                onClick={() => void review(report.id, 'resolved')}
                disabled={reviewingId === report.id}
              >
                {t('Çözüldü')}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {reports.length === 0 && <p className="user-settings-placeholder">{t('Açık rapor yok.')}</p>}
    </div>
  );
}

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { reportMessage } from '../services/api';
import type { ReportReason, ReportTarget } from '../types';
import { REPORT_REASONS_IN_ORDER, reportReasonLabel } from '../utils/reports';
import { useT } from '../i18n';
import Modal from './Modal';
import './ReportModal.css';

interface Props {
  target: ReportTarget;
  onClose: () => void;
}

/** Reports a channel or DM message (see Backend.Reports). Channel reports go
 * to the server's owner and moderators; DM reports to the Zircle team. */
export default function ReportModal({ target, onClose }: Props) {
  const t = useT();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function handleSubmit() {
    if (!reason) return;
    setSending(true);
    setError('');
    const { error } = await reportMessage(target, reason, details.trim());
    setSending(false);

    if (error) {
      setError(error);
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <Modal title={t('Mesajı Raporla')} onClose={onClose}>
        <p className="report-description">{t('Raporun iletildi. Teşekkürler, inceleyeceğiz.')}</p>
        <div className="report-actions">
          <button className="report-submit-btn" onClick={onClose}>
            {t('Kapat')}
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={t('Mesajı Raporla')} onClose={onClose}>
      <p className="report-description">
        {target.kind === 'dm'
          ? t('Bu rapor Zircle ekibine iletilir.')
          : t('Bu rapor sunucunun sahibine ve moderatörlerine iletilir.')}{' '}
        {t('Mesajın bir kopyası raporla birlikte saklanır.')}
      </p>

      <fieldset className="report-reasons">
        <legend>{t('Sebep')}</legend>
        {REPORT_REASONS_IN_ORDER.map((r) => (
          <label key={r} className="report-reason">
            <input
              type="radio"
              name="report-reason"
              value={r}
              checked={reason === r}
              onChange={() => setReason(r)}
            />
            {reportReasonLabel(r)}
          </label>
        ))}
      </fieldset>

      <label className="report-details-label">
        {t('Açıklama (isteğe bağlı)')}
        <textarea
          className="report-details"
          value={details}
          maxLength={500}
          rows={3}
          onChange={(e) => setDetails(e.target.value)}
        />
      </label>

      {error && (
        <div className="report-error">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      <div className="report-actions">
        <button className="report-cancel-btn" onClick={onClose} disabled={sending}>
          {t('Vazgeç')}
        </button>
        <button className="report-submit-btn" onClick={handleSubmit} disabled={!reason || sending}>
          {sending ? t('Gönderiliyor…') : t('Raporla')}
        </button>
      </div>
    </Modal>
  );
}

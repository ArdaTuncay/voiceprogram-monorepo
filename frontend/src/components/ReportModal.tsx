import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { reportMessage } from '../services/api';
import type { ReportReason, ReportTarget } from '../types';
import { REPORT_REASON_LABELS } from '../utils/reports';
import Modal from './Modal';
import './ReportModal.css';

interface Props {
  target: ReportTarget;
  onClose: () => void;
}

const REASONS = Object.keys(REPORT_REASON_LABELS) as ReportReason[];

/** Reports a channel or DM message (see Backend.Reports). Channel reports go
 * to the server's owner and moderators; DM reports to the Zircle team. */
export default function ReportModal({ target, onClose }: Props) {
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
      <Modal title="Mesajı Raporla" onClose={onClose}>
        <p className="report-description">Raporun iletildi. Teşekkürler, inceleyeceğiz.</p>
        <div className="report-actions">
          <button className="report-submit-btn" onClick={onClose}>
            Kapat
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Mesajı Raporla" onClose={onClose}>
      <p className="report-description">
        {target.kind === 'dm'
          ? 'Bu rapor Zircle ekibine iletilir.'
          : 'Bu rapor sunucunun sahibine ve moderatörlerine iletilir.'}{' '}
        Mesajın bir kopyası raporla birlikte saklanır.
      </p>

      <fieldset className="report-reasons">
        <legend>Sebep</legend>
        {REASONS.map((r) => (
          <label key={r} className="report-reason">
            <input
              type="radio"
              name="report-reason"
              value={r}
              checked={reason === r}
              onChange={() => setReason(r)}
            />
            {REPORT_REASON_LABELS[r]}
          </label>
        ))}
      </fieldset>

      <label className="report-details-label">
        Açıklama (isteğe bağlı)
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
          Vazgeç
        </button>
        <button className="report-submit-btn" onClick={handleSubmit} disabled={!reason || sending}>
          {sending ? 'Gönderiliyor…' : 'Raporla'}
        </button>
      </div>
    </Modal>
  );
}

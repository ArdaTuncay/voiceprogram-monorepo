import { useState } from 'react';
import type { FormEvent } from 'react';
import Modal from './Modal';
import './JoinServerModal.css';

interface Props {
  /** Returns an error message on failure, or `undefined` on success. */
  onJoin: (code: string) => Promise<string | undefined>;
  onClose: () => void;
}

export default function JoinServerModal({ onJoin, onClose }: Props) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;

    setSubmitting(true);
    const errorMessage = await onJoin(trimmed);
    setSubmitting(false);

    if (errorMessage) {
      setError(errorMessage);
      return;
    }

    onClose();
  }

  return (
    <Modal title="Bir Sunucuya Katıl" onClose={onClose}>
      <p className="join-description">
        Bir arkadaşından aldığın davet kodunu aşağıya gir.
      </p>
      <form className="join-form" onSubmit={handleSubmit}>
        <input
          autoFocus
          className="join-code-input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Davet kodu"
          disabled={submitting}
        />
        {error && <div className="join-error">⚠ {error}</div>}
        <button className="join-submit-btn" type="submit" disabled={submitting || !code.trim()}>
          {submitting ? 'Katılınıyor…' : 'Katıl'}
        </button>
      </form>
    </Modal>
  );
}

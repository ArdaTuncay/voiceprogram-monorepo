import { useState } from 'react';
import type { FormEvent } from 'react';
import Modal from './Modal';
import './CreateServerModal.css';

interface Props {
  /** Returns an error message on failure, or `undefined` on success. */
  onCreate: (name: string) => Promise<string | undefined>;
  onClose: () => void;
}

export default function CreateServerModal({ onCreate, onClose }: Props) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setSubmitting(true);
    const errorMessage = await onCreate(trimmed);
    setSubmitting(false);

    if (errorMessage) {
      setError(errorMessage);
      return;
    }

    onClose();
  }

  return (
    <Modal title="Sunucu Oluştur" onClose={onClose}>
      <p className="create-server-description">
        Sunucun senin ve arkadaşlarının bir araya geldiği yer. Bir isim ver, hemen oluştur.
      </p>
      <form className="create-server-form" onSubmit={handleSubmit}>
        <label className="create-server-label" htmlFor="create-server-name">
          Sunucu Adı
        </label>
        <input
          id="create-server-name"
          autoFocus
          className="create-server-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="örn. Arkadaş Grubu"
          maxLength={50}
          disabled={submitting}
        />
        {error && <div className="create-server-error">⚠ {error}</div>}
        <button
          className="create-server-submit-btn"
          type="submit"
          disabled={submitting || !name.trim()}
        >
          {submitting ? 'Oluşturuluyor…' : 'Oluştur'}
        </button>
      </form>
    </Modal>
  );
}

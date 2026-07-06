import { useState } from 'react';
import type { FormEvent } from 'react';
import { createChannel } from '../services/api';
import Modal from './Modal';
import './CreateChannelModal.css';

interface Props {
  serverId: string;
  type: 'text' | 'voice';
  onClose: () => void;
}

export default function CreateChannelModal({ serverId, type, onClose }: Props) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const title = type === 'text' ? 'Metin Kanalı Oluştur' : 'Ses Kanalı Oluştur';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setSubmitting(true);
    setError('');
    const { error } = await createChannel(serverId, trimmed, type);
    setSubmitting(false);

    if (error) {
      setError(error);
      return;
    }

    // On success the new channel appears once the "channel_created" broadcast
    // updates Chat.tsx's channel list — see Backend.Servers.create_channel/2.
    onClose();
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form className="create-channel-form" onSubmit={handleSubmit}>
        <label className="create-channel-label" htmlFor="create-channel-name">
          Kanal Adı
        </label>
        <div className="create-channel-input-row">
          <span className="create-channel-input-icon">{type === 'voice' ? '🔊' : '#'}</span>
          <input
            id="create-channel-name"
            autoFocus
            className="create-channel-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={type === 'voice' ? 'yeni-ses-kanalı' : 'yeni-kanal'}
            maxLength={50}
            disabled={submitting}
          />
        </div>
        {error && <div className="create-channel-error">⚠ {error}</div>}
        <button
          className="create-channel-submit-btn"
          type="submit"
          disabled={submitting || !name.trim()}
        >
          {submitting ? 'Oluşturuluyor…' : 'Kanal Oluştur'}
        </button>
      </form>
    </Modal>
  );
}

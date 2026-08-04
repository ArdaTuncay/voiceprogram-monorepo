import { useState } from 'react';
import type { FormEvent } from 'react';
import { Hash, Volume2, Folder, AlertTriangle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ChannelType } from '../types';
import { useServerStore } from '../stores/useServerStore';
import Modal from './Modal';
import './CreateChannelModal.css';

interface Props {
  type: ChannelType;
  /** Groups the new text/voice channel under this category — ignored (and
   * omitted) when `type === 'category'`, since categories can't be nested. */
  parentId?: string | null;
  onClose: () => void;
}

const TITLES: Record<ChannelType, string> = {
  text: 'Metin Kanalı Oluştur',
  voice: 'Ses Kanalı Oluştur',
  category: 'Kategori Oluştur',
};

const ICONS: Record<ChannelType, LucideIcon> = { text: Hash, voice: Volume2, category: Folder };
const PLACEHOLDERS: Record<ChannelType, string> = {
  text: 'yeni-kanal',
  voice: 'yeni-ses-kanalı',
  category: 'YENİ KATEGORİ',
};

export default function CreateChannelModal({ type, parentId, onClose }: Props) {
  const Icon = ICONS[type];
  const createChannel = useServerStore((s) => s.createChannel);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setSubmitting(true);
    setError('');
    const error = await createChannel(trimmed, type, type === 'category' ? undefined : parentId);
    setSubmitting(false);

    if (error) {
      setError(error);
      return;
    }

    // On success the new channel appears once the "channel_created" broadcast
    // updates useServerStore's channel list — see Backend.Servers.create_channel/2.
    onClose();
  }

  return (
    <Modal title={TITLES[type]} onClose={onClose}>
      <form className="create-channel-form" onSubmit={handleSubmit}>
        <label className="create-channel-label" htmlFor="create-channel-name">
          {type === 'category' ? 'Kategori Adı' : 'Kanal Adı'}
        </label>
        <div className="create-channel-input-row">
          <span className="create-channel-input-icon"><Icon size={16} /></span>
          <input
            id="create-channel-name"
            autoFocus
            className="create-channel-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={PLACEHOLDERS[type]}
            maxLength={50}
            disabled={submitting}
          />
        </div>
        {error && <div className="create-channel-error"><AlertTriangle size={14} /> {error}</div>}
        <button
          className="create-channel-submit-btn"
          type="submit"
          disabled={submitting || !name.trim()}
        >
          {submitting ? 'Oluşturuluyor…' : type === 'category' ? 'Kategori Oluştur' : 'Kanal Oluştur'}
        </button>
      </form>
    </Modal>
  );
}

import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Server } from '../types';
import JoinServerModal from './JoinServerModal';
import './ServerSidebar.css';

interface Props {
  servers: Server[];
  activeServerId: string | null;
  onSelect: (serverId: string) => void;
  /** Returns an error message on failure, or `undefined` on success. */
  onCreate: (name: string) => Promise<string | undefined>;
  /** Returns an error message on failure, or `undefined` on success. */
  onJoin: (code: string) => Promise<string | undefined>;
}

function serverInitials(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('');
  return (initials || '?').toUpperCase();
}

export default function ServerSidebar({ servers, activeServerId, onSelect, onCreate, onJoin }: Props) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);

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

    setName('');
    setError('');
    setCreating(false);
  }

  return (
    <aside className="server-sidebar">
      <div className="server-icon-list">
        {servers.map((server) => (
          <button
            key={server.id}
            className={`server-icon${server.id === activeServerId ? ' active' : ''}`}
            onClick={() => onSelect(server.id)}
            title={server.name}
          >
            {serverInitials(server.name)}
          </button>
        ))}
      </div>

      <div className="server-create-area">
        {creating ? (
          <form className="server-create-form" onSubmit={handleSubmit}>
            <input
              autoFocus
              className="server-create-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                if (!name.trim()) {
                  setCreating(false);
                  setError('');
                }
              }}
              placeholder="Sunucu adı"
              maxLength={50}
              disabled={submitting}
            />
            {error && <div className="server-create-error">{error}</div>}
          </form>
        ) : (
          <button
            className="server-icon server-icon-create"
            onClick={() => setCreating(true)}
            title="Sunucu Oluştur"
            aria-label="Sunucu Oluştur"
          >
            +
          </button>
        )}

        <button
          className="server-icon server-icon-join"
          onClick={() => setShowJoinModal(true)}
          title="Bir Sunucuya Katıl"
          aria-label="Bir Sunucuya Katıl"
        >
          ➜
        </button>
      </div>

      {showJoinModal && (
        <JoinServerModal onJoin={onJoin} onClose={() => setShowJoinModal(false)} />
      )}
    </aside>
  );
}

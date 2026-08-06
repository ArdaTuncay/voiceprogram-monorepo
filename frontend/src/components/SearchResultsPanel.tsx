import { X, Paperclip } from 'lucide-react';
import type { ChatMessage } from '../types';
import { userColor, initials } from '../utils';
import { formatMessageTime } from '../utils/formatMessageTime';

interface Props {
  results: ChatMessage[];
  isSearching: boolean;
  onSelectMessage: (messageId: string) => void;
  onClose: () => void;
}

/** Shared by Chat.tsx and DMChatView.tsx — the right-hand panel that opens
 * after a search, listing `searchResults` from useChatStore/useDMStore.
 * Clicking a result asks the caller (via `onSelectMessage`) to jump to and
 * highlight that message back in the main message list. */
export default function SearchResultsPanel({ results, isSearching, onSelectMessage, onClose }: Props) {
  return (
    <aside className="search-results-panel">
      <div className="search-results-header">
        <span>Arama Sonuçları{!isSearching && results.length > 0 ? ` — ${results.length}` : ''}</span>
        <button
          type="button"
          className="search-results-close-btn"
          onClick={onClose}
          title="Kapat"
          aria-label="Kapat"
        >
          <X size={14} />
        </button>
      </div>

      <div className="search-results-list">
        {isSearching && <div className="channel-status">Aranıyor…</div>}
        {!isSearching && results.length === 0 && <div className="list-empty-hint">Sonuç bulunamadı</div>}
        {!isSearching &&
          results.map((msg) => {
            const color = userColor(msg.user_id);
            const name = msg.username ?? 'Bilinmeyen';
            return (
              <div key={msg.id} className="search-result-item" onClick={() => onSelectMessage(msg.id)}>
                <div className="search-result-avatar" style={{ background: color }} title={name}>
                  {initials(name)}
                </div>
                <div className="search-result-body">
                  <div className="search-result-meta">
                    <span className="search-result-author" style={{ color }}>
                      {name}
                    </span>
                    <span className="search-result-time">{formatMessageTime(msg.inserted_at)}</span>
                  </div>
                  {msg.content && <div className="search-result-content">{msg.content}</div>}
                  {msg.file_url && <div className="search-result-file-tag"><Paperclip size={12} /> Ek</div>}
                </div>
              </div>
            );
          })}
      </div>
    </aside>
  );
}

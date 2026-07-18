import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { SearchFilters } from '../types';

interface Props {
  isSearching: boolean;
  onSearch: (filters: SearchFilters) => void;
}

/** Shared by Chat.tsx (channel header) and DMChatView.tsx (DM header) — a
 * magnifier input that triggers a search on Enter or when the attachment
 * filter is toggled. Each caller wires `onSearch` to its own store's search
 * action (useChatStore.searchChannelMessages / useDMStore.searchDmMessages). */
export default function SearchBar({ isSearching, onSearch }: Props) {
  const [query, setQuery] = useState('');
  const [hasFileOnly, setHasFileOnly] = useState(false);

  function runSearch(nextHasFileOnly: boolean) {
    const trimmed = query.trim();
    if (!trimmed && !nextHasFileOnly) return;
    onSearch({ query: trimmed || undefined, has_file: nextHasFileOnly || undefined });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') runSearch(hasFileOnly);
  }

  function toggleHasFileOnly() {
    const next = !hasFileOnly;
    setHasFileOnly(next);
    runSearch(next);
  }

  return (
    <div className="search-bar">
      <span className="search-bar-icon">🔍</span>
      <input
        type="text"
        className="search-bar-input"
        placeholder="Mesajlarda ara..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <button
        type="button"
        className={`search-bar-filter-btn${hasFileOnly ? ' active' : ''}`}
        onClick={toggleHasFileOnly}
        title="Sadece dosyalı mesajlar"
        aria-label="Sadece dosyalı mesajlar"
        aria-pressed={hasFileOnly}
      >
        📎
      </button>
      {isSearching && <span className="search-bar-spinner" aria-hidden="true" />}
    </div>
  );
}

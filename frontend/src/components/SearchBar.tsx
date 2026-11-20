import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Search, Paperclip } from 'lucide-react';
import type { SearchFilters } from '../types';
import { useT } from '../i18n';

interface Props {
  isSearching: boolean;
  onSearch: (filters: SearchFilters) => void;
  /** Focus the input as soon as it appears (the top bar's search pill opens
   * straight into typing). */
  autoFocus?: boolean;
}

/** Shared by Chat.tsx (channel header) and DMChatView.tsx (DM header) — a
 * magnifier input that triggers a search on Enter or when the attachment
 * filter is toggled. Each caller wires `onSearch` to its own store's search
 * action (useChatStore.searchChannelMessages / useDMStore.searchDmMessages). */
export default function SearchBar({ isSearching, onSearch, autoFocus = false }: Props) {
  const t = useT();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);
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
      <span className="search-bar-icon"><Search size={14} /></span>
      <input
        ref={inputRef}
        type="text"
        className="search-bar-input"
        placeholder={t('Mesajlarda ara...')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <button
        type="button"
        className={`search-bar-filter-btn${hasFileOnly ? ' active' : ''}`}
        onClick={toggleHasFileOnly}
        title={t('Sadece dosyalı mesajlar')}
        aria-label={t('Sadece dosyalı mesajlar')}
        aria-pressed={hasFileOnly}
      >
        <Paperclip size={13} />
      </button>
      {isSearching && <span className="search-bar-spinner" aria-hidden="true" />}
    </div>
  );
}

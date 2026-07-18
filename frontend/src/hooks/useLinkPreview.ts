import { useEffect, useState } from 'react';
import type { LinkPreview } from '../types';
import { fetchLinkPreview } from '../services/api';

// Module-level (not per-component) so switching channels/rescrolling doesn't
// re-fetch a link already looked up this session. `null` means "fetched, but
// failed or had nothing useful" — cached too, so a broken link isn't retried
// on every render.
const cache = new Map<string, LinkPreview | null>();

/** Fetches (and caches) OpenGraph metadata for `url`, in the background —
 * never blocks message rendering/sending. Returns null until resolved, or
 * if there's nothing worth showing. */
export function useLinkPreview(url: string | null): LinkPreview | null {
  const [preview, setPreview] = useState<LinkPreview | null>(() => (url ? (cache.get(url) ?? null) : null));

  useEffect(() => {
    if (!url) {
      setPreview(null);
      return;
    }
    if (cache.has(url)) {
      setPreview(cache.get(url) ?? null);
      return;
    }

    let cancelled = false;
    fetchLinkPreview(url).then(({ data }) => {
      const result = data ?? null;
      cache.set(url, result);
      if (!cancelled) setPreview(result);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return preview;
}

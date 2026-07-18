import { useState } from 'react';

const STORAGE_KEY = 'zircle_collapsed_categories';

function loadCollapsedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function saveCollapsedIds(ids: Set<string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(ids)));
}

/** Tracks which channel categories are collapsed in the sidebar accordion,
 * persisted to localStorage (shared across every server — category ids are
 * unique regardless) so a reload doesn't re-expand everything. */
export function useCollapsedCategories() {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(loadCollapsedIds);

  function toggleCategory(categoryId: string) {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      saveCollapsedIds(next);
      return next;
    });
  }

  return { collapsedIds, toggleCategory };
}

import { useEffect, useRef } from 'react';

/** Grows a <textarea> to fit its content as `value` changes, up to the
 * element's CSS `max-height` (where it scrolls instead, same as any other
 * textarea) — recalculated on every change since a textarea's `scrollHeight`
 * doesn't shrink back down on its own once content is removed. */
export function useAutoGrowTextarea(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return ref;
}

import { useEffect, useRef, useState } from 'react';
import { Plus, Hash, Volume2, FolderPlus } from 'lucide-react';
import type { ChannelType } from '../types';
import './ChannelAddMenu.css';

interface Props {
  onSelect: (type: ChannelType) => void;
  /** Nested categories aren't supported, so the per-category "+" (as opposed
   * to the top-level toolbar one) only offers text/voice. */
  includeCategory?: boolean;
  label: string;
}

const OPTIONS: { type: ChannelType; label: string; icon: typeof Hash }[] = [
  { type: 'text', label: 'Metin kanalı', icon: Hash },
  { type: 'voice', label: 'Sesli kanal', icon: Volume2 },
  { type: 'category', label: 'Kategori', icon: FolderPlus },
];

/** Single "+" trigger that replaces what used to be one icon button per
 * channel type — opens a small dropdown ("Metin kanalı" / "Sesli kanal" /
 * "Kategori") instead of cluttering the toolbar with 2-3 separate icons. */
export default function ChannelAddMenu({ onSelect, includeCategory = true, label }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const options = includeCategory ? OPTIONS : OPTIONS.filter((o) => o.type !== 'category');

  return (
    <div className="channel-add-menu" ref={rootRef}>
      <button
        type="button"
        className="channel-add-menu-trigger"
        onClick={() => setOpen((o) => !o)}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Plus size={14} />
      </button>
      {open && (
        <div className="channel-add-menu-dropdown" role="menu">
          {options.map(({ type, label: optionLabel, icon: Icon }) => (
            <button
              key={type}
              type="button"
              role="menuitem"
              className="channel-add-menu-option"
              onClick={() => {
                onSelect(type);
                setOpen(false);
              }}
            >
              <Icon size={14} />
              {optionLabel}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { X } from 'lucide-react';
import type { ThemePreference } from '../services/theme';
import { getStoredPreference, setThemePreference } from '../services/theme';
import './UserSettingsModal.css';

type Category =
  | 'account'
  | 'appearance'
  | 'notifications'
  | 'voice'
  | 'privacy'
  | 'shortcuts'
  | 'data';

const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'account', label: 'Hesabım' },
  { id: 'appearance', label: 'Görünüm' },
  { id: 'notifications', label: 'Bildirimler' },
  { id: 'voice', label: 'Ses & Görüntü' },
  { id: 'privacy', label: 'Gizlilik & Güvenlik' },
  { id: 'shortcuts', label: 'Klavye Kısayolları' },
  { id: 'data', label: 'Hesap Silme / Veri Yönetimi' },
];

interface Props {
  onClose: () => void;
}

/** Discord-style full-screen settings shell: a vertical category rail on
 * the left, selected category's content on the right. Only "Görünüm" is
 * actually wired up right now — the rest get a placeholder until their own
 * turns. Deliberately its own overlay/layout rather than reusing the
 * shared Modal component, which is a narrow centered dialog and not suited
 * to this wide, two-pane shape. */
export default function UserSettingsModal({ onClose }: Props) {
  const [category, setCategory] = useState<Category>('appearance');

  useEffect(() => {
    function handleKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const activeLabel = CATEGORIES.find((c) => c.id === category)!.label;

  return (
    <div className="user-settings-overlay">
      <button
        className="user-settings-close-btn"
        onClick={onClose}
        title="Kapat (ESC)"
        aria-label="Kapat"
      >
        <X size={22} />
      </button>

      <div className="user-settings-panel">
        <nav className="user-settings-sidebar" aria-label="Ayar kategorileri">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`user-settings-category${category === c.id ? ' active' : ''}`}
              onClick={() => setCategory(c.id)}
            >
              {c.label}
            </button>
          ))}
        </nav>

        <div className="user-settings-content">
          {category === 'appearance' ? (
            <AppearanceSettings />
          ) : (
            <PlaceholderSettings label={activeLabel} />
          )}
        </div>
      </div>
    </div>
  );
}

function PlaceholderSettings({ label }: { label: string }) {
  return (
    <div className="user-settings-section">
      <h3 className="user-settings-heading">{label}</h3>
      <p className="user-settings-placeholder">Yakında</p>
    </div>
  );
}

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Açık' },
  { value: 'dark', label: 'Koyu' },
  { value: 'system', label: 'Sistem' },
];

function AppearanceSettings() {
  const [preference, setPreference] = useState<ThemePreference>(getStoredPreference);

  function select(value: ThemePreference) {
    setThemePreference(value);
    setPreference(value);
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const index = THEME_OPTIONS.findIndex((o) => o.value === preference);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      select(THEME_OPTIONS[(index + 1) % THEME_OPTIONS.length].value);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      select(THEME_OPTIONS[(index - 1 + THEME_OPTIONS.length) % THEME_OPTIONS.length].value);
    }
  }

  return (
    <div className="user-settings-section">
      <h3 className="user-settings-heading">Görünüm</h3>

      <label className="user-settings-label" id="theme-preference-label">
        Tema
      </label>
      <div
        className="theme-segmented-control"
        role="radiogroup"
        aria-labelledby="theme-preference-label"
        onKeyDown={handleKeyDown}
      >
        {THEME_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={preference === opt.value}
            className={`theme-segmented-option${preference === opt.value ? ' active' : ''}`}
            onClick={() => select(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

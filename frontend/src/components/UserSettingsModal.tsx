import { useEffect, useState } from 'react';
import type { ChangeEvent, FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import type { User } from '../types';
import type { ThemePreference } from '../services/theme';
import { getStoredPreference, setThemePreference } from '../services/theme';
import { updateEmail, updatePassword, updateUsername } from '../services/api';
import { disconnectSocket } from '../services/socket';
import { forceLogout } from '../services/session';
import type { NotificationPreferences } from '../services/notificationPreferences';
import { getNotificationPreferences, updateNotificationPreference } from '../services/notificationPreferences';
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
  user: User;
  onClose: () => void;
}

/** Discord-style full-screen settings shell: a vertical category rail on
 * the left, selected category's content on the right. "Hesabım" and
 * "Görünüm" are wired up — the rest get a placeholder until their own
 * turns. Deliberately its own overlay/layout rather than reusing the
 * shared Modal component, which is a narrow centered dialog and not suited
 * to this wide, two-pane shape. */
export default function UserSettingsModal({ user, onClose }: Props) {
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
          {category === 'account' ? (
            <AccountSettings user={user} />
          ) : category === 'appearance' ? (
            <AppearanceSettings />
          ) : category === 'notifications' ? (
            <NotificationSettings />
          ) : category === 'shortcuts' ? (
            <ShortcutsSettings />
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

type FormStatus = 'idle' | 'submitting' | 'success' | 'error';

function StatusMessage({ type, message }: { type: 'error' | 'success'; message: string }) {
  return (
    <div className={`account-form-message account-form-message-${type}`}>
      {type === 'error' ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
      {message}
    </div>
  );
}

/** Hesabım — username, email, and password all require re-entering the
 * current password (Discord-style re-auth for a sensitive change — see
 * BackendWeb.AccountController), each as its own independent form with its
 * own success/error state so changing one doesn't reset or block the
 * others. */
function AccountSettings({ user }: { user: User }) {
  return (
    <div className="user-settings-section">
      <h3 className="user-settings-heading">Hesabım</h3>
      <UsernameForm currentUsername={user.username} />
      <EmailForm currentEmail={user.email} />
      <PasswordForm />
    </div>
  );
}

function UsernameForm({ currentUsername }: { currentUsername: string }) {
  const [username, setUsername] = useState(currentUsername);
  const [currentPassword, setCurrentPassword] = useState('');
  const [status, setStatus] = useState<FormStatus>('idle');
  const [message, setMessage] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus('submitting');
    setMessage('');

    const result = await updateUsername(username.trim(), currentPassword);
    if (result.error) {
      setStatus('error');
      setMessage(result.error);
      return;
    }
    setStatus('success');
    setMessage('Kullanıcı adın güncellendi.');
    setCurrentPassword('');
  }

  const trimmed = username.trim();
  const disabled = status === 'submitting' || !trimmed || trimmed === currentUsername || !currentPassword;

  return (
    <form className="account-form" onSubmit={handleSubmit}>
      <h4 className="account-form-title">Kullanıcı Adı</h4>

      <label className="user-settings-label" htmlFor="account-username-input">
        Yeni kullanıcı adı
      </label>
      <input
        id="account-username-input"
        className="account-form-input"
        value={username}
        onChange={(e: ChangeEvent<HTMLInputElement>) => setUsername(e.target.value)}
        maxLength={30}
        disabled={status === 'submitting'}
      />

      <label className="user-settings-label" htmlFor="account-username-password">
        Mevcut şifre
      </label>
      <input
        id="account-username-password"
        type="password"
        className="account-form-input"
        value={currentPassword}
        onChange={(e: ChangeEvent<HTMLInputElement>) => setCurrentPassword(e.target.value)}
        autoComplete="current-password"
        disabled={status === 'submitting'}
      />

      <button className="account-form-submit-btn" type="submit" disabled={disabled}>
        {status === 'submitting' ? 'Kaydediliyor…' : 'Kullanıcı Adını Değiştir'}
      </button>

      {status === 'error' && <StatusMessage type="error" message={message} />}
      {status === 'success' && <StatusMessage type="success" message={message} />}
    </form>
  );
}

function EmailForm({ currentEmail }: { currentEmail: string }) {
  const [email, setEmail] = useState(currentEmail);
  const [currentPassword, setCurrentPassword] = useState('');
  const [status, setStatus] = useState<FormStatus>('idle');
  const [message, setMessage] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus('submitting');
    setMessage('');

    const result = await updateEmail(email.trim(), currentPassword);
    if (result.error) {
      setStatus('error');
      setMessage(result.error);
      return;
    }
    setStatus('success');
    setMessage('E-posta adresin güncellendi.');
    setCurrentPassword('');
  }

  const trimmed = email.trim();
  const disabled = status === 'submitting' || !trimmed || trimmed === currentEmail || !currentPassword;

  return (
    <form className="account-form" onSubmit={handleSubmit}>
      <h4 className="account-form-title">E-posta</h4>

      <label className="user-settings-label" htmlFor="account-email-input">
        Yeni e-posta
      </label>
      <input
        id="account-email-input"
        type="email"
        className="account-form-input"
        value={email}
        onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
        disabled={status === 'submitting'}
      />

      <label className="user-settings-label" htmlFor="account-email-password">
        Mevcut şifre
      </label>
      <input
        id="account-email-password"
        type="password"
        className="account-form-input"
        value={currentPassword}
        onChange={(e: ChangeEvent<HTMLInputElement>) => setCurrentPassword(e.target.value)}
        autoComplete="current-password"
        disabled={status === 'submitting'}
      />

      <button className="account-form-submit-btn" type="submit" disabled={disabled}>
        {status === 'submitting' ? 'Kaydediliyor…' : 'E-postayı Değiştir'}
      </button>

      {status === 'error' && <StatusMessage type="error" message={message} />}
      {status === 'success' && <StatusMessage type="success" message={message} />}
    </form>
  );
}

function PasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState<FormStatus>('idle');
  const [message, setMessage] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage('');

    if (newPassword !== confirmPassword) {
      setStatus('error');
      setMessage('Yeni şifreler eşleşmiyor.');
      return;
    }

    setStatus('submitting');
    const result = await updatePassword(currentPassword, newPassword);
    if (result.error) {
      setStatus('error');
      setMessage(result.error);
      return;
    }

    setStatus('success');
    setMessage(
      'Şifren değiştirildi. Diğer tüm cihazlarda (ve bu oturumda da) oturum kapatıldı — birazdan yeniden giriş yapman gerekecek.'
    );
    // The token this very request used is now invalid too (see
    // updatePassword's doc comment) — end the session deliberately after
    // giving the user a moment to read the message, instead of leaving
    // them looking logged in until some unrelated request 401s on them.
    window.setTimeout(() => {
      disconnectSocket();
      forceLogout();
    }, 2500);
  }

  const locked = status === 'submitting' || status === 'success';
  const disabled = locked || !currentPassword || !newPassword || !confirmPassword;

  return (
    <form className="account-form" onSubmit={handleSubmit}>
      <h4 className="account-form-title">Şifre</h4>

      <label className="user-settings-label" htmlFor="account-password-current">
        Mevcut şifre
      </label>
      <input
        id="account-password-current"
        type="password"
        className="account-form-input"
        value={currentPassword}
        onChange={(e: ChangeEvent<HTMLInputElement>) => setCurrentPassword(e.target.value)}
        autoComplete="current-password"
        disabled={locked}
      />

      <label className="user-settings-label" htmlFor="account-password-new">
        Yeni şifre
      </label>
      <input
        id="account-password-new"
        type="password"
        className="account-form-input"
        value={newPassword}
        onChange={(e: ChangeEvent<HTMLInputElement>) => setNewPassword(e.target.value)}
        autoComplete="new-password"
        disabled={locked}
      />

      <label className="user-settings-label" htmlFor="account-password-confirm">
        Yeni şifre (tekrar)
      </label>
      <input
        id="account-password-confirm"
        type="password"
        className="account-form-input"
        value={confirmPassword}
        onChange={(e: ChangeEvent<HTMLInputElement>) => setConfirmPassword(e.target.value)}
        autoComplete="new-password"
        disabled={locked}
      />

      <button className="account-form-submit-btn" type="submit" disabled={disabled}>
        {status === 'submitting' ? 'Kaydediliyor…' : 'Şifreyi Değiştir'}
      </button>

      {status === 'error' && <StatusMessage type="error" message={message} />}
      {status === 'success' && <StatusMessage type="success" message={message} />}
    </form>
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

function ToggleSwitch({
  id,
  label,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`toggle-row${disabled ? ' disabled' : ''}`} htmlFor={id}>
      <span className="toggle-row-label">{label}</span>
      <span className="toggle-switch">
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.checked)}
        />
        <span className="toggle-switch-track" />
      </span>
    </label>
  );
}

/** Client-side only, entirely localStorage-backed (see
 * services/notificationPreferences.ts) — no backend involved. The master
 * switch just gates whether the other three do anything in
 * useSocketStore.ts; it doesn't touch the unread-dot/badge system, which
 * is unrelated navigation state. */
function NotificationSettings() {
  const [prefs, setPrefs] = useState<NotificationPreferences>(getNotificationPreferences);
  const [permissionNote, setPermissionNote] = useState('');

  function set<K extends keyof NotificationPreferences>(key: K, value: NotificationPreferences[K]) {
    setPrefs(updateNotificationPreference(key, value));
  }

  async function handleDesktopToggle(checked: boolean) {
    setPermissionNote('');
    if (checked && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
      const result = await Notification.requestPermission();
      if (result !== 'granted') {
        setPermissionNote('Tarayıcı bildirim izni reddedildi — masaüstü bildirimleri gösterilemeyecek.');
        set('desktop', false);
        return;
      }
    }
    set('desktop', checked);
  }

  return (
    <div className="user-settings-section">
      <h3 className="user-settings-heading">Bildirimler</h3>

      <ToggleSwitch
        id="notif-enabled"
        label="Bildirimleri etkinleştir"
        checked={prefs.enabled}
        onChange={(checked) => set('enabled', checked)}
      />

      <div className="toggle-subgroup">
        <ToggleSwitch
          id="notif-sound"
          label="Ses bildirimleri"
          checked={prefs.sound}
          disabled={!prefs.enabled}
          onChange={(checked) => set('sound', checked)}
        />
        <ToggleSwitch
          id="notif-desktop"
          label="Masaüstü bildirimleri"
          checked={prefs.desktop}
          disabled={!prefs.enabled}
          onChange={(checked) => void handleDesktopToggle(checked)}
        />
        {permissionNote && <StatusMessage type="error" message={permissionNote} />}
        <ToggleSwitch
          id="notif-mentions-only"
          label="Sadece bahsedilmelerde bildir"
          checked={prefs.mentionsOnly}
          disabled={!prefs.enabled}
          onChange={(checked) => set('mentionsOnly', checked)}
        />
      </div>
    </div>
  );
}

interface Shortcut {
  keys: string[];
  description: string;
}

// Static list of what's actually wired up in the codebase today (see
// Chat.tsx/DMChatView.tsx's handleKeyDown, MessageItem.tsx's
// handleEditKeyDown, this modal's own Escape handler, and SearchBar.tsx) —
// not an aspirational list, and not editable/rebindable in this pass.
const SHORTCUTS: Shortcut[] = [
  { keys: ['Enter'], description: 'Mesaj gönder / mesaj düzenlemeyi kaydet' },
  { keys: ['Shift', 'Enter'], description: 'Yeni satır' },
  { keys: ['Esc'], description: 'Bu pencereyi kapat / mesaj düzenlemeyi iptal et' },
  { keys: ['Enter'], description: 'Arama kutusunda mesajlarda ara' },
];

function ShortcutsSettings() {
  return (
    <div className="user-settings-section">
      <h3 className="user-settings-heading">Klavye Kısayolları</h3>

      <div className="shortcuts-list">
        {SHORTCUTS.map((shortcut, i) => (
          <div className="shortcuts-row" key={i}>
            <span className="shortcuts-keys">
              {shortcut.keys.map((key, j) => (
                <span key={j}>
                  {j > 0 && <span className="shortcuts-plus">+</span>}
                  <kbd className="shortcuts-kbd">{key}</kbd>
                </span>
              ))}
            </span>
            <span className="shortcuts-description">{shortcut.description}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

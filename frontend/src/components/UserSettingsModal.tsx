import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import type { FriendRequestPrivacy, User } from '../types';
import type { ThemePreference } from '../services/theme';
import { getStoredPreference, setThemePreference } from '../services/theme';
import {
  deleteAccount,
  updateEmail,
  updateFriendRequestPrivacy,
  updatePassword,
  updateUsername,
} from '../services/api';
import { useFriendStore } from '../stores/useFriendStore';
import { disconnectSocket } from '../services/socket';
import { forceLogout } from '../services/session';
import type { NotificationPreferences } from '../services/notificationPreferences';
import { getNotificationPreferences, updateNotificationPreference } from '../services/notificationPreferences';
import type { MediaPreferences } from '../services/mediaPreferences';
import {
  getMediaPreferences,
  resolveMicConstraint,
  supportsOutputDeviceSelection,
  updateMediaPreference,
} from '../services/mediaPreferences';
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
          ) : category === 'voice' ? (
            <VoiceSettings />
          ) : category === 'privacy' ? (
            <PrivacySettings user={user} />
          ) : (
            <AccountDeletionSettings />
          )}
        </div>
      </div>
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

/** Ses & Görüntü — real input/output device lists from enumerateDevices(),
 * persisted via services/mediaPreferences.ts (same localStorage pattern as
 * theme.ts/notificationPreferences.ts). The output-device picker only
 * renders when the browser actually supports HTMLMediaElement.setSinkId
 * (Firefox doesn't) — hidden entirely rather than shown and silently
 * doing nothing. */
function VoiceSettings() {
  const [prefs, setPrefs] = useState<MediaPreferences>(getMediaPreferences);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([]);
  const [deviceError, setDeviceError] = useState('');
  const outputSupported = supportsOutputDeviceSelection();

  const loadDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setMics(devices.filter((d) => d.kind === 'audioinput'));
      setSpeakers(devices.filter((d) => d.kind === 'audiooutput'));
      setDeviceError('');
    } catch {
      setDeviceError('Cihaz listesi alınamadı.');
    }
  }, []);

  useEffect(() => {
    void loadDevices();
    // Devices are re-enumerated on plug/unplug, and (see MicTestButton)
    // right after a mic permission grant — browsers only return real
    // device labels once permission's been granted at least once, so the
    // dropdown starts out with generic "Mikrofon 1" placeholders until then.
    navigator.mediaDevices.addEventListener('devicechange', loadDevices);
    return () => navigator.mediaDevices.removeEventListener('devicechange', loadDevices);
  }, [loadDevices]);

  return (
    <div className="user-settings-section">
      <h3 className="user-settings-heading">Ses & Görüntü</h3>

      {deviceError && <StatusMessage type="error" message={deviceError} />}

      <label className="user-settings-label" htmlFor="voice-mic-select">
        Mikrofon
      </label>
      <select
        id="voice-mic-select"
        className="account-form-input voice-device-select"
        value={prefs.micDeviceId ?? ''}
        onChange={(e: ChangeEvent<HTMLSelectElement>) =>
          setPrefs(updateMediaPreference('micDeviceId', e.target.value || null))
        }
      >
        <option value="">Sistem varsayılanı</option>
        {mics.map((d, i) => (
          <option key={d.deviceId || i} value={d.deviceId}>
            {d.label || `Mikrofon ${i + 1}`}
          </option>
        ))}
      </select>

      {outputSupported && (
        <>
          <label className="user-settings-label" htmlFor="voice-speaker-select">
            Hoparlör
          </label>
          <select
            id="voice-speaker-select"
            className="account-form-input voice-device-select"
            value={prefs.speakerDeviceId ?? ''}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              setPrefs(updateMediaPreference('speakerDeviceId', e.target.value || null))
            }
          >
            <option value="">Sistem varsayılanı</option>
            {speakers.map((d, i) => (
              <option key={d.deviceId || i} value={d.deviceId}>
                {d.label || `Hoparlör ${i + 1}`}
              </option>
            ))}
          </select>
        </>
      )}

      <MicTestButton onPermissionGranted={loadDevices} />
    </div>
  );
}

/** Opens its own short-lived mic stream (independent of any active voice
 * channel call — this works whether or not you're in one) purely to drive
 * a live volume meter, using the same AnalyserNode technique
 * useVoiceChannel.ts's watchSpeaking does, just not wired into that hook's
 * per-peer bookkeeping since this has nothing to do with an active call. */
function MicTestButton({ onPermissionGranted }: { onPermissionGranted: () => void }) {
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState('');
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  const stopTest = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (ctxRef.current) {
      void ctxRef.current.close();
      ctxRef.current = null;
    }
    setTesting(false);
    setLevel(0);
  }, []);

  // Release the mic/AudioContext if this tab (or category) unmounts mid-test.
  useEffect(() => stopTest, [stopTest]);

  async function startTest() {
    setError('');
    try {
      const constraint = await resolveMicConstraint();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: constraint });
      streamRef.current = stream;
      onPermissionGranted();

      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((sum, v) => sum + v, 0) / data.length;
        setLevel(Math.min(100, Math.round((avg / 128) * 100)));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
      setTesting(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mikrofona erişilemedi');
      stopTest();
    }
  }

  return (
    <div className="mic-test">
      <button
        type="button"
        className="account-form-submit-btn"
        onClick={() => (testing ? stopTest() : void startTest())}
      >
        {testing ? 'Testi Durdur' : 'Mikrofonu Test Et'}
      </button>

      {testing && (
        <div
          className="mic-test-meter"
          role="meter"
          aria-label="Mikrofon seviyesi"
          aria-valuenow={level}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="mic-test-meter-fill" style={{ width: `${level}%` }} />
        </div>
      )}

      {error && <StatusMessage type="error" message={error} />}
    </div>
  );
}

const DELETE_CONFIRMATION_PHRASE = 'HESABIMI SİL';

/** Hesap Silme / Veri Yönetimi — the one irreversible action in this whole
 * modal, so it's gated harder than anything else here: current password
 * (same re-auth every other sensitive account change requires) AND a
 * checkbox AND typing an exact confirmation phrase, on top of the button
 * itself. See PROJECT_ARCHITECTURE.md's account deletion section and
 * Backend.Accounts.delete_account/2 for exactly what happens to each piece
 * of this account's data. */
function AccountDeletionSettings() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmationText, setConfirmationText] = useState('');
  const [status, setStatus] = useState<FormStatus>('idle');
  const [message, setMessage] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus('submitting');
    setMessage('');

    const result = await deleteAccount(currentPassword);
    if (result.error) {
      setStatus('error');
      setMessage(result.error);
      return;
    }

    setStatus('success');
    setMessage('Hesabın silindi. Giriş ekranına yönlendiriliyorsun…');
    window.setTimeout(() => {
      disconnectSocket();
      forceLogout();
    }, 2000);
  }

  const locked = status === 'submitting' || status === 'success';
  const disabled =
    locked ||
    !currentPassword ||
    !acknowledged ||
    confirmationText !== DELETE_CONFIRMATION_PHRASE;

  return (
    <div className="user-settings-section">
      <h3 className="user-settings-heading">Hesap Silme / Veri Yönetimi</h3>

      <div className="account-delete-warning">
        <AlertTriangle size={16} />
        <p>
          Hesabını silmek <strong>geri alınamaz</strong>. Kullanıcı adın ve e-postan
          anonimleştirilir, tüm arkadaşlıkların/engellemelerin kaldırılır ve üyesi olduğun
          sunuculardan çıkarılırsın. Tek başına sahibi olduğun bir sunucunun başka üyesi yoksa o
          sunucu (kanalları ve mesajlarıyla birlikte) tamamen silinir; başka üyesi varsa
          sahiplik en eski üyeye devredilir. Gönderdiğin mesajlar ve DM geçmişin İÇERİK olarak
          silinmez — sadece yazarın "[silinmiş kullanıcı]" olarak görünür.
        </p>
      </div>

      <form className="account-form" onSubmit={handleSubmit}>
        <label className="user-settings-label" htmlFor="account-delete-password">
          Mevcut şifre
        </label>
        <input
          id="account-delete-password"
          type="password"
          className="account-form-input"
          value={currentPassword}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
          disabled={locked}
        />

        <label className="account-delete-checkbox-row" htmlFor="account-delete-ack">
          <input
            id="account-delete-ack"
            type="checkbox"
            checked={acknowledged}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setAcknowledged(e.target.checked)}
            disabled={locked}
          />
          Bu işlemin geri alınamaz olduğunu anlıyorum.
        </label>

        <label className="user-settings-label" htmlFor="account-delete-confirm-text">
          Onaylamak için <strong>{DELETE_CONFIRMATION_PHRASE}</strong> yaz
        </label>
        <input
          id="account-delete-confirm-text"
          className="account-form-input"
          value={confirmationText}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setConfirmationText(e.target.value)}
          disabled={locked}
        />

        <button
          className="account-form-submit-btn account-delete-submit-btn"
          type="submit"
          disabled={disabled}
        >
          {status === 'submitting' ? 'Siliniyor…' : 'Hesabımı Sil'}
        </button>

        {status === 'error' && <StatusMessage type="error" message={message} />}
        {status === 'success' && <StatusMessage type="success" message={message} />}
      </form>
    </div>
  );
}

const PRIVACY_OPTIONS: { value: FriendRequestPrivacy; label: string }[] = [
  { value: 'everyone', label: 'Herkes' },
  { value: 'nobody', label: 'Kimse' },
];

/** Gizlilik & Güvenlik — who can send a friend request (entirely
 * server-enforced, see Backend.Friends.send_request/2, not just hidden in
 * the UI), plus the block list (see Backend.Friends.block_user/2 — history
 * with a blocked user is untouched, only new interaction is stopped). */
function PrivacySettings({ user }: { user: User }) {
  const [privacy, setPrivacy] = useState<FriendRequestPrivacy>(
    user.friend_request_privacy ?? 'everyone'
  );
  const blockedUsers = useFriendStore((s) => s.blockedUsers);
  const loadBlockedUsers = useFriendStore((s) => s.loadBlockedUsers);
  const unblockUser = useFriendStore((s) => s.unblockUser);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    void loadBlockedUsers();
  }, [loadBlockedUsers]);

  async function selectPrivacy(value: FriendRequestPrivacy) {
    setPrivacy(value);
    await updateFriendRequestPrivacy(value);
  }

  async function handleUnblock(userId: string) {
    setUnblockingId(userId);
    setMessage('');
    const error = await unblockUser(userId);
    setUnblockingId(null);
    if (error) setMessage(error);
  }

  return (
    <div className="user-settings-section">
      <h3 className="user-settings-heading">Gizlilik & Güvenlik</h3>

      <label className="user-settings-label" id="friend-privacy-label">
        Arkadaşlık isteklerini kimler gönderebilir
      </label>
      <div
        className="theme-segmented-control"
        role="radiogroup"
        aria-labelledby="friend-privacy-label"
      >
        {PRIVACY_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={privacy === opt.value}
            className={`theme-segmented-option${privacy === opt.value ? ' active' : ''}`}
            onClick={() => void selectPrivacy(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <h4 className="account-form-title privacy-blocked-title">Engellenen Kullanıcılar</h4>

      {message && <StatusMessage type="error" message={message} />}

      {blockedUsers.length === 0 ? (
        <p className="user-settings-placeholder">Kimseyi engellemedin.</p>
      ) : (
        <ul className="blocked-user-list">
          {blockedUsers.map((u) => (
            <li key={u.user_id} className="blocked-user-item">
              <span className="blocked-user-name">{u.username ?? 'Bilinmeyen'}</span>
              <button
                className="account-form-submit-btn"
                onClick={() => void handleUnblock(u.user_id)}
                disabled={unblockingId === u.user_id}
              >
                {unblockingId === u.user_id ? 'Kaldırılıyor…' : 'Engeli Kaldır'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

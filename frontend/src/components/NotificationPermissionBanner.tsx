import { useState } from 'react';
import { Bell, X } from 'lucide-react';
import { getNotificationPreferences } from '../services/notificationPreferences';
import './NotificationPermissionBanner.css';

export const BANNER_DISMISSED_KEY = 'zircle-notification-banner-dismissed';

function isDismissed(): boolean {
  try {
    return localStorage.getItem(BANNER_DISMISSED_KEY) === 'true';
  } catch {
    return false;
  }
}

function dismiss(): void {
  try {
    localStorage.setItem(BANNER_DISMISSED_KEY, 'true');
  } catch {
    // Not persisting the dismissal just means the banner may reappear next
    // session — not worth surfacing to the user.
  }
}

function shouldShow(): boolean {
  return (
    typeof Notification !== 'undefined' &&
    getNotificationPreferences().desktop &&
    Notification.permission === 'default' &&
    !isDismissed()
  );
}

/** One-time nudge to actually grant desktop notification permission,
 * replacing the old mount-time `requestPermission()` effect that used to
 * live in useSocketStore.ts. That effect fired outside of any click
 * handler, which Safari silently ignores — it only shows the permission
 * prompt when `requestPermission()` is called from inside a real
 * user-gesture handler, so on Safari the old effect never actually asked
 * and `desktop` notifications stayed permanently unreachable. Requesting
 * from this banner's own onClick satisfies that requirement everywhere. */
export default function NotificationPermissionBanner() {
  const [visible, setVisible] = useState(shouldShow);

  async function handleEnable() {
    await Notification.requestPermission();
    dismiss();
    setVisible(false);
  }

  function handleDismiss() {
    dismiss();
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="notification-permission-banner" role="status">
      <Bell size={16} className="notification-permission-banner-icon" />
      <span className="notification-permission-banner-text">
        Yeni mesajlardan haberdar olmak için masaüstü bildirimlerini etkinleştir.
      </span>
      <button
        className="notification-permission-banner-enable-btn"
        onClick={() => void handleEnable()}
      >
        Bildirimleri Etkinleştir
      </button>
      <button
        className="notification-permission-banner-close-btn"
        onClick={handleDismiss}
        aria-label="Kapat"
        title="Kapat"
      >
        <X size={14} />
      </button>
    </div>
  );
}

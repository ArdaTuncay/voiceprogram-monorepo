/**
 * User-facing error copy for values the backend sends in a
 * machine-oriented (English) form — HTTP error bodies, Ecto changeset
 * messages — which used to be shown to users raw. Kept in one place so
 * every call site maps the same value to the same text, and so an unknown
 * value always has a deliberate fallback instead of leaking through by
 * accident. See PROJECT_ARCHITECTURE.md §7 items 11, 12 and 15.
 *
 * Every message is translated when it's built (see ../i18n), so tables
 * here hold the Turkish source text and look it up per call.
 */
import type { PushFailure } from '../types';
import { currentLocale, t, type MessageKey } from '../i18n';

/** Errors for the unauthenticated auth requests — services/api.ts's post(). */
export const AUTH_REQUEST_ERRORS = {
  get timeout() {
    return t('Sunucu yanıt vermedi. Lütfen birkaç saniye sonra tekrar deneyin.');
  },
  get network() {
    return t('Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.');
  },
  get rateLimited() {
    return t('Çok fazla deneme yapıldı. Lütfen bir dakika bekleyip tekrar deneyin.');
  },
  get serverUnavailable() {
    return t('Sunucu şu anda yanıt veremiyor. Lütfen biraz sonra tekrar deneyin.');
  },
  get unexpected() {
    return t('Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.');
  },
};

/** For a response whose body isn't the JSON the backend always sends — e.g.
 * BackendWeb.RequireCloudflarePlug's empty-bodied 403, or a host/proxy's own
 * HTML error page (502/503) sitting in front of the backend — so there's no
 * `error` field to show, only the status code. */
export function httpStatusErrorMessage(status: number): string {
  if (status === 429) return AUTH_REQUEST_ERRORS.rateLimited;
  if (status >= 500) return AUTH_REQUEST_ERRORS.serverUnavailable;
  return t('Sunucudan beklenmeyen bir yanıt alındı (HTTP {status}). Lütfen tekrar deneyin.', { status });
}

const CHANGESET_FIELD_LABELS: Record<string, MessageKey> = {
  username: 'Kullanıcı adı',
  email: 'E-posta adresi',
  password: 'Şifre',
};

/**
 * One Ecto changeset error — its field plus the message BackendWeb.
 * UserController's format_errors/1 already interpolated (`%{count}` filled
 * in) — mapped to the UI language for the validations in
 * Backend.Accounts.User's registration_changeset/2. Anything not recognized
 * here (another field, a validation added later) falls back to the raw
 * `"<field> <message>"` text, exactly what was shown before this mapping
 * existed.
 */
export function changesetErrorMessage(field: string, message: string): string {
  const labelKey = CHANGESET_FIELD_LABELS[field];
  if (!labelKey) return `${field} ${message}`;
  const label = t(labelKey);

  if (message === "can't be blank") return t('{label} boş bırakılamaz.', { label });
  if (message === 'has already been taken') {
    return t('Bu {label} zaten kullanımda.', { label: label.toLocaleLowerCase(currentLocale()) });
  }
  if (message === 'must be a valid email') return t('Geçerli bir e-posta adresi girin.');
  if (message === 'only letters, numbers and underscores allowed') {
    return t('{label} yalnızca harf, rakam ve alt çizgi (_) içerebilir.', { label });
  }

  // Ecto's own validate_length/3 default ("should be at least %{count}
  // character(s)") and the password's custom message ("must be at least
  // %{count} characters") — matched by pattern rather than exact text so a
  // changed min/max on the backend still maps, with the new number.
  const atLeast = /^(?:should|must) be at least (\d+) character(?:s|\(s\))$/.exec(message);
  if (atLeast) return t('{label} en az {count} karakter olmalıdır.', { label, count: Number(atLeast[1]) });
  const atMost = /^should be at most (\d+) character\(s\)$/.exec(message);
  if (atMost) return t('{label} en fazla {count} karakter olabilir.', { label, count: Number(atMost[1]) });

  return `${field} ${message}`;
}

/** A whole changeset `errors` map flattened into one line. Mapped messages
 * are full sentences, so they're separated by a space; a raw fallback has no
 * closing punctuation, so the next item after it gets the ", " separator the
 * old raw-only output always used. */
export function changesetErrorsMessage(errors: Record<string, string[]>): string {
  return Object.entries(errors)
    .flatMap(([field, messages]) => messages.map((m) => changesetErrorMessage(field, m)))
    .reduce((line, msg) => {
      if (!line) return msg;
      return /[.!?]$/.test(line) ? `${line} ${msg}` : `${line}, ${msg}`;
    }, '');
}

/** A chat/DM action whose socket push the server can reject — see
 * useChatStore/useDMStore and services/socket.ts. */
export type ChatAction = 'send' | 'edit' | 'delete' | 'react';

const CHAT_ACTION_FAILED: Record<ChatAction, MessageKey> = {
  send: 'Mesaj gönderilemedi.',
  edit: 'Mesaj düzenlenemedi.',
  delete: 'Mesaj silinemedi.',
  react: 'Tepki güncellenemedi.',
};

// The `reason` values ChatChannel/DmChannel actually reply with. Both
// spellings of "not found" are real: update_message/delete_message reply
// "message not found", toggle_reaction replies "message_not_found".
const CHAT_ACTION_REASONS = new Map<string, MessageKey>([
  ['rate_limited', 'Çok hızlı işlem yapıyorsunuz. Lütfen birkaç saniye bekleyip tekrar deneyin.'],
  ['message not found', 'Mesaj bulunamadı, silinmiş olabilir.'],
  ['message_not_found', 'Mesaj bulunamadı, silinmiş olabilir.'],
  ['not authorized', 'Bu işlem için yetkiniz yok.'],
  ['blocked', 'Bu kişiyle aranızda engelleme olduğu için mesaj gönderilemiyor.'],
]);

/** Looks `key` up in `table` and translates the hit, or returns `fallback`. */
function lookup(table: Map<string, MessageKey>, key: string | undefined, fallback: MessageKey): string {
  const hit = key !== undefined ? table.get(key) : undefined;
  return t(hit ?? fallback);
}

/**
 * Feedback for a failed chat/DM push. A timeout gets a deliberately neutral
 * message rather than "failed": the push may still go through (see
 * PushFailure), so the user is told to check rather than to resend. An
 * unknown or absent reason (e.g. a changeset `errors` reply) gets a generic
 * retry hint — never the raw reason string.
 */
export function chatActionErrorMessage(action: ChatAction, failure: PushFailure): string {
  if (failure.kind === 'timeout') {
    return action === 'send'
      ? t('Sunucudan yanıt alınamadı; mesajın gönderilip gönderilmediği doğrulanamadı. Lütfen sohbeti kontrol edin.')
      : t('Sunucudan yanıt alınamadı; işlemin tamamlanıp tamamlanmadığı doğrulanamadı.');
  }
  const detail = lookup(CHAT_ACTION_REASONS, failure.reason, 'Lütfen tekrar deneyin.');
  return `${t(CHAT_ACTION_FAILED[action])} ${detail}`;
}

/** The reason services/socket.ts's joinVoiceChannel rejects with when the
 * server never answered the join at all — alongside the `reason` strings
 * BackendWeb.VoiceChannel's join/3 itself replies with. */
export const VOICE_JOIN_TIMEOUT_REASON = 'timeout';

const VOICE_JOIN_REASONS = new Map<string, MessageKey>([
  [
    'already_connected_elsewhere',
    'Bu ses kanalına zaten başka bir sekmeden veya cihazdan bağlısınız. Önce oradan ayrılıp tekrar deneyin.',
  ],
  ['channel not found', 'Ses kanalı bulunamadı, silinmiş olabilir.'],
  ['not authorized', 'Bu ses kanalına katılma yetkiniz yok.'],
  [VOICE_JOIN_TIMEOUT_REASON, 'Ses kanalına bağlanılamadı, sunucu yanıt vermedi. Lütfen tekrar deneyin.'],
]);

/** A rejected voice join — joinVoiceChannel rejects with the reason as the
 * Error's message — mapped to the UI language; never the raw reason. */
export function voiceJoinErrorMessage(err: unknown): string {
  const reason = err instanceof Error ? err.message : undefined;
  return lookup(VOICE_JOIN_REASONS, reason, 'Ses kanalına katılınamadı. Lütfen tekrar deneyin.');
}

/** getUserMedia/getDisplayMedia reject with a DOMException whose `name`
 * says what went wrong — the `message` is browser-specific English. */
function mediaErrorName(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'name' in err && typeof err.name === 'string') {
    return err.name;
  }
  return undefined;
}

const MICROPHONE_ERRORS = new Map<string, MessageKey>([
  [
    'NotAllowedError',
    'Mikrofon izni verilmedi. Tarayıcı ayarlarından bu siteye mikrofon izni verip tekrar deneyin.',
  ],
  ['NotFoundError', 'Mikrofon bulunamadı. Bir mikrofonun bağlı olduğundan emin olun.'],
  ['NotReadableError', 'Mikrofona erişilemedi, başka bir uygulama tarafından kullanılıyor olabilir.'],
  [
    'OverconstrainedError',
    'Seçili mikrofon kullanılamıyor. Ayarlardan başka bir mikrofon seçip tekrar deneyin.',
  ],
]);

/** A failed getUserMedia while joining a voice channel. */
export function microphoneErrorMessage(err: unknown): string {
  return lookup(MICROPHONE_ERRORS, mediaErrorName(err), 'Mikrofona erişilemedi. Lütfen tekrar deneyin.');
}

const SCREEN_SHARE_ERRORS = new Map<string, MessageKey>([
  ['NotFoundError', 'Paylaşılabilecek bir ekran bulunamadı.'],
  ['NotReadableError', 'Ekran şu anda yakalanamıyor, başka bir uygulama engelliyor olabilir.'],
]);

/**
 * A failed screen share start, or `null` when there's nothing to report:
 * NotAllowedError is what cancelling the browser's screen picker rejects
 * with (and the desktop app's own picker too — see desktop/main.js), i.e.
 * the user changing their mind. An OS-level screen-recording denial rejects
 * with the same name, and the two can only be told apart by
 * browser-specific message text — so both count as a cancel, rather than
 * every cancel showing an error.
 */
export function screenShareErrorMessage(err: unknown): string | null {
  const name = mediaErrorName(err);
  if (name === 'NotAllowedError') return null;
  return lookup(SCREEN_SHARE_ERRORS, name, 'Ekran paylaşımı başlatılamadı.');
}

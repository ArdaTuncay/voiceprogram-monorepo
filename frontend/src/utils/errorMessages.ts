/**
 * User-facing error copy, in Turkish, for values the backend sends in a
 * machine-oriented (English) form — HTTP error bodies, Ecto changeset
 * messages — which used to be shown to users raw. Kept in one place so
 * every call site maps the same value to the same text, and so an unknown
 * value always has a deliberate fallback instead of leaking through by
 * accident. See PROJECT_ARCHITECTURE.md §7 items 11, 12 and 15.
 */
import type { PushFailure } from '../types';

/** Errors for the unauthenticated auth requests — services/api.ts's post(). */
export const AUTH_REQUEST_ERRORS = {
  timeout: 'Sunucu yanıt vermedi. Lütfen birkaç saniye sonra tekrar deneyin.',
  network: 'Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.',
  rateLimited: 'Çok fazla deneme yapıldı. Lütfen bir dakika bekleyip tekrar deneyin.',
  serverUnavailable: 'Sunucu şu anda yanıt veremiyor. Lütfen biraz sonra tekrar deneyin.',
  unexpected: 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.',
} as const;

/** For a response whose body isn't the JSON the backend always sends — e.g.
 * BackendWeb.RequireCloudflarePlug's empty-bodied 403, or a host/proxy's own
 * HTML error page (502/503) sitting in front of the backend — so there's no
 * `error` field to show, only the status code. */
export function httpStatusErrorMessage(status: number): string {
  if (status === 429) return AUTH_REQUEST_ERRORS.rateLimited;
  if (status >= 500) return AUTH_REQUEST_ERRORS.serverUnavailable;
  return `Sunucudan beklenmeyen bir yanıt alındı (HTTP ${status}). Lütfen tekrar deneyin.`;
}

const CHANGESET_FIELD_LABELS: Record<string, string> = {
  username: 'Kullanıcı adı',
  email: 'E-posta adresi',
  password: 'Şifre',
};

/**
 * One Ecto changeset error — its field plus the message BackendWeb.
 * UserController's format_errors/1 already interpolated (`%{count}` filled
 * in) — mapped to Turkish for the validations in Backend.Accounts.User's
 * registration_changeset/2. Anything not recognized here (another field,
 * a validation added later) falls back to the raw `"<field> <message>"`
 * text, exactly what was shown before this mapping existed.
 */
export function changesetErrorMessage(field: string, message: string): string {
  const label = CHANGESET_FIELD_LABELS[field];
  if (!label) return `${field} ${message}`;

  if (message === "can't be blank") return `${label} boş bırakılamaz.`;
  if (message === 'has already been taken') {
    return `Bu ${label.toLocaleLowerCase('tr-TR')} zaten kullanımda.`;
  }
  if (message === 'must be a valid email') return 'Geçerli bir e-posta adresi girin.';
  if (message === 'only letters, numbers and underscores allowed') {
    return `${label} yalnızca harf, rakam ve alt çizgi (_) içerebilir.`;
  }

  // Ecto's own validate_length/3 default ("should be at least %{count}
  // character(s)") and the password's custom message ("must be at least
  // %{count} characters") — matched by pattern rather than exact text so a
  // changed min/max on the backend still maps, with the new number.
  const atLeast = /^(?:should|must) be at least (\d+) character(?:s|\(s\))$/.exec(message);
  if (atLeast) return `${label} en az ${atLeast[1]} karakter olmalıdır.`;
  const atMost = /^should be at most (\d+) character\(s\)$/.exec(message);
  if (atMost) return `${label} en fazla ${atMost[1]} karakter olabilir.`;

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

const CHAT_ACTION_FAILED: Record<ChatAction, string> = {
  send: 'Mesaj gönderilemedi.',
  edit: 'Mesaj düzenlenemedi.',
  delete: 'Mesaj silinemedi.',
  react: 'Tepki güncellenemedi.',
};

// The `reason` values ChatChannel/DmChannel actually reply with. Both
// spellings of "not found" are real: update_message/delete_message reply
// "message not found", toggle_reaction replies "message_not_found".
const CHAT_ACTION_REASONS = new Map<string, string>([
  ['rate_limited', 'Çok hızlı işlem yapıyorsunuz. Lütfen birkaç saniye bekleyip tekrar deneyin.'],
  ['message not found', 'Mesaj bulunamadı, silinmiş olabilir.'],
  ['message_not_found', 'Mesaj bulunamadı, silinmiş olabilir.'],
  ['not authorized', 'Bu işlem için yetkiniz yok.'],
  ['blocked', 'Bu kişiyle aranızda engelleme olduğu için mesaj gönderilemiyor.'],
]);

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
      ? 'Sunucudan yanıt alınamadı; mesajın gönderilip gönderilmediği doğrulanamadı. Lütfen sohbeti kontrol edin.'
      : 'Sunucudan yanıt alınamadı; işlemin tamamlanıp tamamlanmadığı doğrulanamadı.';
  }
  const detail =
    (failure.reason !== undefined && CHAT_ACTION_REASONS.get(failure.reason)) ||
    'Lütfen tekrar deneyin.';
  return `${CHAT_ACTION_FAILED[action]} ${detail}`;
}

import { describe, expect, it } from 'vitest';
import {
  AUTH_REQUEST_ERRORS,
  changesetErrorMessage,
  changesetErrorsMessage,
  chatActionErrorMessage,
  httpStatusErrorMessage,
  microphoneErrorMessage,
  screenShareErrorMessage,
  VOICE_JOIN_TIMEOUT_REASON,
  voiceJoinErrorMessage,
} from '../errorMessages';

describe('changesetErrorMessage — registration validations (Backend.Accounts.User)', () => {
  // The exact strings BackendWeb.UserController's format_errors/1 produces
  // for registration_changeset/2's validations (Ecto 3.14 defaults plus the
  // two custom messages), with %{count} already interpolated.
  it.each([
    ['username', "can't be blank", 'Kullanıcı adı boş bırakılamaz.'],
    ['email', "can't be blank", 'E-posta adresi boş bırakılamaz.'],
    ['password', "can't be blank", 'Şifre boş bırakılamaz.'],
    ['username', 'has already been taken', 'Bu kullanıcı adı zaten kullanımda.'],
    ['email', 'has already been taken', 'Bu e-posta adresi zaten kullanımda.'],
    ['username', 'should be at least 3 character(s)', 'Kullanıcı adı en az 3 karakter olmalıdır.'],
    ['username', 'should be at most 30 character(s)', 'Kullanıcı adı en fazla 30 karakter olabilir.'],
    [
      'username',
      'only letters, numbers and underscores allowed',
      'Kullanıcı adı yalnızca harf, rakam ve alt çizgi (_) içerebilir.',
    ],
    ['email', 'must be a valid email', 'Geçerli bir e-posta adresi girin.'],
    ['password', 'must be at least 8 characters', 'Şifre en az 8 karakter olmalıdır.'],
  ])('%s "%s" → %s', (field, message, expected) => {
    expect(changesetErrorMessage(field, message)).toBe(expected);
  });

  it('keeps mapping a length rule if the backend changes its limit', () => {
    expect(changesetErrorMessage('password', 'must be at least 12 characters')).toBe(
      'Şifre en az 12 karakter olmalıdır.'
    );
    expect(changesetErrorMessage('username', 'should be at most 40 character(s)')).toBe(
      'Kullanıcı adı en fazla 40 karakter olabilir.'
    );
  });

  it('falls back to the raw "<field> <message>" text for an unknown message', () => {
    expect(changesetErrorMessage('email', 'is on a blocklist')).toBe('email is on a blocklist');
  });

  it('falls back to the raw text for an unknown field, even with a known message', () => {
    expect(changesetErrorMessage('nickname', "can't be blank")).toBe("nickname can't be blank");
  });
});

describe('changesetErrorsMessage', () => {
  it('separates mapped sentences with a space', () => {
    expect(
      changesetErrorsMessage({
        username: ['should be at least 3 character(s)'],
        password: ['must be at least 8 characters'],
      })
    ).toBe('Kullanıcı adı en az 3 karakter olmalıdır. Şifre en az 8 karakter olmalıdır.');
  });

  it('keeps the old ", " separator for raw fallbacks, so a raw-only list reads exactly as before', () => {
    expect(changesetErrorsMessage({ email: ['is odd'], nickname: ['is weird'] })).toBe(
      'email is odd, nickname is weird'
    );
  });

  it('handles a mix of mapped and raw messages', () => {
    expect(
      changesetErrorsMessage({ email: ['has already been taken', 'is on a blocklist'] })
    ).toBe('Bu e-posta adresi zaten kullanımda. email is on a blocklist');
  });
});

describe('httpStatusErrorMessage', () => {
  it('maps 429 to the rate-limit message', () => {
    expect(httpStatusErrorMessage(429)).toBe(AUTH_REQUEST_ERRORS.rateLimited);
  });

  it.each([500, 502, 503, 504])('maps %i to the server-unavailable message', (status) => {
    expect(httpStatusErrorMessage(status)).toBe(AUTH_REQUEST_ERRORS.serverUnavailable);
  });

  it('includes the status code for anything else', () => {
    expect(httpStatusErrorMessage(403)).toContain('HTTP 403');
  });
});

describe('chatActionErrorMessage', () => {
  it.each([
    ['rate_limited', 'Çok hızlı işlem yapıyorsunuz'],
    ['message not found', 'Mesaj bulunamadı'],
    ['message_not_found', 'Mesaj bulunamadı'],
    ['not authorized', 'yetkiniz yok'],
    ['blocked', 'engelleme'],
  ])('maps the server reason "%s"', (reason, expected) => {
    const message = chatActionErrorMessage('send', { kind: 'error', reason });
    expect(message.startsWith('Mesaj gönderilemedi.')).toBe(true);
    expect(message).toContain(expected);
  });

  it('names the action that failed', () => {
    const failure = { kind: 'error', reason: 'rate_limited' } as const;
    expect(chatActionErrorMessage('edit', failure)).toMatch(/^Mesaj düzenlenemedi\./);
    expect(chatActionErrorMessage('delete', failure)).toMatch(/^Mesaj silinemedi\./);
    expect(chatActionErrorMessage('react', failure)).toMatch(/^Tepki güncellenemedi\./);
  });

  it('never shows an unknown reason raw', () => {
    const message = chatActionErrorMessage('send', { kind: 'error', reason: 'some_new_reason' });
    expect(message).toBe('Mesaj gönderilemedi. Lütfen tekrar deneyin.');
    expect(message).not.toContain('some_new_reason');
  });

  it('gives a changeset rejection (no reason) the generic retry hint', () => {
    expect(chatActionErrorMessage('send', { kind: 'error' })).toBe(
      'Mesaj gönderilemedi. Lütfen tekrar deneyin.'
    );
  });

  it('does not treat inherited object keys as known reasons', () => {
    expect(chatActionErrorMessage('send', { kind: 'error', reason: 'constructor' })).toBe(
      'Mesaj gönderilemedi. Lütfen tekrar deneyin.'
    );
  });

  it('words a send timeout as "unconfirmed", not "failed"', () => {
    const message = chatActionErrorMessage('send', { kind: 'timeout' });
    expect(message).toContain('doğrulanamadı');
    expect(message).not.toContain('gönderilemedi');
  });
});

describe('voiceJoinErrorMessage', () => {
  it.each([
    ['already_connected_elsewhere', 'başka bir sekmeden veya cihazdan'],
    ['channel not found', 'Ses kanalı bulunamadı'],
    ['not authorized', 'katılma yetkiniz yok'],
    [VOICE_JOIN_TIMEOUT_REASON, 'sunucu yanıt vermedi'],
  ])('maps "%s"', (reason, expected) => {
    expect(voiceJoinErrorMessage(new Error(reason))).toContain(expected);
  });

  it('falls back to a generic message — never the raw text — for anything else', () => {
    expect(voiceJoinErrorMessage(new Error('Failed to join voice channel'))).toBe(
      'Ses kanalına katılınamadı. Lütfen tekrar deneyin.'
    );
    expect(voiceJoinErrorMessage('not even an Error')).toBe(
      'Ses kanalına katılınamadı. Lütfen tekrar deneyin.'
    );
  });
});

describe('microphoneErrorMessage', () => {
  it.each([
    ['NotAllowedError', 'Mikrofon izni verilmedi'],
    ['NotFoundError', 'Mikrofon bulunamadı'],
    ['NotReadableError', 'başka bir uygulama tarafından kullanılıyor'],
    ['OverconstrainedError', 'Seçili mikrofon kullanılamıyor'],
  ])('maps a %s by its name, not its (browser-specific) message', (name, expected) => {
    expect(microphoneErrorMessage(new DOMException('some English text', name))).toContain(expected);
  });

  it('falls back to a generic message — e.g. for a TypeError when mediaDevices is missing', () => {
    expect(microphoneErrorMessage(new TypeError("Cannot read properties of undefined (reading 'getUserMedia')"))).toBe(
      'Mikrofona erişilemedi. Lütfen tekrar deneyin.'
    );
  });
});

describe('screenShareErrorMessage', () => {
  it('returns null (nothing to show) for a cancelled picker', () => {
    expect(screenShareErrorMessage(new DOMException('Permission denied', 'NotAllowedError'))).toBeNull();
  });

  it.each([
    ['NotFoundError', 'Paylaşılabilecek bir ekran bulunamadı'],
    ['NotReadableError', 'yakalanamıyor'],
  ])('maps a %s', (name, expected) => {
    expect(screenShareErrorMessage(new DOMException('x', name))).toContain(expected);
  });

  it('falls back to a generic message for anything else', () => {
    expect(screenShareErrorMessage(new Error('renegotiation blew up'))).toBe('Ekran paylaşımı başlatılamadı.');
  });
});

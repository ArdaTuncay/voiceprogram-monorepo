import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_REQUEST_TIMEOUT_MS, loginUser, registerUser } from '../api';
import { getStoredToken } from '../tokenStorage';
import { AUTH_REQUEST_ERRORS } from '../../utils/errorMessages';

// Real Response objects rather than hand-rolled { ok, status, json } fakes —
// the point of several tests below is what resp.json() actually does with an
// empty or HTML body (it rejects), which a fake would only be asserting
// about itself.
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function htmlResponse(status: number): Response {
  return new Response('<html><body><h1>Bad Gateway</h1></body></html>', {
    status,
    headers: { 'Content-Type': 'text/html' },
  });
}

function stubFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('post() — requests that never get a response (PROJECT_ARCHITECTURE.md §7 #15)', () => {
  it('settles with the timeout error at the deadline even if fetch never settles, and aborts the request', async () => {
    vi.useFakeTimers();
    // Never settles, and ignores the abort signal too — the strictest case:
    // proves the deadline doesn't depend on the request cooperating.
    const fetchMock = stubFetch(() => new Promise<Response>(() => {}));

    let settled = false;
    const pending = loginUser('ard@example.com', 'password123').then((result) => {
      settled = true;
      return result;
    });

    await vi.advanceTimersByTimeAsync(AUTH_REQUEST_TIMEOUT_MS - 1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ error: AUTH_REQUEST_ERRORS.timeout });

    const init = fetchMock.mock.calls[0][1];
    expect(init?.signal?.aborted).toBe(true);
    expect(getStoredToken()).toBeNull();
  });

  it('applies the same deadline to registration', async () => {
    vi.useFakeTimers();
    stubFetch(() => new Promise<Response>(() => {}));

    const pending = registerUser('newperson', 'new@example.com', 'password123');
    await vi.advanceTimersByTimeAsync(AUTH_REQUEST_TIMEOUT_MS);

    expect(await pending).toEqual({ error: AUTH_REQUEST_ERRORS.timeout });
  });

  it('clears its deadline timer once a response arrives in time', async () => {
    vi.useFakeTimers();
    // Registration rather than login: a successful login also writes the
    // token to localStorage, and jsdom's setItem schedules a timer of its
    // own (for the "storage" event), which would muddy the count below.
    stubFetch(async () =>
      jsonResponse(201, { message: 'Kayıt başarılı', email_verification_required: true })
    );

    const result = await registerUser('newperson', 'new@example.com', 'password123');

    expect(result.data?.email_verification_required).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('still logs in and stores the token on a normal, timely response', async () => {
    stubFetch(async () =>
      jsonResponse(200, { id: 'u1', username: 'ard', email: 'ard@example.com', token: 'tok123' })
    );

    const result = await loginUser('ard@example.com', 'password123');

    expect(result.data?.token).toBe('tok123');
    expect(getStoredToken()).toBe('tok123');
  });

  it('reports a network error (without the old "port 4000" hint) when fetch itself rejects', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });

    const result = await loginUser('ard@example.com', 'password123');

    expect(result).toEqual({ error: AUTH_REQUEST_ERRORS.network });
    expect(result.error).not.toContain('4000');
  });
});

describe('post() — responses without a JSON body', () => {
  it('maps an empty-bodied 403 (RequireCloudflarePlug) to a status-based message, not a network error', async () => {
    stubFetch(async () => new Response('', { status: 403 }));

    const result = await loginUser('ard@example.com', 'password123');

    expect(result.error).toContain('HTTP 403');
    expect(result.error).not.toBe(AUTH_REQUEST_ERRORS.network);
    expect(result.error).not.toContain('4000');
  });

  it.each([502, 503])('maps a %i HTML error page to the server-unavailable message', async (status) => {
    stubFetch(async () => htmlResponse(status));

    const result = await loginUser('ard@example.com', 'password123');

    expect(result).toEqual({ error: AUTH_REQUEST_ERRORS.serverUnavailable });
  });

  it('treats a 200 with a non-JSON body (e.g. an SPA fallback page) as an error, not a login', async () => {
    stubFetch(async () => htmlResponse(200));

    const result = await loginUser('ard@example.com', 'password123');

    expect(result.data).toBeUndefined();
    expect(result.error).toContain('HTTP 200');
    expect(getStoredToken()).toBeNull();
  });
});

describe('post() — JSON error responses', () => {
  it('maps RateLimiterPlug\'s 429 to a Turkish rate-limit message', async () => {
    stubFetch(async () =>
      jsonResponse(429, { error: 'Too many requests. Please try again later.' })
    );

    const result = await loginUser('ard@example.com', 'password123');

    expect(result).toEqual({ error: AUTH_REQUEST_ERRORS.rateLimited });
  });

  it('maps a non-JSON 429 (e.g. from a proxy in front of the backend) the same way', async () => {
    stubFetch(async () => htmlResponse(429));

    const result = await loginUser('ard@example.com', 'password123');

    expect(result).toEqual({ error: AUTH_REQUEST_ERRORS.rateLimited });
  });

  it('passes "email_not_verified" through untouched, since Auth.tsx matches on that exact value', async () => {
    stubFetch(async () => jsonResponse(403, { error: 'email_not_verified' }));

    const result = await loginUser('unverified@example.com', 'password123');

    expect(result).toEqual({ error: 'email_not_verified' });
  });

  it('passes the wrong-credentials 401 message through unchanged', async () => {
    stubFetch(async () => jsonResponse(401, { error: 'Invalid email or password' }));

    const result = await loginUser('ard@example.com', 'wrong');

    expect(result).toEqual({ error: 'Invalid email or password' });
  });

  it('maps a known registration changeset error (422) to Turkish', async () => {
    stubFetch(async () => jsonResponse(422, { errors: { email: ['has already been taken'] } }));

    const result = await registerUser('newperson', 'taken@example.com', 'password123');

    expect(result).toEqual({ error: 'Bu e-posta adresi zaten kullanımda.' });
  });

  it('falls back to the raw changeset text for an unknown validation', async () => {
    stubFetch(async () => jsonResponse(422, { errors: { email: ['is on a blocklist'] } }));

    const result = await registerUser('newperson', 'x@example.com', 'password123');

    expect(result).toEqual({ error: 'email is on a blocklist' });
  });
});

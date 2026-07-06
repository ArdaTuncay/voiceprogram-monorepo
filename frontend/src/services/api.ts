import type {
  AuthResponse,
  Channel,
  Server,
  ServerMember,
  Invite,
  UploadResult,
  ApiError,
} from '../types';
import { API_BASE_URL } from '../config';

interface ApiResult<T> {
  data?: T;
  error?: string;
}

const TOKEN_STORAGE_KEY = 'voiceprogram_token';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

function storeToken(token: string): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

async function post<T>(path: string, body: Record<string, string>): Promise<ApiResult<T>> {
  try {
    const resp = await fetch(`${API_BASE_URL}/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await resp.json();
    if (!resp.ok) {
      const err = json as ApiError;
      if (err.errors) {
        const messages = Object.entries(err.errors).flatMap(([field, errs]) =>
          errs.map((e) => `${field} ${e}`)
        );
        return { error: messages.join(', ') };
      }
      return { error: err.error ?? 'An error occurred' };
    }
    return { data: json as T };
  } catch {
    return { error: 'Network error — is the backend running on port 4000?' };
  }
}

async function authedFetch<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const resp = await fetch(`${API_BASE_URL}/api${path}`, {
      ...init,
      headers: { ...init?.headers, Authorization: `Bearer ${getStoredToken() ?? ''}` },
    });
    // No body to parse on a 204 (e.g. the delete/kick endpoints below).
    if (resp.status === 204) {
      return { data: undefined };
    }
    const json = await resp.json();
    if (!resp.ok) {
      const err = json as ApiError;
      if (err.errors) {
        const messages = Object.entries(err.errors).flatMap(([field, errs]) =>
          errs.map((e) => `${field} ${e}`)
        );
        return { error: messages.join(', ') };
      }
      return { error: err.error ?? 'An error occurred' };
    }
    return { data: json as T };
  } catch {
    return { error: 'Network error — is the backend running on port 4000?' };
  }
}

function authedGet<T>(path: string): Promise<ApiResult<T>> {
  return authedFetch<T>(path);
}

function authedPost<T>(path: string, body: Record<string, string>): Promise<ApiResult<T>> {
  return authedFetch<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function authedPut<T>(path: string, body: Record<string, string>): Promise<ApiResult<T>> {
  return authedFetch<T>(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function authedDelete<T>(path: string): Promise<ApiResult<T>> {
  return authedFetch<T>(path, { method: 'DELETE' });
}

export async function registerUser(
  username: string,
  email: string,
  password: string
): Promise<ApiResult<AuthResponse>> {
  const result = await post<AuthResponse>('/users/register', { username, email, password });
  if (result.data) storeToken(result.data.token);
  return result;
}

export async function loginUser(
  email: string,
  password: string
): Promise<ApiResult<AuthResponse>> {
  const result = await post<AuthResponse>('/users/login', { email, password });
  if (result.data) storeToken(result.data.token);
  return result;
}

export function fetchServers(): Promise<ApiResult<Server[]>> {
  return authedGet<Server[]>('/servers');
}

export function createServer(name: string): Promise<ApiResult<Server>> {
  return authedPost<Server>('/servers', { name });
}

export function fetchServerChannels(serverId: string): Promise<ApiResult<Channel[]>> {
  return authedGet<Channel[]>(`/servers/${serverId}/channels`);
}

export function fetchServerMembers(serverId: string): Promise<ApiResult<ServerMember[]>> {
  return authedGet<ServerMember[]>(`/servers/${serverId}/members`);
}

/** Renames a server. Owner only — the backend rejects it otherwise. */
export function updateServer(serverId: string, name: string): Promise<ApiResult<Server>> {
  return authedPut<Server>(`/servers/${serverId}`, { name });
}

/** Permanently deletes a server. Owner only. */
export function deleteServer(serverId: string): Promise<ApiResult<void>> {
  return authedDelete<void>(`/servers/${serverId}`);
}

/** Permanently deletes a text or voice channel. Server owner only. */
export function deleteChannel(channelId: string): Promise<ApiResult<void>> {
  return authedDelete<void>(`/channels/${channelId}`);
}

/** Kicks a member from a server. Server owner only. */
export function kickMember(serverId: string, userId: string): Promise<ApiResult<void>> {
  return authedDelete<void>(`/servers/${serverId}/members/${userId}`);
}

export function createInvite(serverId: string): Promise<ApiResult<Invite>> {
  return authedPost<Invite>(`/servers/${serverId}/invites`, {});
}

export function acceptInvite(code: string): Promise<ApiResult<Server>> {
  return authedPost<Server>(`/invites/${code}/accept`, {});
}

/** Uploads a chat attachment as multipart/form-data; the browser sets the boundary header itself. */
export function uploadFile(file: File): Promise<ApiResult<UploadResult>> {
  const formData = new FormData();
  formData.append('file', file);
  return authedFetch<UploadResult>('/upload', { method: 'POST', body: formData });
}

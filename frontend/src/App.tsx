import { useState } from 'react';
import type { User } from './types';
import { getStoredToken, clearStoredToken } from './services/api';
import Auth from './components/Auth';
import Chat from './components/Chat';
import './App.css';

const STORAGE_KEY = 'voiceprogram_user';

function loadUser(): User | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

function saveUser(user: User): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
}

function clearUser(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// A stored user with no token (or vice versa) isn't a valid session.
function loadSession(): User | null {
  return getStoredToken() ? loadUser() : null;
}

export default function App() {
  const [user, setUser] = useState<User | null>(loadSession);

  function handleAuth(u: User) {
    saveUser(u);
    setUser(u);
  }

  function handleLogout() {
    clearStoredToken();
    clearUser();
    setUser(null);
  }

  if (!user) {
    return <Auth onAuth={handleAuth} />;
  }

  return <Chat user={user} onLogout={handleLogout} />;
}

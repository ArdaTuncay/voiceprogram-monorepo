import { useState } from 'react';
import type { FormEvent } from 'react';
import type { User } from '../types';
import { registerUser, loginUser } from '../services/api';
import mascot from '../assets/zircle-mascot.svg';
import './Auth.css';

interface Props {
  onAuth: (user: User) => void;
}

type Mode = 'login' | 'register';

export default function Auth({ onAuth }: Props) {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result =
      mode === 'register'
        ? await registerUser(username.trim(), email.trim(), password)
        : await loginUser(email.trim(), password);

    setLoading(false);

    if (result.error) {
      setError(result.error);
    } else if (result.data) {
      onAuth(result.data);
    }
  }

  function switchMode() {
    setMode((m) => (m === 'login' ? 'register' : 'login'));
    setError('');
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src={mascot} alt="Zircle maskotu" className="auth-mascot" />
        <h1>{mode === 'login' ? 'Welcome back!' : 'Create an account'}</h1>
        <p className="subtitle">
          {mode === 'login'
            ? "We're so excited to see you again!"
            : 'Join the community today.'}
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === 'register' && (
            <div className="form-group">
              <label htmlFor="username">Username</label>
              <input
                id="username"
                type="text"
                placeholder="cooluser42"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={3}
                maxLength={30}
                autoComplete="username"
              />
            </div>
          )}

          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </div>

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? 'Please wait…' : mode === 'login' ? 'Log In' : 'Continue'}
          </button>
        </form>

        <hr className="auth-divider" />

        <p className="auth-toggle">
          {mode === 'login' ? 'Need an account?' : 'Already have an account?'}
          <button type="button" onClick={switchMode}>
            {mode === 'login' ? 'Register' : 'Log In'}
          </button>
        </p>
      </div>
    </div>
  );
}

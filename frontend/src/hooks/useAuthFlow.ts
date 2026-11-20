import { useState } from 'react';
import type { FormEvent } from 'react';
import type { User } from '../types';
import { loginUser, registerUser } from '../services/api';
import { AUTH_REQUEST_ERRORS } from '../utils/errorMessages';

export type AuthMode = 'login' | 'register';

/**
 * The sign-in / sign-up state machine, shared by the app's own sign-in
 * screen (components/Auth) and the sign-in card on the public home page
 * (site/SiteAuthCard), so both doors behave exactly alike: the same
 * validation errors, the same "check your email" step for an unverified
 * address, and the same two-factor step.
 */
export function useAuthFlow(onAuth: (user: User) => void) {
  const [mode, setModeState] = useState<AuthMode>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Non-null once either a fresh registration or a login attempt has told
  // us this address needs verifying — set by two different call sites below
  // (register's own success, and login's "email_not_verified" error), which
  // is exactly why this is one shared screen/state rather than two: from
  // the user's point of view both cases are the same instruction ("go check
  // your email"), just reached by different doors.
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null);
  const [forgotPassword, setForgotPassword] = useState(false);
  // Set when the password was right but the account wants a code too.
  const [twoFactorChallenge, setTwoFactorChallenge] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    // services/api.ts's post() already never rejects and never stays pending
    // past its own timeout — this is a second, local guarantee on top of
    // that: whatever happens below, the button is never left stuck on
    // "Please wait…" with no error shown (PROJECT_ARCHITECTURE.md §7 #15).
    try {
      if (mode === 'register') {
        const result = await registerUser(username.trim(), email.trim(), password);

        if (result.error) {
          setError(result.error);
        } else if (result.data) {
          setPendingVerificationEmail(email.trim());
        }
        return;
      }

      const trimmedEmail = email.trim();
      const result = await loginUser(trimmedEmail, password);

      if (result.error === 'email_not_verified') {
        setPendingVerificationEmail(trimmedEmail);
      } else if (result.error) {
        setError(result.error);
      } else if (result.data) {
        if ('two_factor' in result.data) setTwoFactorChallenge(result.data.challenge);
        else onAuth(result.data);
      }
    } catch {
      setError(AUTH_REQUEST_ERRORS.unexpected);
    } finally {
      setLoading(false);
    }
  }

  function setMode(next: AuthMode) {
    setModeState(next);
    setError('');
  }

  return {
    mode,
    setMode,
    username,
    setUsername,
    email,
    setEmail,
    password,
    setPassword,
    error,
    loading,
    handleSubmit,
    pendingVerificationEmail,
    forgotPassword,
    openForgotPassword: () => setForgotPassword(true),
    closeForgotPassword: () => setForgotPassword(false),
    twoFactorChallenge,
    /** Leaves the "check your email" step, back to the login form. */
    leaveVerification: () => {
      setPendingVerificationEmail(null);
      setMode('login');
    },
    /** Leaves the two-factor step; the password has to be typed again. */
    leaveTwoFactor: () => {
      setTwoFactorChallenge(null);
      setPassword('');
    },
  };
}

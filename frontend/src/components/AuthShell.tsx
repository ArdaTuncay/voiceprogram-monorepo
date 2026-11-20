import type { ReactNode } from 'react';
import { useT } from '../i18n';
import mascot from '../assets/zircle-mascot.svg';
import './Auth.css';

interface Props {
  /** Rendered inside another card (the home page's sign-in card) instead of
   * as a full page: no page background, no card, no mascot. */
  bare?: boolean;
  children: ReactNode;
}

/** The page + card + mascot frame around the sign-in screens, or just their
 * content when `bare`. */
export default function AuthShell({ bare, children }: Props) {
  const t = useT();
  if (bare) return <div className="auth-bare">{children}</div>;
  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src={mascot} alt={t('Zircle maskotu')} className="auth-mascot" />
        {children}
      </div>
    </div>
  );
}

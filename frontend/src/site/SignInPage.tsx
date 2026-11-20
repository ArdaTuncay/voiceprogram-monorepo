import type { User } from '../types';
import { useAuthFlow } from '../hooks/useAuthFlow';
import { useT } from '../i18n';
import SiteLayout from './SiteLayout';
import SiteAuthCard from './SiteAuthCard';

/**
 * The sign-in and sign-up page (`/giris`, signed out only): the home page's
 * card on its own. `/giris#kayit` opens it on sign-up — the "Kayıt ol"
 * buttons in the site's header link there. Signing in opens Zircle in this
 * tab, like the home page's card.
 */
export default function SignInPage({ onAuth }: { onAuth: (user: User) => void }) {
  const t = useT();
  const flow = useAuthFlow(onAuth, window.location.hash === '#kayit' ? 'register' : 'login');

  return (
    <SiteLayout
      current="signin"
      title={flow.mode === 'register' ? t('Kayıt ol') : t('Giriş yap')}
      minimal={{
        headerLink: { href: '/', label: t('Ana sayfaya dön') },
        footerLinks: [
          { href: '/indir', label: t('Windows için indir') },
          { href: '/destek', label: t('Destek') },
          { href: '/gizlilik', label: t('Gizlilik') },
        ],
      }}
    >
      <SiteAuthCard flow={flow} onAuth={onAuth} titleLevel="h1" />
    </SiteLayout>
  );
}

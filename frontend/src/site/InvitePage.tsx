import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { rich } from '../i18n/rich';
import { previewInvite, type InvitePreview } from '../services/api';
import { getStoredToken } from '../services/tokenStorage';
import { useServerStore } from '../stores/useServerStore';
import SiteLayout, { DownloadIcon, GlobeIcon } from './SiteLayout';
import { savePendingInvite } from './siteHome';

interface Props {
  code: string;
  /** Called once a signed-in visitor has joined: App opens Zircle on that server. */
  onJoined: () => void;
}

type State =
  | { status: 'loading' }
  | { status: 'invalid' }
  | { status: 'ready'; invite: InvitePreview };

/**
 * The invite page (`/davet/<code>`): which server the link leads to and who
 * sent it, before the visitor signs in. "Tarayıcıda katıl" joins right away
 * when signed in; otherwise it remembers the invite and goes to the sign-in
 * page, and App joins the server as soon as the visitor has signed in.
 */
export default function InvitePage({ code, onJoined }: Props) {
  const t = useT();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState('');

  useEffect(() => {
    let cancelled = false;
    previewInvite(code).then(({ data }) => {
      if (cancelled) return;
      setState(data ? { status: 'ready', invite: data } : { status: 'invalid' });
    });
    return () => {
      cancelled = true;
    };
  }, [code]);

  async function join() {
    if (!getStoredToken()) {
      savePendingInvite(code);
      window.location.assign('/giris');
      return;
    }
    setJoining(true);
    setJoinError('');
    const error = await useServerStore.getState().joinServerByInvite(code);
    setJoining(false);
    if (error) setJoinError(error);
    else onJoined();
  }

  let card;
  if (state.status === 'loading') {
    card = <p className="site-invite-status">{t('Davet yükleniyor…')}</p>;
  } else if (state.status === 'invalid') {
    card = (
      <>
        <h1>{t('Bu davet geçerli değil')}</h1>
        <p>{t('Bağlantının süresi dolmuş ya da bağlantı iptal edilmiş olabilir. Seni davet eden kişiden yeni bir bağlantı iste.')}</p>
        <a href="/" className="site-btn site-btn-primary site-invite-wide">
          {t('Ana sayfaya dön')}
        </a>
      </>
    );
  } else {
    const { invite } = state;
    card = (
      <>
        {invite.server_icon_url ? (
          <img className="site-invite-icon" src={invite.server_icon_url} alt="" />
        ) : (
          <span className="site-invite-icon" aria-hidden="true">
            {initials(invite.server_name)}
          </span>
        )}
        {invite.inviter_username && (
          <p className="site-invite-from">
            {rich(t('{name} seni bu sunucuya davet etti'), { name: invite.inviter_username })}
          </p>
        )}
        <h1>{invite.server_name}</h1>
        <p>{t('Katılmak için giriş yap ya da hesap oluştur. Bir şey kurman gerekmiyor.')}</p>
        {joinError && (
          <div className="auth-error" role="alert">
            {joinError}
          </div>
        )}
        <button type="button" className="site-btn site-btn-primary site-btn-large site-invite-wide" onClick={join} disabled={joining}>
          <GlobeIcon size={20} />
          {joining ? t('Lütfen bekle…') : t('Tarayıcıda katıl')}
        </button>
        <a href="/indir" className="site-btn site-btn-outline site-invite-wide">
          <DownloadIcon />
          {t('Önce Windows uygulamasını indir')}
        </a>
        <p className="site-invite-note">{t('Bu davet bağlantısı sunucu sahibi tarafından iptal edilebilir.')}</p>
      </>
    );
  }

  return (
    <SiteLayout
      current="invite"
      title={state.status === 'ready' ? state.invite.server_name : t('Davet')}
      minimal={{
        headerLink: { href: '/', label: t('Zircle nedir?') },
        footerLinks: [
          { href: '/guvenlik', label: t('Güvenlik') },
          { href: '/destek', label: t('Destek') },
          { href: '/gizlilik', label: t('Gizlilik') },
        ],
      }}
    >
      <div className="site-invite-card" aria-live="polite">
        {card}
      </div>
    </SiteLayout>
  );
}

/** Up to two initials for a server without an icon ("Oyun Gecesi" → "OG"). */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toLocaleUpperCase('tr'))
    .join('');
}

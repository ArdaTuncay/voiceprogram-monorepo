import { useT } from '../i18n';
import SiteLayout from './SiteLayout';

/** The 404 page: any address the site doesn't know, while signed out. */
export default function NotFoundPage() {
  const t = useT();

  return (
    <SiteLayout
      current="notfound"
      title={t('Sayfa bulunamadı')}
      minimal={{
        headerLink: { href: '/giris', label: t('Giriş yap') },
        footerLinks: [
          { href: '/ozellikler', label: t('Özellikler') },
          { href: '/indir', label: t('İndir') },
          { href: '/gizlilik', label: t('Gizlilik') },
        ],
      }}
    >
      <div className="site-notfound">
        <div className="site-notfound-code" role="img" aria-label="404">
          <span aria-hidden="true">4</span>
          <span className="site-notfound-ring" aria-hidden="true">
            <span />
          </span>
          <span aria-hidden="true">4</span>
        </div>
        <h1>{t('Burada kimse yok.')}</h1>
        <p>{t('Aradığın sayfa taşınmış ya da hiç var olmamış olabilir. Adresi kontrol et ya da ana sayfadan devam et.')}</p>
        <div className="site-notfound-actions">
          <a href="/" className="site-btn site-btn-primary">
            {t('Ana sayfaya dön')}
          </a>
          <a href="/destek" className="site-btn site-btn-outline">
            {t('Destek')}
          </a>
        </div>
        <p className="site-notfound-note">
          {t('Bir davet bağlantısıyla geldiysen bağlantının süresi dolmuş olabilir; seni davet eden kişiden yenisini iste.')}
        </p>
      </div>
    </SiteLayout>
  );
}

import { useT, useLanguageStore } from '../i18n';
import { getStoredToken } from '../services/tokenStorage';
import SiteLayout, { DownloadIcon, GlobeIcon, MonitorIcon } from './SiteLayout';
import { RELEASE, formatReleaseDate } from './release';

/** The download page (`/indir`): the Windows installer, how to install it,
 * and the other ways in for people who aren't on Windows. */
export default function DownloadPage() {
  const t = useT();
  const language = useLanguageStore((s) => s.language);
  const openHref = getStoredToken() ? '/' : '/giris';

  return (
    <SiteLayout current="download" title={t('İndir')}>
      <section className="site-container site-download-hero">
        <div className="site-download-copy">
          <p className="site-eyebrow">{t('Masaüstü uygulaması')}</p>
          <h1>{t("Zircle'ı bilgisayarına kur.")}</h1>
          <p className="site-lead">
            {t('Kendi penceresinde açılır, tarayıcı sekmelerinin arasında kaybolmaz. Hesabın ve her şeyin tarayıcıdakiyle aynıdır.')}
          </p>
          <div className="site-download-actions">
            <a href={RELEASE.downloadUrl} className="site-btn site-btn-primary site-btn-xl">
              <DownloadIcon size={22} />
              {t('Windows için indir')}
            </a>
            <a href={openHref} className="site-text-link">
              {t('Kurmadan tarayıcıda aç')}
            </a>
          </div>
        </div>
        <dl className="site-release">
          <div>
            <dt>{t('İşletim sistemi')}</dt>
            <dd>{t('Windows 10 ve 11')}</dd>
          </div>
          <div>
            <dt>{t('Sürüm')}</dt>
            <dd>{RELEASE.version}</dd>
          </div>
          {RELEASE.sizeMb !== null && (
            <div>
              <dt>{t('Dosya boyutu')}</dt>
              <dd>{RELEASE.sizeMb} MB</dd>
            </div>
          )}
          {RELEASE.date && (
            <div>
              <dt>{t('Yayın tarihi')}</dt>
              <dd>{formatReleaseDate(RELEASE.date, language)}</dd>
            </div>
          )}
        </dl>
      </section>

      <section id="kurulum" className="site-band">
        <div className="site-container site-section">
          <h2>{t('Kurulum üç adım.')}</h2>
          <ol className="site-steps">
            <li>
              <span className="site-step-num">1</span>
              <h3>{t('Dosyayı indir')}</h3>
              <p>{t('Yukarıdaki düğmeye tıkla; kurulum dosyası İndirilenler klasörüne iner.')}</p>
            </li>
            <li>
              <span className="site-step-num">2</span>
              <h3>{t('Kurulumu çalıştır')}</h3>
              <p>{t('İndirdiğin dosyaya çift tıkla ve kurulum bitene kadar bekle.')}</p>
            </li>
            <li>
              <span className="site-step-num site-step-num-filled">3</span>
              <h3>{t('Giriş yap')}</h3>
              <p>{t('Zircle açılınca hesabınla giriş yap. Sunucuların ve mesajların yerinde.')}</p>
            </li>
          </ol>
          <div role="note" className="site-warning">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3l10 17H2z" />
              <path d="M12 10v5" />
              <path d="M12 18h.01" />
            </svg>
            <div>
              <h3>{t('Windows bir uyarı gösterebilir')}</h3>
              <p>
                {t('Uygulama henüz bir yayıncı sertifikasıyla imzalanmadı. İlk çalıştırmada "Windows kişisel bilgisayarınızı korudu" penceresi çıkarsa önce "Ek bilgi"ye, sonra "Yine de çalıştır"a tıkla.')}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="site-container site-section">
        <div className="site-section-head">
          <h2>{t('Başka bir cihazda mısın?')}</h2>
          <p>{t("Zircle'ı kullanmak için uygulamaya ihtiyacın yok.")}</p>
        </div>
        <div className="site-cards site-cards-3">
          <article className="site-card">
            <GlobeIcon size={32} />
            <h3>{t('Tarayıcı')}</h3>
            <p>{t('Her işletim sisteminde çalışır. Giriş yap, Zircle o sekmede açılsın.')}</p>
            <a href={openHref} className="site-text-link site-card-link">
              {t('Tarayıcıda aç')}
            </a>
          </article>
          <article className="site-card">
            <PhoneIcon />
            <h3>{t('Telefon')}</h3>
            <p>{t('Tarayıcıdan aç, paylaş menüsünden "Ana ekrana ekle"yi seç. Uygulama gibi açılır ve bildirim gönderir.')}</p>
          </article>
          <article className="site-card">
            <MonitorIcon size={32} />
            <h3>{t('macOS ve Linux')}</h3>
            <p>{t("Masaüstü uygulaması şimdilik yalnızca Windows için. Bu sistemlerde Zircle'ı tarayıcıdan kullanabilirsin.")}</p>
          </article>
        </div>
      </section>
    </SiteLayout>
  );
}

function PhoneIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="7" y="2" width="10" height="20" rx="2.5" />
      <path d="M11 18h2" />
    </svg>
  );
}

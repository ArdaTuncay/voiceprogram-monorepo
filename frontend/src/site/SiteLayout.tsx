import { useEffect, type ReactNode } from 'react';
import { useT } from '../i18n';
import LanguageSelect from '../components/LanguageSelect';
import { getStoredToken } from '../services/tokenStorage';
import type { SitePage } from './siteHome';
import './site.css';

interface Link {
  href: string;
  label: string;
}

interface Props {
  current: SitePage;
  /** The page's own name for the browser tab ("Özellikler · Zircle"); none on the home page. */
  title?: string;
  /**
   * The pared-down layout of the sign-in, invite and 404 pages (the A2
   * design's centered-card pages): one link in the header instead of the
   * menu, a row of links instead of the footer columns, and the rings
   * behind the content.
   */
  minimal?: { headerLink: Link; footerLinks: Link[] };
  children: ReactNode;
}

/** Header and footer shared by the public site's pages (the A2 "Giriş önde" design). */
export default function SiteLayout({ current, title, minimal, children }: Props) {
  const t = useT();
  const here = (page: SitePage) => (current === page ? 'page' : undefined);
  const signedIn = Boolean(getStoredToken());

  useEffect(() => {
    document.title = title ? `${title} · Zircle` : 'Zircle';
  }, [title]);

  const logo = (
    <a href="/" className="site-logo" aria-current={here('home')}>
      <ZircleMark />
      Zircle
    </a>
  );

  if (minimal) {
    return (
      <div className="site site-minimal">
        <div className="site-rings" aria-hidden="true">
          <div className="site-ring" />
          <div className="site-ring site-ring-inner" />
        </div>
        <header className="site-minimal-header">
          <div className="site-container site-header-inner">
            {logo}
            <div className="site-minimal-actions">
              <a href={minimal.headerLink.href} className="site-minimal-link">
                {minimal.headerLink.label}
              </a>
              <LanguageSelect className="site-language" />
            </div>
          </div>
        </header>
        <main className="site-minimal-main">{children}</main>
        <footer className="site-minimal-footer">
          <nav aria-label={t('Bağlantılar')} className="site-container site-minimal-links">
            {minimal.footerLinks.map((link) => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>
        </footer>
      </div>
    );
  }

  return (
    <div className="site">
      <header className="site-header">
        <div className="site-container site-header-inner">
          {logo}
          <nav aria-label={t('Ana menü')} className="site-nav">
            <a href="/ozellikler" aria-current={here('features')}>
              {t('Özellikler')}
            </a>
            <a href="/indir" aria-current={here('download')}>
              {t('İndir')}
            </a>
            <a href="/guvenlik" aria-current={here('security')}>
              {t('Güvenlik')}
            </a>
            <a href="/destek" aria-current={here('support')}>
              {t('Destek')}
            </a>
            {current === 'home' ? (
              <a href="/indir" className="site-btn site-btn-outline site-nav-cta">
                <DownloadIcon />
                {t('Windows için indir')}
              </a>
            ) : signedIn ? (
              <a href="/" className="site-btn site-btn-primary site-nav-cta">
                {t("Zircle'ı aç")}
              </a>
            ) : (
              <>
                <a href="/giris" className="site-nav-signin">
                  {t('Giriş yap')}
                </a>
                <a href="/giris#kayit" className="site-btn site-btn-primary site-nav-cta">
                  {t('Kayıt ol')}
                </a>
              </>
            )}
            <LanguageSelect className="site-language" />
          </nav>
        </div>
      </header>

      <main>{children}</main>

      <footer className="site-footer">
        <div className="site-container site-footer-inner">
          <div className="site-footer-brand">
            <span className="site-footer-name">Zircle</span>
            <span>{t('Gerçek zamanlı sesli ve yazılı sohbet.')}</span>
          </div>
          <nav aria-label={t('Ürün')} className="site-footer-col">
            <span className="site-footer-title">{t('Ürün')}</span>
            <a href="/ozellikler">{t('Özellikler')}</a>
            <a href="/indir">{t('İndir')}</a>
            <a href="/yenilikler" aria-current={here('changelog')}>
              {t('Yenilikler')}
            </a>
            <a href={signedIn ? '/' : '/giris'}>{t('Tarayıcıda aç')}</a>
          </nav>
          <nav aria-label={t('Yardım')} className="site-footer-col">
            <span className="site-footer-title">{t('Yardım')}</span>
            <a href="/destek">{t('Destek')}</a>
            <a href="/guvenlik">{t('Güvenlik')}</a>
          </nav>
          <nav aria-label={t('Yasal')} className="site-footer-col">
            <span className="site-footer-title">{t('Yasal')}</span>
            <a href="/gizlilik" aria-current={here('privacy')}>
              {t('Gizlilik Politikası')}
            </a>
            <a href="/kosullar" aria-current={here('terms')}>
              {t('Kullanım Koşulları')}
            </a>
          </nav>
        </div>
        <div className="site-container site-copyright">© {new Date().getFullYear()} Zircle</div>
      </footer>
    </div>
  );
}

/** The ring-and-dot logo mark. */
export function ZircleMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <circle cx="14" cy="14" r="11" stroke="currentColor" strokeWidth="3" />
      <circle cx="14" cy="14" r="4" fill="currentColor" />
    </svg>
  );
}

export function DownloadIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4v11" />
      <path d="M7 11l5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  );
}

export function GlobeIcon({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9s1.3-6.4 3.8-9z" />
    </svg>
  );
}

export function MonitorIcon({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8" />
      <path d="M12 16v4" />
    </svg>
  );
}

/** A centered page heading block: eyebrow, h1 and lead (the inner pages' hero). */
export function PageHero({ eyebrow, title, lead }: { eyebrow: string; title: string; lead?: string }) {
  return (
    <section className="site-container site-page-hero">
      <p className="site-eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      {lead && <p className="site-lead">{lead}</p>}
    </section>
  );
}

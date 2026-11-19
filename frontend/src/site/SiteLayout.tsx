import type { ReactNode } from 'react';
import { useT } from '../i18n';
import LanguageSelect from '../components/LanguageSelect';
import type { SitePage } from './siteHome';
import './site.css';

/**
 * Header and footer shared by the public site's pages (the A2 "Giriş önde"
 * design). The site is built page by page: links only point at what exists
 * today — a real page, or else a section of the home page — and move to the
 * real pages (/indir, /guvenlik, /destek, /gizlilik, /kosullar…) as each one
 * is added, so a visitor never lands on a dead link.
 */
export default function SiteLayout({ current, children }: { current: SitePage; children: ReactNode }) {
  const t = useT();
  const here = (page: SitePage) => (current === page ? 'page' : undefined);

  return (
    <div className="site">
      <header className="site-header">
        <div className="site-container site-header-inner">
          <a href="/" className="site-logo" aria-current={here('home')}>
            <ZircleMark />
            Zircle
          </a>
          <nav aria-label={t('Ana menü')} className="site-nav">
            <a href="/ozellikler" aria-current={here('features')}>
              {t('Özellikler')}
            </a>
            <a href="/#iki-yol">{t('İndir')}</a>
            <a href="/#guvenlik">{t('Güvenlik')}</a>
            <a href="/#sss">{t('Destek')}</a>
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
            <a href="/#iki-yol">{t('İndir')}</a>
            <a href="/#giris">{t('Tarayıcıda aç')}</a>
          </nav>
          <nav aria-label={t('Yardım')} className="site-footer-col">
            <span className="site-footer-title">{t('Yardım')}</span>
            <a href="/#sss">{t('Sık sorulanlar')}</a>
            <a href="/#guvenlik">{t('Güvenlik')}</a>
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

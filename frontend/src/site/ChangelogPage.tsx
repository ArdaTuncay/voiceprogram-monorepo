import { useT, useLanguageStore } from '../i18n';
import SiteLayout, { PageHero } from './SiteLayout';
import { RELEASE, formatReleaseDate } from './release';

/**
 * The changelog (`/yenilikler`). It starts with a single entry, the 1.0
 * release Zircle goes public with; later releases go on top, each with its
 * "Yeni / İyileştirme / Düzeltme" labels.
 */
export default function ChangelogPage() {
  const t = useT();
  const language = useLanguageStore((s) => s.language);

  const items = [
    t('Sesli kanallar, ekran paylaşımı ve birlikte izleme.'),
    t('Yazılı sohbet: yanıt, bahsetme, tepki, arama ve dosya paylaşımı.'),
    t('Arkadaşlar ve özel mesajlar.'),
    t('Sunucular, davet bağlantıları, moderatörler ve raporlama.'),
    t('İki adımlı doğrulama ve açık oturum yönetimi.'),
    t('Uygulama kapalıyken de bildirimler.'),
    t("Tarayıcıda, telefonda ve Windows'ta kullanım."),
    t('Türkçe ve İngilizce arayüz.'),
  ];

  return (
    <SiteLayout current="changelog" title={t('Yenilikler')}>
      <PageHero
        eyebrow={t('Yenilikler')}
        title={t("Zircle'da neler değişti?")}
        lead={t('Her sürümde eklenenler, iyileştirilenler ve düzeltilenler.')}
      />

      <section className="site-container site-section-flush">
        <article className="site-release-entry">
          <div className="site-release-meta">
            <span className="site-release-dot" aria-hidden="true" />
            <div>
              <span className="site-release-version">{t('Sürüm {version}', { version: RELEASE.label })}</span>
              {RELEASE.date && <span className="site-release-date">{formatReleaseDate(RELEASE.date, language)}</span>}
              <span className="site-pill">{t('En yeni')}</span>
            </div>
          </div>
          <div className="site-release-body">
            <h2>{t('Zircle yayında')}</h2>
            <ul>
              {items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </article>

        <div className="site-release-foot">
          <p>
            {t('En yeni sürümü kullanmak için tarayıcıda sayfayı yenilemen yeter. Masaüstü uygulamasının yeni sürümü İndir sayfasındadır.')}
          </p>
          <a href="/indir" className="site-btn site-btn-outline">
            {t('İndir sayfası')}
          </a>
        </div>
      </section>
    </SiteLayout>
  );
}

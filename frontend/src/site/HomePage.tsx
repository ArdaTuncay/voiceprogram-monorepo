import type { User } from '../types';
import { useAuthFlow } from '../hooks/useAuthFlow';
import { useT } from '../i18n';
import SiteLayout from './SiteLayout';
import SiteAuthCard from './SiteAuthCard';

interface Props {
  onAuth: (user: User) => void;
}

/** The public home page (`/` while signed out): what Zircle is, and the
 * sign-in / sign-up card that opens the app in this tab. */
export default function HomePage({ onAuth }: Props) {
  const t = useT();
  const flow = useAuthFlow(onAuth);

  function goToCard(mode: 'login' | 'register') {
    flow.setMode(mode);
    const card = document.getElementById('giris');
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    card?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    // After the re-render, so the field exists in the chosen mode.
    window.setTimeout(() => card?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true }), 0);
  }

  return (
    <SiteLayout>
      <section className="site-container site-hero">
        <div className="site-hero-copy">
          <p className="site-eyebrow">{t('Sesli ve yazılı sohbet')}</p>
          <h1>{t('Arkadaşlarınla aynı çemberde.')}</h1>
          <p className="site-lead">
            {t('Giriş yap, Zircle bu sekmede açılsın. Kurulum yok; istersen sonra masaüstü uygulamasını da indirirsin.')}
          </p>
          <ul className="site-checks">
            <li>
              <CheckIcon />
              {t('Sesli kanallar ve ekran paylaşımı')}
            </li>
            <li>
              <CheckIcon />
              {t('Yazılı sohbet, özel mesajlar, dosya paylaşımı')}
            </li>
            <li>
              <CheckIcon />
              {t("Tarayıcıda ve Windows'ta aynı hesap")}
            </li>
          </ul>
        </div>
        <SiteAuthCard flow={flow} onAuth={onAuth} />
      </section>

      <div className="site-orbit" aria-hidden="true">
        <div className="site-orbit-ring" />
        <div className="site-orbit-ring site-orbit-ring-inner" />
        <span className="site-orbit-dot site-orbit-dot-0">AT</span>
        <span className="site-orbit-dot site-orbit-dot-1l">EK</span>
        <span className="site-orbit-dot site-orbit-dot-1r">MY</span>
        <span className="site-orbit-dot site-orbit-dot-2l">SD</span>
        <span className="site-orbit-dot site-orbit-dot-2r">BÖ</span>
      </div>

      <section id="iki-yol" className="site-band">
        <div className="site-container site-section">
          <div className="site-section-head">
            <h2>{t('İki yol, tek hesap.')}</h2>
            <p>{t('Nereden girersen gir sunucuların, mesajların ve arkadaşların seni bekliyor.')}</p>
          </div>
          <div className="site-paths">
            <article className="site-path">
              <GlobeIcon />
              <h3>{t('Tarayıcıdan')}</h3>
              <p>
                {t('Hiçbir şey kurmadan aç. Güncel bir tarayıcı yeter; telefonda ana ekranına ekleyip uygulama gibi kullanabilirsin.')}
              </p>
              <div className="site-path-actions">
                <button type="button" className="site-btn site-btn-primary" onClick={() => goToCard('login')}>
                  {t('Giriş yap ve aç')}
                </button>
              </div>
            </article>
            <article className="site-path">
              <MonitorIcon />
              <h3>{t('Masaüstünden')}</h3>
              <p>
                {t('Windows uygulamasını kur, hesabınla giriş yap. Zircle kendi penceresinde açılır, tarayıcı sekmelerinin arasında kaybolmaz.')}
              </p>
              <div className="site-path-actions">
                <span className="site-muted-small">{t('İndirme sayfası yakında · Windows 10 ve 11')}</span>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section className="site-container site-section">
        <h2>{t('Üç adımda başla.')}</h2>
        <ol className="site-steps">
          <li>
            <span className="site-step-num">1</span>
            <h3>{t('Hesabını aç')}</h3>
            <p>{t('Kullanıcı adı, e-posta ve şifre yeter. E-postana gelen bağlantıyla hesabını doğrula.')}</p>
          </li>
          <li>
            <span className="site-step-num">2</span>
            <h3>{t('Bir çember kur ya da katıl')}</h3>
            <p>{t('Kendi sunucunu oluştur ya da sana gönderilen davet bağlantısına tıkla.')}</p>
          </li>
          <li>
            <span className="site-step-num site-step-num-filled">3</span>
            <h3>{t('Konuşmaya başla')}</h3>
            <p>{t('Sesli kanala gir, mikrofon iznini ver. Yazmak istersen kanal hemen yanında.')}</p>
          </li>
        </ol>
      </section>

      <section id="ozellikler" className="site-container site-section site-section-tight">
        <h2>{t('İçinde neler var?')}</h2>
        <div className="site-features">
          <Feature title={t('Sesli kanallar')} text={t('Kanala gir, konuşmaya başla. Kimin konuştuğunu çemberde görürsün.')} />
          <Feature title={t('Ekran paylaşımı')} text={t('Sesli kanaldayken ekranını tek tıkla paylaş.')} />
          <Feature title={t('Yazılı sohbet')} text={t('Yanıtla, @bahset, tepki ver, eski mesajlarda ara.')} />
          <Feature title={t('Özel mesajlar')} text={t('Arkadaş ekle, bire bir yaz, dosya gönder.')} />
          <Feature title={t('Bildirimler')} text={t('Zircle kapalıyken bile yeni mesajlardan haberin olur.')} />
          <Feature title={t('Topluluk araçları')} text={t('Davet bağlantıları, moderatörler, raporlama.')} />
        </div>
      </section>

      <section id="guvenlik" className="site-band site-band-bordered">
        <div className="site-container site-section site-security">
          <div className="site-section-head">
            <h2>{t('Hesabın senin kontrolünde.')}</h2>
            <p>{t('Kimin girdiğini görür, istemediğin oturumu kapatırsın.')}</p>
          </div>
          <ul className="site-security-list">
            <li>
              <span>{t('İki adımlı doğrulama')}</span>
              <span>{t('Şifrenin yanında telefonundaki uygulamanın ürettiği kodu da sorar.')}</span>
            </li>
            <li>
              <span>{t('Açık oturumlar')}</span>
              <span>{t('Hesabının açık olduğu cihazları listeler, tek tıkla çıkış yaptırır.')}</span>
            </li>
            <li>
              <span>{t('Konumsuz fotoğraflar')}</span>
              <span>{t('Paylaştığın fotoğraflardaki konum ve cihaz bilgisi gönderilmeden önce silinir.')}</span>
            </li>
          </ul>
        </div>
      </section>

      <section id="sss" className="site-container site-container-narrow site-section">
        <h2>{t('Sık sorulanlar')}</h2>
        <div className="site-faq">
          <Faq open question={t('Bir şey kurmam gerekiyor mu?')}>
            {t('Hayır. Zircle tarayıcıda çalışır; giriş yapman yeter. İstersen Windows uygulamasını da kurabilirsin.')}
          </Faq>
          <Faq question={t('Telefonda kullanabilir miyim?')}>
            {t('Evet. Telefonunun tarayıcısından aç, ana ekranına ekle; uygulama gibi açılır ve bildirim gönderir.')}
          </Faq>
          <Faq question={t('Arkadaşlarımı nasıl çağırırım?')}>
            {t('Sunucunda bir davet bağlantısı oluştur ve paylaş. Bağlantıya tıklayan kişi giriş yapıp sunucuna katılır.')}
          </Faq>
          <Faq question={t('Hesabımı silebilir miyim?')}>
            {t('Evet. Ayarlar bölümündeki Hesap Silme adımından hesabını kalıcı olarak silebilirsin.')}
          </Faq>
        </div>
      </section>

      <section className="site-cta">
        <div className="site-cta-ring" aria-hidden="true" />
        <div className="site-cta-ring site-cta-ring-inner" aria-hidden="true" />
        <div className="site-cta-inner">
          <h2>{t('Çemberde yerin hazır.')}</h2>
          <button type="button" className="site-btn site-btn-primary site-btn-large" onClick={() => goToCard('register')}>
            {t('Kayıt ol')}
          </button>
        </div>
      </section>
    </SiteLayout>
  );
}

function Feature({ title, text }: { title: string; text: string }) {
  return (
    <div className="site-feature">
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

function Faq({ question, open, children }: { question: string; open?: boolean; children: string }) {
  return (
    <details open={open}>
      <summary>
        {question}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </summary>
      <p>{children}</p>
    </details>
  );
}

function CheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9s1.3-6.4 3.8-9z" />
    </svg>
  );
}

function MonitorIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8" />
      <path d="M12 16v4" />
    </svg>
  );
}

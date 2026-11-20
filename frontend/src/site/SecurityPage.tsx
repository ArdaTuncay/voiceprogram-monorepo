import type { ReactNode } from 'react';
import { useT } from '../i18n';
import SiteLayout, { MonitorIcon, PageHero } from './SiteLayout';

/** The security page (`/guvenlik`): what Zircle does to protect accounts and
 * what people share — each item is something the app really does. */
export default function SecurityPage() {
  const t = useT();

  const items: [ReactNode, string, string][] = [
    [
      <ShieldIcon key="i" />,
      t('İki adımlı doğrulama'),
      t('Şifrenden sonra telefonundaki doğrulama uygulamasının kodunu sorar. Telefonuna erişemezsen kurtarma kodlarınla girersin.'),
    ],
    [
      <MonitorIcon key="i" size={28} />,
      t('Açık oturumlar'),
      t('Hesabının açık olduğu her cihazı son etkinlik zamanıyla görürsün. Tanımadığın oturumu tek tıkla kapatırsın.'),
    ],
    [
      <Icon key="i">
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </Icon>,
      t('Şifren'),
      t('Şifren düz metin olarak saklanmaz. Şifreni değiştirdiğinde açık oturumların kapanır.'),
    ],
    [
      <Icon key="i">
        <path d="M12 21s7-6.2 7-11a7 7 0 0 0-14 0c0 4.8 7 11 7 11z" />
        <path d="M4 4l16 16" />
      </Icon>,
      t('Fotoğraf gizliliği'),
      t('Paylaştığın fotoğraflardaki konum, cihaz ve çekim zamanı bilgisi dosya saklanmadan önce silinir.'),
    ],
    [
      <Icon key="i">
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
        <path d="M14 3v5h5" />
      </Icon>,
      t('Özel mesaj ekleri'),
      t('Özel mesajda gönderdiğin dosyaların herkese açık bir adresi yoktur; yalnızca süresi dolan bağlantılarla açılır.'),
    ],
    [
      <Icon key="i">
        <path d="M4 9v6h4l5 4V5L8 9H4z" />
        <path d="M17 9a4 4 0 0 1 0 6" />
      </Icon>,
      t('Sesli görüşmeler'),
      t('Ses ve ekran paylaşımı aktarılırken şifrelenir.'),
    ],
    [
      <Icon key="i">
        <circle cx="12" cy="12" r="9" />
        <path d="M6 6l12 12" />
      </Icon>,
      t('Engelleme ve istek gizliliği'),
      t('İstemediğin kişiyi engelle. Kimlerin sana arkadaşlık isteği gönderebileceğini kendin seç.'),
    ],
    [
      <Icon key="i">
        <path d="M5 21V4" />
        <path d="M5 4h12l-2 4 2 4H5" />
      </Icon>,
      t('Raporlama'),
      t('Sunucudaki bir mesajı bildirdiğinde sunucunun sahibi ve moderatörleri, özel mesajı bildirdiğinde Zircle ekibi inceler.'),
    ],
    [
      <Icon key="i">
        <path d="M4 7h16" />
        <path d="M9 7V4h6v3" />
        <path d="M6 7l1 13h10l1-13" />
      </Icon>,
      t('Hesabını silme'),
      t('Hesabını ayarlardan istediğin zaman kalıcı olarak silebilirsin.'),
    ],
  ];

  return (
    <SiteLayout current="security" title={t('Güvenlik')}>
      <PageHero
        eyebrow={t('Güvenlik ve gizlilik')}
        title={t('Hesabına kimin girdiğini sen bilirsin.')}
        lead={t("Zircle'ın hesabını ve paylaştıklarını korumak için yaptıkları, olduğu gibi.")}
      />

      <section className="site-container site-section-flush">
        <div className="site-cards site-cards-3">
          {items.map(([icon, title, text]) => (
            <article key={title} className="site-card">
              {icon}
              <h2>{title}</h2>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="site-band">
        <div className="site-container site-section site-know">
          <h2>{t('Bilmen gerekenler')}</h2>
          <p>
            {t('Mesajların uçtan uca şifreli değildir; sunucularımızda saklanır. Raporlanan bir mesajın kopyası, inceleme için raporla birlikte tutulur.')}
          </p>
          <a href="/gizlilik" className="site-text-link">
            {t('Gizlilik Politikası')}
          </a>
        </div>
      </section>
    </SiteLayout>
  );
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

function ShieldIcon() {
  return (
    <Icon>
      <path d="M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </Icon>
  );
}

import type { ReactNode } from 'react';
import { useT } from '../i18n';
import SiteLayout from './SiteLayout';

interface Group {
  icon: ReactNode;
  title: string;
  text: string;
  items: [string, string][];
}

/** The public features page (`/ozellikler`): everything Zircle does, in four
 * groups. Only features that exist in the app are listed here. */
export default function FeaturesPage() {
  const t = useT();

  const groups: Group[] = [
    {
      icon: <MicIcon />,
      title: t('Ses'),
      text: t('Kanala gir, konuş. Arama başlatmana gerek yok.'),
      items: [
        [t('Sesli kanallar'), t('Kanala gir, konuş. Konuşan kişi vurgulanır.')],
        [t('Ekran paylaşımı'), t('Sesli kanaldayken ekranını ya da bir pencereyi paylaş.')],
        [t('Birlikte izle'), t('Bir video bağlantısını kanaldaki herkesle aynı anda izle.')],
        [t('Kişiye özel ses düzeyi'), t('Her katılımcının sesini ayrı ayarla.')],
        [t('Sustur ve sağırlaştır'), t('Mikrofonunu ya da gelen sesi tek tuşla kapat.')],
        [t('Mikrofon seçimi ve testi'), t('Mikrofonunu seç, kanala girmeden dene.')],
      ],
    },
    {
      icon: <ChatIcon />,
      title: t('Sohbet'),
      text: t('Yazdıkların kanalda kalır.'),
      items: [
        [t('Yanıt ve bahsetme'), t('Bir mesaja yanıt ver ya da birini adıyla çağır.')],
        [t('Tepkiler'), t('Bir mesaja emojiyle karşılık ver.')],
        [t('Mesaj arama'), t('Kanallarda ve özel mesajlarda eski mesajları bul.')],
        [t('Dosya paylaşımı'), t("Resimler 8 MB'a, belgeler ve arşivler 25 MB'a kadar.")],
        [t('Bağlantı önizlemeleri'), t('Paylaşılan bağlantının başlığı ve görseli mesajın altında görünür.')],
        [t('Düzenleme ve silme'), t('Gönderdiğin mesajı düzelt ya da sil.')],
      ],
    },
    {
      icon: <PeopleIcon />,
      title: t('Topluluk'),
      text: t('Küçük bir arkadaş grubundan büyük bir sunucuya kadar.'),
      items: [
        [t('Sunucular ve kanallar'), t('Sunucunu kur, yazılı ve sesli kanalları istediğin gibi sırala.')],
        [t('Davet bağlantıları'), t('Bağlantı oluştur ve paylaş. İstediğinde iptal et.')],
        [t('Moderatörler'), t('Güvendiğin üyelere yönetim yetkisi ver.')],
        [t('Raporlama'), t('Üyeler uygunsuz mesajları bildirir, sunucu sahibi ve moderatörler inceler.')],
        [t('Atma ve yasaklama'), t('Kurallara uymayan üyeyi çıkar ya da tekrar girmesini engelle.')],
      ],
    },
    {
      icon: <PersonIcon />,
      title: t('Hesap ve uygulama'),
      text: t("Zircle'ı kendine göre ayarla."),
      items: [
        [t('Arkadaşlar ve özel mesajlar'), t('Arkadaş ekle, bire bir yaz. Kimlerin istek gönderebileceğini sen seç.')],
        [t('Bildirimler'), t('Uygulama kapalıyken de özel mesaj ve bahsetmelerden haberin olur.')],
        [t('Tema'), t('Koyu, açık ya da sistem ayarına göre.')],
        [t('Dil'), t('Türkçe ya da İngilizce.')],
        [t('Hesap güvenliği'), t('İki adımlı doğrulama ve açık oturum yönetimi.')],
      ],
    },
  ];

  return (
    <SiteLayout current="features">
      <section className="site-container site-page-hero">
        <p className="site-eyebrow">{t('Özellikler')}</p>
        <h1>{t('Sohbet için gereken her şey.')}</h1>
        <p className="site-lead">{t('Sesli kanallar, mesajlaşma ve sunucu yönetimi tek uygulamada.')}</p>
      </section>

      {groups.map((group, i) => (
        <section key={group.title} className={i % 2 === 1 ? 'site-fgroup site-fgroup-deep' : 'site-fgroup'}>
          <div className="site-container site-fgroup-inner">
            <div className="site-fgroup-intro">
              <span className="site-fgroup-icon" aria-hidden="true">
                {group.icon}
              </span>
              <h2>{group.title}</h2>
              <p>{group.text}</p>
            </div>
            <dl className="site-fgroup-list">
              {group.items.map(([name, text]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>{text}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      ))}

      <section className="site-page-cta">
        <div className="site-container site-page-cta-inner">
          <h2>{t('Hemen dene.')}</h2>
          <a href="/#giris" className="site-btn site-btn-primary site-btn-large">
            {t('Tarayıcıda aç')}
          </a>
        </div>
      </section>
    </SiteLayout>
  );
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

function MicIcon() {
  return (
    <Icon>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </Icon>
  );
}

function ChatIcon() {
  return (
    <Icon>
      <path d="M4 5h16v11H9l-5 4z" />
    </Icon>
  );
}

function PeopleIcon() {
  return (
    <Icon>
      <circle cx="8" cy="9" r="3.5" />
      <circle cx="17" cy="10" r="2.5" />
      <path d="M2 20c0-3 2.6-5 6-5s6 2 6 5" />
      <path d="M16 15c3 0 5 1.8 5 4" />
    </Icon>
  );
}

function PersonIcon() {
  return (
    <Icon>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.5-7 8-7s8 3 8 7" />
    </Icon>
  );
}

import { useT } from '../i18n';
import SiteLayout, { PageHero } from './SiteLayout';
import { Faq } from './HomePage';

/** The support page (`/destek`): the most common questions, by topic. Every
 * answer names the app's real buttons and settings. */
export default function SupportPage() {
  const t = useT();

  const groups: { title: string; items: [string, string][] }[] = [
    {
      title: t('Hesap ve giriş'),
      items: [
        [t('Doğrulama e-postası gelmedi'), t('Önce gereksiz e-posta klasörüne bak. Orada da yoksa giriş ekranından doğrulama e-postasını yeniden isteyebilirsin.')],
        [t('Şifremi unuttum'), t('Giriş ekranındaki "Şifremi unuttum" bağlantısına tıkla; e-postana şifreni yenileyeceğin bir bağlantı gelir.')],
        [t('İki adımlı doğrulamada telefonuma erişemiyorum'), t('Kod yerine kurtarma kodlarından birini gir. Her kurtarma kodu yalnızca bir kez kullanılır.')],
      ],
    },
    {
      title: t('Ses ve mikrofon'),
      items: [
        [t('Beni duymuyorlar'), t("Tarayıcının bu site için mikrofon iznini verdiğinden emin ol. Sonra Ayarlar'daki Ses & Görüntü bölümünden doğru mikrofonu seçip test et.")],
        [t('Kimseyi duyamıyorum'), t('Sesi kapatma düğmesinin açık kalmadığına ve o kişinin ses düzeyini kısmadığına bak.')],
        [t('Ses kesiliyor'), t('İnternet bağlantın zayıflamış olabilir. Bağlantı koparsa Zircle kendiliğinden yeniden bağlanmayı dener.')],
      ],
    },
    {
      title: t('Sunucular ve davetler'),
      items: [
        [t('Davet bağlantısı çalışmıyor'), t('Bağlantının süresi dolmuş ya da bağlantı iptal edilmiş olabilir. Seni davet eden kişiden yeni bir bağlantı iste.')],
        [t('Kendi sunucumu nasıl kurarım?'), t("Sunucu listesindeki artı düğmesine tıkla, Sunucu Oluştur'u seç ve sunucuna bir ad ver. Ardından bir davet bağlantısı oluşturup arkadaşlarınla paylaş.")],
        [t('Rahatsız edici bir mesajı nasıl bildiririm?'), t('Mesajın menüsünü aç ve "Raporla"yı seç. Bir sebep belirtmen yeterli; istersen açıklama da ekleyebilirsin.')],
      ],
    },
  ];

  return (
    <SiteLayout current="support" title={t('Destek')}>
      <PageHero eyebrow={t('Destek')} title={t('Nasıl yardımcı olabiliriz?')} lead={t('En sık sorulanlar aşağıda.')} />

      {groups.map((group, i) => (
        <section key={group.title} className={i % 2 === 1 ? 'site-fgroup site-fgroup-deep' : 'site-fgroup'}>
          <div className="site-container site-fgroup-inner">
            <h2 className="site-faq-title">{group.title}</h2>
            <div className="site-faq site-faq-wide">
              {group.items.map(([question, answer], j) => (
                <Faq key={question} open={j === 0} question={question}>
                  {answer}
                </Faq>
              ))}
            </div>
          </div>
        </section>
      ))}
    </SiteLayout>
  );
}

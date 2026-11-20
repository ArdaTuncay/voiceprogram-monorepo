import type { ReactNode } from 'react';
import { useT, useLanguageStore } from '../i18n';
import SiteLayout, { PageHero } from './SiteLayout';
import type { SitePage } from './siteHome';

/*
 * The privacy policy (/gizlilik) and terms of use (/kosullar). The text is
 * a first draft written from what the app really does (see the git history
 * of this file for the review), and is in Turkish only until it has had a
 * legal review. Filled in with the owner's answers on 20 Nov 2026; only the
 * "Son güncelleme" date is set on the launch day.
 */

interface Section {
  id: string;
  title: string;
  body: ReactNode;
}

function LegalPage({ current, title, intro, sections, seeAlso }: {
  current: SitePage;
  title: string;
  intro: ReactNode;
  sections: Section[];
  seeAlso: { href: string; label: string }[];
}) {
  const t = useT();
  const language = useLanguageStore((s) => s.language);

  return (
    <SiteLayout current={current} title={title}>
      <PageHero eyebrow={t('Yasal')} title={title} lead={t('Son güncelleme: {date}', { date: '[yayın tarihi]' })} />
      <section className="site-container site-section-flush site-legal">
        <nav aria-label={t('İçindekiler')} className="site-legal-toc">
          <span>{t('İçindekiler')}</span>
          {sections.map((s) => (
            <a key={s.id} href={`#${s.id}`}>
              {s.title}
            </a>
          ))}
        </nav>
        <div className="site-legal-body" lang="tr">
          {language === 'en' && (
            <p className="site-legal-notice" lang="en">
              {t('Bu sayfa şimdilik yalnızca Türkçe.')}
            </p>
          )}
          <div className="site-legal-intro">{intro}</div>
          {sections.map((s) => (
            <section key={s.id} id={s.id}>
              <h2>{s.title}</h2>
              {s.body}
            </section>
          ))}
          <p className="site-legal-see">
            {t('Ayrıca bak:')}{' '}
            {seeAlso.map((link, i) => (
              <span key={link.href}>
                {i > 0 && ' · '}
                <a href={link.href}>{link.label}</a>
              </span>
            ))}
          </p>
        </div>
      </section>
    </SiteLayout>
  );
}

const CONTACT = (
  <p>
    Başvuruların ve soruların için: <a href="mailto:ceng.ardatuncay@gmail.com">ceng.ardatuncay@gmail.com</a>. Sık sorulan sorular için <a href="/destek">Destek</a> sayfasına bakabilirsin.
  </p>
);

export function PrivacyPage() {
  const t = useT();
  return (
    <LegalPage
      current="privacy"
      title={t('Gizlilik Politikası')}
      seeAlso={[
        { href: '/kosullar', label: t('Kullanım Koşulları') },
        { href: '/guvenlik', label: t('Güvenlik') },
      ]}
      intro={
        <p>
          Bu metin, Zircle'ı kullandığında hangi verilerinin tutulduğunu, ne için kullanıldığını ve neler yapabileceğini
          anlatır. 6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) kapsamında veri sorumlusu{' '}
          Arda Tuncay'dur.
        </p>
      }
      sections={[
        {
          id: 'g1',
          title: '1. Topladığımız veriler',
          body: (
            <>
              <ul>
                <li><b>Hesap bilgileri:</b> kullanıcı adın, e-posta adresin, profil fotoğrafın ve arkadaşlık isteği tercihin. Şifren düz metin olarak değil, geri çevrilemez biçimde (karma olarak) saklanır.</li>
                <li><b>İki adımlı doğrulama:</b> açarsan doğrulama anahtarın ve kurtarma kodlarının karma hâlleri.</li>
                <li><b>Paylaştıkların:</b> sunucularda ve özel mesajlarda yazdığın mesajlar, tepkiler, gönderdiğin dosyalar; oluşturduğun sunucuların adı, simgesi, kanalları ve davet bağlantıları.</li>
                <li><b>Oturum bilgileri:</b> her açık oturum için tarayıcı ve cihaz bilgisi, IP adresi ve son etkinlik zamanı. Bunları sana açık oturumlarını göstermek ve hesabını korumak için tutarız.</li>
                <li><b>Bildirimler:</b> bildirime izin verirsen, tarayıcının bize verdiği bildirim adresi ve dil tercihin.</li>
                <li><b>Raporlar:</b> bir mesajı raporladığında, mesajın bir kopyası, seçtiğin sebep ve yazdığın açıklama.</li>
              </ul>
              <p>Sesli görüşmeleri ve ekran paylaşımını kaydetmeyiz. Paylaştığın fotoğraflardaki konum, cihaz ve çekim zamanı bilgisi, fotoğraf saklanmadan önce silinir.</p>
            </>
          ),
        },
        {
          id: 'g2',
          title: '2. Verileri nasıl kullanıyoruz',
          body: (
            <>
              <ul>
                <li>Mesajlarını iletmek, sesli görüşmeleri bağlamak ve hizmeti çalıştırmak için.</li>
                <li>Hesabını korumak için: oturumları yönetmek, iki adımlı doğrulama ve kötüye kullanımı sınırlamak.</li>
                <li>Sana yalnızca hesabınla ilgili e-postalar göndermek için: e-posta doğrulama, şifre sıfırlama ve e-posta değişikliği onayı.</li>
                <li>İzin verdiğin bildirimleri göndermek için.</li>
                <li>Raporları incelemek için. Sunucudaki raporlar sunucu sahibine ve moderatörlere, özel mesaj raporları Zircle ekibine gider.</li>
              </ul>
              <p>Verilerini reklam için kullanmayız ve satmayız.</p>
            </>
          ),
        },
        {
          id: 'g3',
          title: '3. Saklama ve silme',
          body: (
            <>
              <p>Verilerin hesabın açık olduğu sürece saklanır. Bir mesajı sildiğinde içeriği kalıcı olarak kaldırılır. Bir oturumdan çıkış yaptığında o oturumun kaydı silinir.</p>
              <p>Hesabını sildiğinde:</p>
              <ul>
                <li>Kullanıcı adın, e-posta adresin, profil fotoğrafın ve iki adımlı doğrulama bilgilerin silinir; hesabın anonim hâle gelir.</li>
                <li>Arkadaşlıkların ve sunucu üyeliklerin kaldırılır.</li>
                <li>Sahibi olduğun sunucu başka üyelere sahipse en eski üyeye devredilir; başka üyesi yoksa tüm içeriğiyle silinir.</li>
                <li><b>Daha önce gönderdiğin mesajlar silinmez;</b> diğer kişilerin sohbet geçmişi bozulmasın diye "silinmiş kullanıcı" adıyla görünmeye devam eder. Silinmesini istediğin mesajları hesabını kapatmadan önce tek tek silebilirsin.</li>
              </ul>
              <p>Raporlar, inceleme tamamlanana kadar ve kötüye kullanımı önlemek için gerektiği sürece saklanır.</p>
            </>
          ),
        },
        {
          id: 'g4',
          title: '4. Üçüncü taraflar',
          body: (
            <>
              <p>Zircle'ı çalıştırmak için aşağıdaki hizmetlerden yararlanırız. Bu hizmetler verilerini yalnızca bizim adımıza işler; bazıları yurt dışında bulunur.</p>
              <ul>
                <li><b>Vercel:</b> web sitesinin ve uygulamanın yayınlanması.</li>
                <li><b>Render:</b> sunucumuzun barındırılması.</li>
                <li><b>Cloudflare R2:</b> paylaşılan dosyaların ve fotoğrafların saklanması.</li>
                <li><b>Neon:</b> veritabanımızın barındırılması.</li>
                <li><b>Brevo:</b> hesabınla ilgili e-postaların gönderilmesi.</li>
                <li><b>Metered:</b> doğrudan bağlanamayan cihazlar için sesli görüşme bağlantısının aktarılması.</li>
                <li><b>Tarayıcı bildirim servisleri</b> (Google, Mozilla, Apple): bildirimlerin cihazına ulaştırılması. Bildirimi kullanmıyorsan bu servislere bir şey gönderilmez.</li>
                <li><b>YouTube:</b> "Birlikte izle"de bir YouTube videosu açıldığında video YouTube'dan yüklenir.</li>
                <li><b>Cloudflare:</b> sunucumuza gelen trafiğin iletilmesi ve korunması (Render'ın altyapısı üzerinden).</li>
              </ul>
              <p>Mesajda bir bağlantı paylaştığında, önizlemesini göstermek için bağlantıdaki sayfayı bizim sunucumuz açar; senin IP adresin o siteye gönderilmez.</p>
            </>
          ),
        },
        {
          id: 'g5',
          title: '5. Çerezler ve yerel depolama',
          body: (
            <p>Zircle çerez kullanmaz. Tarayıcının yerel depolamasında yalnızca şunları tutarız: oturum anahtarın, hesap bilgilerin, dil ve tema tercihin, kapattığın uyarılar. Çıkış yaptığında oturum bilgilerin bu cihazdan silinir. Bildirimler için tarayıcına küçük bir arka plan betiği (service worker) kurulur.</p>
          ),
        },
        {
          id: 'g6',
          title: '6. Hakların',
          body: (
            <>
              <p>KVKK'nın 11. maddesi uyarınca verilerinin işlenip işlenmediğini öğrenme, bilgi isteme, düzeltilmesini ya da silinmesini isteme ve itiraz etme hakların vardır. Bunların çoğunu doğrudan uygulamadan yapabilirsin:</p>
              <ul>
                <li>Kullanıcı adını, e-posta adresini ve şifreni Ayarlar'dan değiştirebilirsin.</li>
                <li>Açık oturumlarını görebilir ve kapatabilirsin.</li>
                <li>Hesabını Ayarlar'dan kalıcı olarak silebilirsin.</li>
              </ul>
              <p>Diğer talepler için bize aşağıdaki adresten ulaşabilirsin.</p>
            </>
          ),
        },
        {
          id: 'g7',
          title: '7. İletişim',
          body: (
            <>
              <p>Bu politikayla ilgili soruların ve KVKK başvuruların için:</p>
              {CONTACT}
            </>
          ),
        },
      ]}
    />
  );
}

export function TermsPage() {
  const t = useT();
  return (
    <LegalPage
      current="terms"
      title={t('Kullanım Koşulları')}
      seeAlso={[
        { href: '/gizlilik', label: t('Gizlilik Politikası') },
        { href: '/guvenlik', label: t('Güvenlik') },
      ]}
      intro={
        <p>
          Zircle'ı kullanarak bu koşulları kabul etmiş olursun. Zircle'ı Arda Tuncay sunar.
        </p>
      }
      sections={[
        {
          id: 'k1',
          title: '1. Hizmetin tanımı',
          body: (
            <p>
              Zircle; sesli kanallar, yazılı sohbet, özel mesajlar ve dosya paylaşımı sunan bir sohbet hizmetidir. Tarayıcıdan
              ve Windows uygulamasından kullanılır. Zircle ücretsizdir. Hizmeti geliştirmek için özellikleri
              zaman içinde değiştirebiliriz.
            </p>
          ),
        },
        {
          id: 'k2',
          title: '2. Hesap ve yaş sınırı',
          body: (
            <ul>
              <li>Zircle'ı kullanmak için en az 13 yaşında olmalısın.</li>
              <li>Kayıt olurken doğru bir e-posta adresi vermelisin.</li>
              <li>Şifreni kimseyle paylaşma. Hesabında yapılanlardan sen sorumlusun; iki adımlı doğrulamayı açmanı öneririz.</li>
              <li>Hesabın sana özeldir; başkasına devredemezsin.</li>
            </ul>
          ),
        },
        {
          id: 'k3',
          title: '3. Kabul edilebilir kullanım',
          body: (
            <>
              <p>Zircle'da şunları yapmamalısın:</p>
              <ul>
                <li>Yasalara aykırı içerik paylaşmak.</li>
                <li>Başkalarını taciz etmek, tehdit etmek ya da nefret söylemi yaymak.</li>
                <li>İstenmeyen toplu mesaj (spam) göndermek.</li>
                <li>Zararlı yazılım ya da kandırmaya yönelik bağlantılar paylaşmak.</li>
                <li>Başkalarının kişisel bilgilerini izinsiz paylaşmak.</li>
                <li>Başkasının hesabına girmeye çalışmak ya da hizmeti bozmaya, aşırı yüklemeye çalışmak.</li>
              </ul>
            </>
          ),
        },
        {
          id: 'k4',
          title: '4. İçerik ve sorumluluk',
          body: (
            <p>
              Paylaştığın içerik sana aittir ve sorumluluğu sendedir. Zircle'a yalnızca hizmeti sunmak için gereken izni
              verirsin: içeriğini saklamak, iletmek ve paylaştığın kişilere göstermek. Sunucuları sahipleri ve moderatörleri
              yönetir; kendi kurallarını koyabilir, üyeleri çıkarabilir ya da yasaklayabilirler. Kurallara aykırı bir içerik
              görürsen raporlayabilirsin.
            </p>
          ),
        },
        {
          id: 'k5',
          title: '5. Hesabın askıya alınması ve kapatılması',
          body: (
            <p>
              Bu koşullara aykırı kullanımda hesabını kısıtlayabilir, askıya alabilir ya da kapatabiliriz. Sen de hesabını
              istediğin zaman Ayarlar'dan kalıcı olarak silebilirsin; silmenin sonuçları{' '}
              <a href="/gizlilik#g3">Gizlilik Politikası</a>'nda anlatılır.
            </p>
          ),
        },
        {
          id: 'k6',
          title: '6. Sorumluluğun sınırı',
          body: (
            <p>
              Zircle'ı olduğu gibi sunarız. Hizmetin kesintisiz ya da hatasız olacağını garanti edemeyiz. Önemli dosyalarının
              bir kopyasını kendinde tutmanı öneririz. Yasaların izin verdiği ölçüde, hizmetin kullanılmasından ya da
              kullanılamamasından doğan dolaylı zararlardan sorumlu değiliz.
            </p>
          ),
        },
        {
          id: 'k7',
          title: '7. Koşullardaki değişiklikler',
          body: (
            <p>
              Bu koşulları zaman zaman güncelleyebiliriz. Önemli bir değişiklik olduğunda bunu sitede ya da uygulamada
              duyururuz; güncel tarih sayfanın başında yazar. Değişiklikten sonra Zircle'ı kullanmaya devam etmen, yeni
              koşulları kabul ettiğin anlamına gelir.
            </p>
          ),
        },
        {
          id: 'k8',
          title: '8. İletişim',
          body: (
            <>
              <p>Bu koşullarla ilgili soruların için:</p>
              {CONTACT}
            </>
          ),
        },
      ]}
    />
  );
}

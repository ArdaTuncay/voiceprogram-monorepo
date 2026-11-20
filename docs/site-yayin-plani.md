# Tanıtım sitesi: yayın planı

Son güncelleme: 20 Kasım 2026

Bu dosya, Zircle tanıtım sitesinin nerede kaldığını ve yayına almadan önce neler yapılacağını tutar. Yeni bir sohbete başlarken önce bu dosyayı oku.

## Nerede kaldık

Sitenin tüm sayfaları yerelde kuruldu ve testleri geçiyor. GitHub'a gönderildi ve taslak PR #44 olarak açıldı (20 Kasım).

- **Dal:** `feat/site-sayfalar`, taslak PR #44.
- **Dalların sırası:** `main` ← #41 `feat/site-ana-sayfa` (ana sayfa) ← #42 `feat/site-ozellikler` (Özellikler) ← `feat/site-sayfalar` (diğer tüm sayfalar)
- **Açık PR'lar:** #41, #42 ve taslak #44. Hiçbiri merge edilmedi.
- **Testler:** Sunucu tarafında 635, ön yüzde 601 testin hepsi geçti. Tip kontrolü, lint ve derleme temiz.
- **Tarayıcı kontrolü:** 13 adres hem geniş ekranda hem 390 piksel genişlikte açıldı. Hata ekranı, yatay taşma ya da konsol hatası yok.
- **Sıradaki adım:** Kullanıcının kararıyla (20 Kasım) önce **Zircle uygulamasının tasarımı** yenilenecek. Ardından sitedeki eksikler tamamlanıp yayına çıkılacak. Site işi #44'te bekliyor.

### Yerelde çalıştırma

```powershell
& "C:\Program Files\PostgreSQL\17\bin\pg_ctl.exe" start -D "C:\Program Files\PostgreSQL\17\data" -l <log dosyası> -w
cd backend;  mix ecto.migrate;  mix phx.server     # http://localhost:4000
cd frontend; npm run dev                           # http://localhost:5173
```

- **Oturumun açıkken siteyi görmek:** `/` ve `/giris` adresleri oturum açıkken doğrudan Zircle'ı açar. Siteyi görmek için gizli pencere kullan.
- **Örnek davet:** Yerel veritabanında testlerden kalmış geçerli bir davet var: `/davet/91Fhckt`.
- **Vite tuzağı:** Bir dosya iki adımda düzenlenirken Vite açıksa yarım hâli önbelleğe alabilir (örneğin "useEffect is not defined" hatası). Böyle olursa Vite'ı yeniden başlat.

## Sayfalar ve verilen kararlar

| Sayfa | Adres | Karar |
|---|---|---|
| Ana sayfa | `/` (yalnızca oturum kapalıyken) | "A · Sade ve net" metinleri. Sayfalara giden bağlantılar ve "Windows için indir" düğmeleri tasarımdaki gibi |
| Özellikler | `/ozellikler` | Sade metinler. Tasarıma ek olarak "Birlikte izle". Bildirim metni gerçek davranışa göre yazıldı |
| İndir | `/indir` | Tasarım aynen |
| Giriş ve kayıt | `/giris`, `/giris#kayit` | Tasarım aynen. Ana sayfadaki kartın aynısı |
| Davet | `/davet/<kod>` | Tam hâli: sunucu adı, simgesi ve davet eden. Metin: "{ad} seni bu sunucuya davet etti" |
| Güvenlik | `/guvenlik` | Başlık "Hesabına kimin girdiğini sen bilirsin." Kart başlığı "Fotoğraf gizliliği". "Bilmen gerekenler" bölümü kalıyor |
| Destek | `/destek` | İki düzeltme: "Ses & Görüntü" ve "Sunucu Oluştur" adımı. İletişim bölümü ve yanıt süresi cümlesi yok |
| Yenilikler | `/yenilikler` | Tek kayıt: "Sürüm 1.0 · Zircle yayında" |
| 404 | Bilinmeyen adres (oturum kapalıyken) | Başlık "Burada kimse yok." |
| Gizlilik, Koşullar | `/gizlilik`, `/kosullar` | Koddan yazılmış taslak metin. Şimdilik yalnızca Türkçe; İngilizce seçilince bunu söyleyen bir not görünüyor |

**Genel kurallar:**
- **E-posta yok:** Alan adı alınana kadar sitede hiçbir yerde e-posta adresi gösterilmiyor.
- **Çemberler kalıyor:** Çember görsellerini kaldırma fikri değerlendirildi ve iptal edildi; site tasarımdaki hâliyle kalıyor.
- **Uygulamaya dokunulmuyor:** Tek istisna, davet penceresine eklenen paylaşılabilir bağlantı.
- **Masaüstü uygulaması siteyi hiç göstermez.**

Tasarım tuvali, "A2 sitesi" sayfası: https://claude.ai/artifact/1EqN3rYWJd8LEwbfCCGxGS

## Yayından önce yapılacaklar

### 1. Kullanıcının incelemesi
- [ ] Bütün sayfalara yerelde bakıp değişiklik isteklerini söylemek.

### 2. Gizlilik ve Koşullar için cevaplar
Taslak: https://claude.ai/artifact/YBkxVqBF1ezQ5eYUKmZ1a5. Sayfalarda sarı işaretli `<Todo>` alanları bunlar; hepsi `frontend/src/site/LegalPages.tsx` dosyasında.
- [ ] **Veri sorumlusu:** Zircle'ı işleten kişinin adı soyadı ya da şirketin unvanı.
- [ ] **KVKK başvuru adresi:** E-postayı gizleme kararıyla çelişiyor, ama bu iki metinde en az bir adres olmalı.
- [ ] **Yaş sınırı.**
- [ ] **Canlıda açık olan hizmetler:** Dosyalar hangi depolama hizmetinde (R2, S3 ya da başka)? Sentry açık mı? Önde Cloudflare var mı?
- [ ] **Sözler:** "Reklam göstermeyiz, verilerini satmayız" ve "Zircle ücretsizdir" cümleleri kalsın mı?
- [ ] **Son güncelleme tarihi:** "[yayın tarihi]" yerine yayın günü yazılacak.
- [ ] **Hukuki inceleme:** Yayından önce bir hukukçuya baktırmak önerilir. Sonrasında metinlerin İngilizcesi yazılabilir.
- Bilinmesi gereken: Hesap silinince kişi anonimleşir ama gönderdiği mesajlar silinmez. Taslak bunu açıkça yazıyor.

### 3. Masaüstü kurulum dosyası (1.0.0)
İndir düğmesi şu adresi gösteriyor: `https://github.com/ArdaTuncay/voiceprogram-monorepo/releases/download/desktop-v1.0.0/Zircle-Setup-1.0.0.exe`. Bu dosya henüz yok.
- [ ] Derlemek: `cd frontend; npm run build:electron`, sonra `cd desktop; npm run build:win`. (20 Kasım: site dalından deneme derlemesi yapıldı, 112,8 MB. Yayına çıkacak dosya merge'den sonra `main`'den yeniden derlenecek. Simge eklendi: `desktop/build/icon.png`, `favicon.svg`'deki maskottan üretilen 512×512 şeffaf PNG.)
- [ ] Kurulum dosyasını deneyip uygulamanın açıldığını ve giriş yapılabildiğini kontrol etmek.
  - 20 Kasım: `feat/uygulama-tasarim`'dan (tüm site + yeni tasarım) aday derlendi: `desktop/dist/Zircle-Setup-1.0.0.exe`, 112,9 MB. Paketli uygulama açıldı, yeni başlık çubuğu çalışıyor, canlı sunucuya (`/api/healthz` 200) ulaşıyor. Giriş ekranının dar sütuna sıkışma hatası düzeltildi (f5e46f4). **Kalan:** kurulum dosyasını kurup gerçek hesapla giriş yapmak (kullanıcı yapacak).
- [ ] **Yayın günü** (kullanıcı kararı, 20 Kasım): GitHub'da `desktop-v1.0.0` sürümünü oluşturup `Zircle-Setup-1.0.0.exe` dosyasını yüklemek. **Dışarıya açık bir işlem; önce kullanıcıdan onay al.**
- [ ] `frontend/src/site/release.ts` içinde `date` (YYYY-AA-GG) ve `sizeMb` alanlarını doldurmak. Böylece İndir ve Yenilikler sayfalarında tarih ve boyut görünür.
- Eski `desktop-v1` sürümü (Ağustos, 0.0.0) 20 Kasım'da kullanıcının isteğiyle silindi. Git etiketi `desktop-v1` de silindi.

### 4. Kayıt ve PR'lar
- [x] `feat/site-sayfalar` dalını yerelde commit'lemek (20 Kasım).
- [x] Dalı push edip taslak PR açmak: #44, tabanı #42'nin dalı (20 Kasım).
- [ ] Merge sırası: önce #41, sonra #42, sonra yeni PR. Her merge'den sonra sıradaki PR'ın tabanını `main` yap, CI'ı tetiklemek için PR'ı kapatıp yeniden aç. Ayrıntısı hafıza notunda (zircle-launch-roadmap).
- **Dikkat:** #41 merge edildiği anda zircle.vercel.app'in ana adresi siteye döner. Hepsi hazır olmadan merge etme.

### 5. Teknik engeller
- [x] **`idna` güvenlik uyarısı (EEF-CVE-2026-117678):** PR #43 ile düzeltildi ve 20 Kasım'da `main`'e merge edildi (idna 8.0.0, swoosh 1.30.0). Render bu merge ile yeniden dağıtılır.
- [ ] **Alan adı:** `*.vercel.app` yurt ağında (GSBWIFI) engelli. Alan adı alınınca:
  - sunucunun CORS ve `check_origin` ayarlarına eklenecek,
  - CSP kontrol edilecek,
  - masaüstü uygulamasında `VITE_SITE_URL` ayarlanacak; davet bağlantıları buna göre oluşur, varsayılanı `https://zircle.vercel.app`,
  - destek e-postası (sitede yeniden gösterilecek) ve yasal metinlerdeki başvuru adresi bu alan adından kurulacak.
- [ ] Render ortam değişkenlerinde bekleyenler: `REPORTS_EMAIL`, `ADMIN_EMAILS`, Metered anahtarları. Ayrıntısı zircle-launch-roadmap hafıza notunda.

### 6. Yayın günü
1. Sunucu tarafı önce yayına çıkmalı, çünkü Davet sayfası yeni `GET /api/invites/:code` adresine bağlı. Kontrol: `curl https://zircle-backend.onrender.com/api/healthz` komutunun döndürdüğü `commit` değeri, merge commit'iyle aynı olmalı.
2. Ardından ön yüz Vercel'de yayına çıkar.
3. Canlıda kontrol listesi:
   - [ ] Her sayfa açılıyor; telefonda da.
   - [ ] Ana sayfadan ve `/giris`'ten giriş yapınca Zircle aynı sekmede açılıyor.
   - [ ] Kayıt ve e-posta doğrulaması çalışıyor.
   - [ ] Uygulamada davet bağlantısı oluşturulup gizli pencerede açılınca sunucu adı görünüyor; giriş yapınca sunucuya katılınıyor.
   - [ ] İndir düğmesi kurulum dosyasını indiriyor.
   - [ ] Olmayan bir adres 404 sayfasını gösteriyor.
   - [ ] Oturum açıkken `/` adresi doğrudan Zircle'ı açıyor.
   - [ ] Masaüstü uygulaması siteyi değil, kendi giriş ekranını gösteriyor.
4. Yenilikler ve yasal sayfalardaki tarihleri yayın günüyle güncellemek.

## Bu işte değişen başlıca dosyalar

- **Sunucu:**
  - `backend/lib/backend/servers.ex` (`preview_invite/1`)
  - `backend/lib/backend_web/controllers/invite_controller.ex` (`preview`, IP başına dakikada 30 istek sınırı)
  - `backend/lib/backend_web/router.ex`
  - `backend/test/backend_web/controllers/invite_preview_test.exs`
- **Site:**
  - `frontend/src/site/` altındaki bütün sayfalar
  - `siteHome.ts` (adres yönlendirmesi ve bekleyen davet)
  - `release.ts` (sürüm bilgisi)
  - `SiteLayout.tsx` (başlık ve alt bilgi; tam ve sade biçim)
- **Uygulama:**
  - `frontend/src/App.tsx`
  - `components/InviteModal.tsx` ve `utils/inviteLink.ts` (davet bağlantısı)
  - `hooks/useAuthFlow.ts` (başlangıç sekmesi)
- **Masaüstü:** `desktop/package.json` (sürüm 1.0.0, kurulum dosyası adı `Zircle-Setup-${version}.exe`)

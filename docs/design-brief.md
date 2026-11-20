# Tasarım Talimatı

Son güncelleme: 20 Kasım 2026. Dal: `feat/uygulama-tasarim`.

Bu dosya, Zircle'ın arayüzünü yeniden tasarlama işinin talimatıdır. Yeni bir oturumda tasarıma başlamadan önce bu dosyayı baştan sona oku.

## Bağlam

- **Ürün:** Zircle. Sesli ve yazılı sohbet uygulaması: sunucular, sesli ve yazılı kanallar, arkadaşlar, özel mesajlar, ekran paylaşımı, Birlikte İzle.
- **Hedef his:** Modern, sade, koyu tema öncelikli, oyuncu topluluklarına uygun.
- **Renk kararı (kullanıcı, 20 Kasım):** Renkler bugünkü gibi siyah ve gri kalacak. Tasarımlar birbirinden renkle değil, **yerleşim ve kurguyla** ayrışmalı. Açık tema yine desteklenir, ama koyu tema esastır.
- **Referanslar:** TeamSpeak 6 ve Discord'un masaüstü düzeni ile `design-refs/galeri.html`. Bu galeride Dribbble'dan seçilmiş 12 kurgu var; görseller internetten yüklenir, tarayıcıda açılmalı.
- **Önceki denemeler:** 20 Kasım'da iki tur örnek gösterildi ve beğenilmedi. Önce renk tabanlı üç yön, sonra beş yerleşim yönü (Klasik, Yörünge, Sahne, Yan panel, Lobi) denendi. Bunlar [Design tuvali](https://claude.ai/artifact/1EqN3rYWJd8LEwbfCCGxGS)'nin "Uygulama tasarımı" sayfasında duruyor. Aynı yönleri tekrar önerme; gerçek uygulama referanslarından yola çık.

### Teknik yapı

- **Ön yüz:** React 19, Vite 8, TypeScript 6; `frontend/` klasöründe. Tailwind yok: düz CSS, her bileşenin yanında bir `.css` dosyası. Simgeler `lucide-react`'ten, yazı tipi Inter (`@fontsource-variable/inter`).
- **Masaüstü:** Electron 43; `desktop/` klasöründe, giriş dosyası `desktop/main.js`. Ön yüzü `app://zircle/index.html` adresinden yükler. Kurulum dosyasını electron-builder (NSIS) üretir: `Zircle-Setup-<sürüm>.exe`. Kod imzası yok.
- **Sunucu:** Phoenix (Elixir) ve PostgreSQL; `backend/` klasöründe.
- **Ses:** Tarayıcının WebRTC'si, eşler arası bağlantı (`frontend/src/hooks/useVoiceChannel.ts`). TURN için Metered kullanılıyor.
- **Platformlar:** Aynı React kodu tarayıcıda, telefon tarayıcısında (PWA) ve Electron'da çalışır. Tasarım üçünde de çalışmalı. Windows'a özgü ayrıntılar (başlık çubuğu, sistem tepsisi) yalnızca Electron modunda geçerlidir (`import.meta.env.MODE === 'electron'`). Telefon için tek kırılma noktası 768 px.
- **Kısıt:** CSP'de `style-src 'self'` var. Satır içi `style` ve dış yazı tipi bağlantısı kullanılamaz; yazı tipleri pakete gömülür.

### Çalıştırma

```powershell
# PostgreSQL
& "C:\Program Files\PostgreSQL\17\bin\pg_ctl.exe" start -D "C:\Program Files\PostgreSQL\17\data" -l <log dosyası> -w
# Sunucu: http://localhost:4000
cd backend;  mix ecto.migrate;  mix phx.server
# Ön yüz: http://localhost:5173
cd frontend; npm run dev
# Masaüstü (önce ön yüzü Electron için derle)
cd frontend; npm run build:electron
cd desktop;  npm start          # kurulum dosyası için: npm run build:win
```

- **Testler:** Ön yüzde `cd frontend; npm test` (vitest, PowerShell'den çalıştır), `npx tsc -b`, `npm run lint`. Sunucuda `cd backend; mix precommit`.
- **Tarayıcıda uygulama:** `/` adresi oturum kapalıyken tanıtım sitesini gösterir. Uygulamayı görmek için giriş yapmak gerekir.

### Bugünkü ekranlar ve bileşenler (`frontend/src/components/`)

- **İskelet:** `Chat.tsx` (yaklaşık 1200 satır) üç sütunu kurar.
  - **Sunucu şeridi:** `ServerSidebar`. Uzun basınca dairesel hızlı geçiş menüsü açılır (`RadialServerSwitcher`).
  - **Kanal listesi:** Kategoriler, yazılı ve sesli kanallar.
  - **Sohbet:** `MessageItem`, `MessageContent`, `MessageReactions`, `LinkPreviewCard`, `FileAttachment`, `SearchBar`, `SearchResultsPanel`.
  - **Sağda üye listesi.**
- **Ses:**
  - **Kanal satırının altında açılan panel:** En fazla 8 kişilik yörünge (`VoiceOrbit`; konuşan avatar 1,2 kat büyür; kişi başına ses düzeyi), mikrofon / sağırlaştır / ayrıl düğmeleri (`VoiceStatusBar`), "Ekranı Paylaş" ve "Birlikte İzle" (`WatchPartyPanel`).
  - **Sol altta kalıcı çağrı çubuğu:** `VoiceStatusBar variant="fixed"`.
  - **Ayrı bir oda ekranı yok.** Ana alanda yazılı sohbet ya da ekran paylaşımları görünür.
- **Diğer ekranlar:**
  - **Kişiler:** `FriendsPanel` (arkadaşlar), `DMChatView` (özel mesajlar).
  - **Pencereler:** `Modal` tabanlı sunucu ve kanal oluşturma, davet, katılma, ayrılma, raporlama pencereleri.
  - **Ayarlar:** `ServerSettingsModal`; `UserSettingsModal` (Hesabım, Görünüm, Bildirimler, Ses & Görüntü, Gizlilik & Güvenlik, Klavye Kısayolları, Veri Yönetimi).
  - **Giriş ve hesap:** `Auth` ve `AuthShell` (giriş), `TwoFactorSettings`, `ActiveSessions`.
- **Ses & Görüntü ayarları bugün:** Mikrofon ve hoparlör seçimi var; hoparlör seçimi yalnızca `setSinkId` destekleyen tarayıcıda görünür. Mikrofon seviye göstergesi, bas-konuş tuşu ve gürültü bastırma ayarı **yok**.
- **Tema:** `frontend/src/index.css` içinde token'lar var.
  - **Renkler:** `--bg-*`, `--text-*`, `--accent`, `--success`, `--danger`, `--warning`, `--border`. Koyu tema `:root`'ta, açık tema `[data-theme="light"]`'ta; kontrastları WCAG AA'ya göre hesaplanmış.
  - **Tipografi ve boşluk:** `--font-size-*`, `--space-*` (4 px tabanlı).
  - **Eksik:** Köşe yuvarlaklığı, gölge, animasyon süresi ve ses durumu token'ları yok; bunlar bileşen CSS'lerine gömülü.
- **Masaüstü penceresi bugün:** `desktop/main.js` 1280×800 boyutunda, Windows'un standart çerçeveli penceresini açıyor. Özel başlık çubuğu ve sistem tepsisi **yok**.

### Bilinen sorunlar (yeni tasarımda çöz)

- **Bağlanırken geri bildirim yok:** "Bağlanıyor" durumu görünmüyor. `activeRoomId` ancak mikrofon alınıp katılım bitince ayarlanıyor.
- **Mikrofon izni:** Reddedilince yalnızca bir hata metni çıkıyor; nasıl düzeltileceği anlatılmıyor.
- **Yanlışlıkla ayrılma:** İçinde olduğun ses kanalına tekrar tıklamak seni odadan çıkarıyor (`Chat.tsx`, `handleVoiceRoomClick`).
- **Sessiz katılma yok.**
- **Ekran okuyucu:** Konuşma ve bağlantı durumları duyurulmuyor.

## 1. Araştırma

- **Toplanacak referanslar:** "desktop voice chat app", "voice channel", "community chat sidebar", "call controls", "audio settings" için gerçek uygulama ekranları.
- **Kaynaklar:**
  - **Lazyweb kurulmadı** (nedeni aşağıdaki "Araç durumu" bölümünde). Kullanıcı onaylarsa kurulur; yoksa Chrome ile Dribbble ve benzeri sitelerden toplanır.
  - discord.com ve Medium bu bilgisayardan açılmıyor. Discord Türkiye'de erişime kapalı.
- **Bulgular:** `docs/design-research.md` dosyasına yazılır: hangi kalıbı neden alıyoruz. Bu dosyada 20 Kasım'dan kalan bir ilk araştırma var; güncellenerek kullanılır.

## 2. Tasarım sistemi

- **Belirlenecekler:** ui-ux-pro-max ile:
  - renk paleti: koyu ve açık; koyu, bugünkü siyah ve gri tonlarda,
  - tipografi,
  - boşluk ölçeği,
  - köşe yuvarlaklığı,
  - gölge,
  - animasyon süreleri.
- **Token'lar:** Hepsi tek bir tema dosyasında toplanır: `frontend/src/index.css`'teki token'lar genişletilir. Bileşenlere sabit değer gömülmez.
- **Özet:** `docs/design-system.md` dosyasına yazılır.
- **BURADA DUR:** Planı kullanıcıya sun ve onay bekle.

## 3. Uygulama (frontend-design skill'i ile)

- **Ana pencere:** Solda sunucu çubuğu, kanal listesi (sesli kanallarda içerideki kişiler), ortada içerik, sağda üye listesi.
- **Sesli kanal ekranı (yeni):** Katılımcı kartları, konuşan kişide animasyonlu halka, sessiz ve sağır durum simgeleri.
- **Alt kontrol çubuğu:** Mikrofon, kulaklık, ekran paylaşımı, ayarlar, çıkış.
- **Kullanıcı paneli:** Avatar, durum, hızlı ses kontrolleri.
- **Ses ayarları:**
  - cihaz seçimi,
  - mikrofon seviye göstergesi (yeni; `AnalyserNode` ile),
  - bas-konuş tuşu (yeni; Electron'da genel kısayol gerekebilir).
- **Durumlar:** Bağlanıyor, yeniden bağlanıyor, bağlantı koptu, mikrofon izni yok, boş kanal.
- **Windows ayrıntıları (yalnızca Electron):**
  - **Başlık çubuğu:** Küçült / büyüt / kapat düğmeli özel başlık çubuğu. Tercihen `titleBarStyle: 'hidden'` ve `titleBarOverlay` ile; böylece Windows'un ekran düzeni (Snap) menüsü korunur.
  - **Pencere:** Yeniden boyutlandırma ve en küçük boyut.
  - **Sistem tepsisi:** Simge ve menü. Pencere kapatılınca tepsiye mi küçülecek, kullanıcıya sorulmalı.
  - **Değişecek dosya:** Bu ayrıntılar `desktop/main.js`'e ve bir `preload` betiğine dokunur.

## 4. Kontrol

- **Denetim:** web-design-guidelines ile denetle ve sorunları düzelt.
- **Ekran görüntüleri:** Playwright ile her ekranın 1280×720 ve 1920×1080 ekran görüntüsünü al, incele, sorunları düzelt. Görüntüleri `docs/screenshots/` klasörüne kaydet.
- **Telefon:** 390 px genişlikte de bak; aynı kod telefonda da çalışıyor.
- **Testler:** Her büyük adımdan sonra `npm test`, `npx tsc -b`, `npm run lint` ve `npm run build` çalıştır; Electron derlemesini aç.

## Kurallar

- **Kopyalama yok:** Referanslardaki marka adı, logo, simge ve birebir renkleri kopyalama; kalıpları uyarla.
- **Erişilebilirlik:**
  - kontrast,
  - klavyeyle gezinme,
  - ekran okuyucu etiketleri,
  - konuşma göstergesi yalnızca renge dayanmasın,
  - `prefers-reduced-motion` desteklensin.
- **İşlevsellik:** Mevcut işlevselliği bozma; her büyük adımdan sonra uygulamanın çalıştığını doğrula.
- **Çalışma biçimi (kullanıcı):** Adım adım ilerle, onaysız bir şey kurma. Metinler kısa ve sade olsun.
- **Bitince:** Neyi değiştirdiğini ve hangi referanstan ne aldığını özetle.

## Araç durumu (20 Kasım)

| Araç | Durum |
|---|---|
| frontend-design (Anthropic) | Zaten kuruluydu, 1.1.1 |
| ui-ux-pro-max | Kuruldu, 2.15.0. Kullanıcı düzeyinde; arama betiği Python 3.12.5 ile denendi |
| web-design-guidelines (Vercel) | Kuruldu. Kullanıcı düzeyinde: `~/.claude/skills/web-design-guidelines` |
| Playwright MCP | Kuruldu. Yalnızca bu proje için; bağlantı kontrol edildi |
| Lazyweb | **Kurulmadı.** Verilen eklenti komutu bu depoda çalışmıyor; resmî kurulum `curl \| bash` ile uzaktan betik çalıştırıyor. Paket ayrıca istemleri kaydedip dış bir sunucuya gönderebilen bir telemetri betiği taşıyor. Kullanıcı kararı bekleniyor |

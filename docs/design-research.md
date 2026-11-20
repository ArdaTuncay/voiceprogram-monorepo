# Uygulama tasarımı: referans araştırması

Son güncelleme: 20 Kasım 2026. Dal: `feat/uygulama-tasarim` (`feat/site-sayfalar` üzerine kurulu).

Bu belge, Zircle uygulamasının yeniden tasarımı için referansları, mevcut kodun durumunu ve seçilen kalıpları toplar. **Güncel olan bölüm 0'dır.** Bölüm 1–6 ilk turdan kalma; mevcut durum (bölüm 2) ve kapsam notları (bölüm 5) hâlâ geçerli, renk tabanlı A/B/C yönleri (bölüm 4) ise kullanıcı tarafından reddedildi.

## 0. İkinci tur: kaydedilen referanslar (20 Kasım)

**Kaynak:** Chrome ile Dribbble. Aramalar: "voice chat desktop app", "discord redesign", "voice channel ui", "teamspeak concept". Behance girişe yönlendirdiği için kullanılamadı; "teamspeak concept" Dribbble'da ilgili sonuç vermedi. Görseller `design-refs/`, linkler `design-refs/kaynaklar.md`.

**Güncelleme (20 Kasım, akşam):** Kullanıcı yön değiştirdi. Referanslar artık tasarım kaynağı değil; yalnız "kullanıcıların alıştığı temel işlevler" listesi için kullanılır (`docs/yonler/README.md`). Aşağıdaki tablo kayıt için duruyor.

**Renk kuralı:** Referansların renkleri alınmaz. Zircle siyah ve gri kalır; yalnız yerleşim ve kurgu alınır.

| Alan | Aldığımız kalıp | Referans | Neden |
|---|---|---|---|
| İskelet | Üç sütun kalır: sunucu şeridi, kanal listesi, içerik, sağda üyeler | `ana-pencere-klasik-uc-sutun-rotuslu` | Kullanıcı Discord ve TeamSpeak düzenini istiyor; alışkanlık bozulmaz |
| Panel biçimi | Sütunlar ayrı, yuvarlak köşeli paneller; aralarında boşluk | `ana-pencere-ayrik-yuvarlak-paneller`, `ana-pencere-sagda-uyeler-ve-dosyalar` | Tek renkte bile bölümler net ayrılır. **Kullanıcı kararı** (bkz. `design-system.md`) |
| Kanal listesi | Ses kanalının altında içerideki kişiler; her satırda mikrofon ve sağır simgesi | `ana-pencere-ses-kanali-altinda-kisiler`, `uye-listesi-ses-durumlari-kompakt` | Girmeden kimin orada olduğu görünür. Bugünkü önizleme sadeleşir |
| Kullanıcı paneli | Sol altta "Ses bağlı" kartı (oda adı, bağlantı durumu, ayrıl) ve altında avatar, ad, mikrofon, kulaklık, ayarlar | `ana-pencere-ses-kanali-altinda-kisiler`, `uye-listesi-ses-durumlari-kompakt` | Bugünkü sabit çağrı çubuğunun daha derli toplu hâli |
| Ses odası ekranı (yeni) | Ses kanalına girince ana alanda katılımcı kartları; konuşanın kartında halka | `ses-odasi-konusanlar-kart-dinleyenler-izgara` | Bugün ayrı bir oda ekranı yok. Rol ayrımı olmadığı için "konuşan / dinleyen" ayrımı yerine herkes eşit kart |
| Kalabalık oda | 9 kişiden sonra kartlar küçülür, ızgara sıklaşır | `ses-odasi-konusanlar-kart-dinleyenler-izgara` (alt ızgara) | Bugünkü 8 kişilik yörünge sınırı kalkar |
| Ekran paylaşımı | Paylaşımlar odada büyük kart; birden fazlaysa yan yana | `ses-odasi-yayinlar-yan-yana` | Ekran paylaşımı ve Birlikte İzle oda ekranının içine girer |
| Kontrol çubuğu | Oda ekranında altta ortada yüzen hap: mikrofon, kulaklık, ekran paylaş, ayarlar, ayrıl | `ses-odasi-konusanlar-kart-dinleyenler-izgara`, `ses-kontrol-hapi-sohbetin-icinde` | Kontroller içerikle birlikte görünür, ekranın kenarına sıkışmaz |
| Odadan çıkınca | Yazılı kanala geçince oda küçülür; kullanıcı panelindeki "Ses bağlı" kartı kalır, tıklayınca odaya döner | `aktif-oda-yuzen-hap-oda-kartlari`, `ses-kontrol-hapi-sohbetin-icinde` | Sesten çıkmadan gezinilir; aktif kanala tekrar tıklamak artık ayrılmaz |
| Ses daveti | Hazır yanıtlar: "Kanala katıl", "2 dakika", "Meşgulüm" | `uye-listesi-ses-durumlari-kompakt` | Sonraki tur; bu turda kapsam dışı |
| Sağ panel | Üyeler rollerine göre gruplu; altında paylaşılan dosyalar | `ana-pencere-klasik-uc-sutun-rotuslu`, `ana-pencere-sagda-uyeler-ve-dosyalar` | Dosyalar bölümü sonraki tur; gruplama bu turda |

**Almadığımız:** Vision Pro'daki cam efekti ve arka plan fotoğrafları, Twitch tarzı yayın keşfi, mekânsal oda haritası (Teamflow), oda keşfi sayfası (Clubhouse). Zircle sunucu tabanlı ve tek renkli.

**Bilinen sorunların karşılığı:**

| Sorun | Çözüm |
|---|---|
| Bağlanıyor durumu yok | Kanala tıklayınca hemen oda ekranı açılır: iskelet kartlar ve "Bağlanıyor…" |
| Mikrofon izni | Oda ekranında kart: neden, nasıl açılır (tarayıcı ve Windows için ayrı), "Dinleyici olarak devam et" |
| Yanlışlıkla ayrılma | Aktif kanala tıklamak oda ekranını açar; ayrılmak yalnız "Ayrıl" düğmesiyle |
| Sessiz katılma | Kanal satırında sağ tık menüsü ve Shift + tıklama |
| Ekran okuyucu | Katılma, ayrılma ve bağlantı durumları `aria-live="polite"` ile duyurulur; konuşma duyurulmaz |

## 1. Referanslara erişim

| Referans | Sonuç |
|---|---|
| `design-refs/` klasörü | İlk turda yoktu. İkinci turda eklendi (bkz. bölüm 0). |
| Dribbble: Voice Chat App (Purrweb) | Chrome'da açıldı, görseller incelendi. |
| Dribbble: Mollo.io voice chat controls | **Kaldırılmış.** Dribbble 404 veriyor. |
| Dribbble: Redefining Social Audio Experiences | Chrome'da açıldı, görseller ve açıklama incelendi. |
| Clubhouse oda deneyimi vaka çalışması (Medium) | **Okunamadı.** Doğrudan istek 403 aldı, Chrome uzantısının da bu alan adına izni yok. Metni yapıştırırsan eklerim. |
| Discord blog: mobil deneyim | **Okunamadı.** discord.com bu ağda açılmıyor (Discord Türkiye'de erişime kapalı). |

Aşağıda Clubhouse ve Discord için yazılanlar, makalelerden değil, bu ürünlerin bilinen arayüz kalıplarından geliyor. Makalelerdeki araştırma bulguları okunmadığı için onlara dayanan bir iddia yok.

## 2. Mevcut durum (kod)

**Platform:** React 19 + Vite + TypeScript (düz CSS, bileşen başına `.css`), Electron masaüstü sarmalayıcısı, Phoenix sunucusu. Ses: tarayıcı WebRTC'si, eşler arası bağlantı (`hooks/useVoiceChannel.ts`), TURN için Metered. Hedef ekranlar: masaüstü (asıl), tarayıcı ve telefon tarayıcısı (tek kırılma noktası: 768 px).

**Tema:** `src/index.css` içinde token sistemi zaten var. Koyu tema `:root`'ta, açık tema `[data-theme="light"]`'ta. Renkler (`--bg-*`, `--text-*`, `--accent`, `--success`, `--danger`, `--warning`, `--border`), tipografi (`--font-sans` Inter, `--font-size-xs…xl`), boşluk ölçüsü (`--space-1…10`, 4 px tabanlı) ve geçiş süresi tanımlı. Açık temadaki renklerin kontrastı WCAG AA'ya göre hesaplanmış. **Eksik:** köşe yuvarlaklığı, gölge ve ses durumu (konuşuyor, bağlanıyor vb.) için token yok; bunlar bileşen CSS'lerine sabit değer olarak gömülü. Tanıtım sitesi (`site/site.css`) aynı nötr paleti `--site-*` adlarıyla tekrar tanımlıyor.

**Yerleşim:** Discord'a benzer üç sütun: sunucu şeridi (`RadialServerSwitcher`, `ServerSidebar`), kanal listesi, sohbet ve sağda üye listesi (`Chat.tsx`, 1200 satır).

**Ses arayüzü bugün:**
- **Ayrı bir oda ekranı yok.** Ses kanalına tıklayınca kanal listesinde satırın altı açılıyor. Orada en fazla 8 kişilik bir yörünge (`VoiceOrbit`, 8'i aşınca dikey liste), mikrofon / sağırlaştır / ayrıl düğmeleri (`VoiceStatusBar`), "Ekranı Paylaş" ve "Birlikte İzle" var. Ana alan yazılı sohbeti ya da ekran paylaşımlarını göstermeye devam ediyor.
- **Aktif çağrı çubuğu zaten var:** `VoiceStatusBar variant="fixed"`, sol altta oda ve sunucu adıyla. Başka sunucuya ya da özel mesajlara geçince de görünüyor.
- **Katılmadan önizleme var:** Girmediğin bir ses kanalında içeridekilerin avatarı ve adı listeleniyor (`voice_occupants`). Konuşan kişi sayısı yok; sunucu bu bilgiyi göndermiyor.
- **Konuşma göstergesi:** Konuşan avatar 1,2 kat büyüyor. Yalnızca renge dayanmıyor, bu iyi.
- **Kişi başına ses düzeyi:** Avatara tıklayınca açılan kaydırıcı.

**Durumların karşılığı:**

| Durum | Bugün |
|---|---|
| Bağlanıyor | **Görünmüyor.** `activeRoomId` mikrofon alınıp katılım bitince ayarlanıyor; o arada arayüz hiçbir şey göstermiyor. |
| Yeniden bağlanıyor | Kişi başına var (`reconnectingPeerIds`, avatarda `reconnecting` sınıfı). Sohbet bağlantısı için ayrı bir `reconnect-banner` var. |
| Bağlantı koptu | Metin hatası: "Ses bağlantısı koptu. Lütfen kanala yeniden katılın." |
| Mikrofon izni reddedildi | Metin hatası (`microphoneErrorMessage`). Nasıl düzeltileceğini anlatan bir yol yok. |
| Boş oda | Ayrı bir görünüm yok. |
| Tek kişilik oda | Ayrı bir görünüm yok. |

**Dikkat çeken sorunlar:**
- **Yanlışlıkla ayrılma riski:** Aktif ses kanalına tekrar tıklamak odadan çıkarıyor (`handleVoiceRoomClick`).
- **Ekran okuyucu:** Konuşma ve bağlantı durumları ekran okuyucuya duyurulmuyor. Yalnızca iki banner'da `role="status"` var.
- **Dokunma alanları:** Kontrol düğmelerinin simgeleri 16 px. Düğmelerin kendisi de telefonda dokunmak için küçük.

## 3. Referanslardan çıkan kalıplar

### R1. Dribbble: Voice Chat App (Purrweb)
Koyu bir yüzey (`#3C3C5D`), tek bir canlı vurgu rengi (mor `#7000FF`), beyaz; yazı tipi Jost.
- **Oda ekranı:** Üstte büyük oda adı ve küçük bir "Live" etiketi. Ortada şu an konuşan kişinin büyük avatarı ve etrafında **eş merkezli, yumuşak halkalar**. Altında oda içi yazılı mesaj akışı. En altta katılımcı şeridi; her avatarın köşesinde mikrofon durumu rozeti var.
- **Kontroller:** Üç yuvarlak düğme: sohbet, mikrofon ve el kaldır. Mikrofon ortada, daha büyük ve beyaz dolgulu, yani birincil eylem öne çıkıyor.
- **Oda oluşturma:** Ad, kategori etiketleri, tarih ve saat, davet edilenler (üst üste binen avatarlar ve "+2"), "Özel konferans" kutusu, tam genişlikte "Başlat" düğmesi.

**Zircle'a uyanlar:**
- **Konuşanın etrafında halka:** Zircle'ın çember kimliğiyle ve sitedeki halkalarla doğrudan örtüşüyor.
- **Birincil düğmeyi büyütmek:** Mikrofon diğer düğmelerden büyük olabilir.
- **Avatar rozetleri:** Avatar köşesinde mikrofon ve sağırlaştırma rozeti, durumu renk olmadan da gösteriyor.

**Uymayanlar:**
- **Tek konuşmacının sahnede olması:** Zircle'da herkes aynı anda konuşabiliyor, sahne yok.
- **El kaldırma:** Moderasyonlu sahne modeli olmadığı için anlamsız.
- **Doygun mor gradyan:** Uygulamanın tek renkli kimliğinden uzak, ama B yönü için ilham olabilir (bkz. 4).

### R2. Dribbble: Mollo.io voice chat controls
Kaldırılmış; incelenemedi.

### R3. Dribbble: Redefining Social Audio Experiences
Açık tema: lavanta zemin (`#E4E3F2`, `#BEB9D1`), çivit vurgu (`#4337EE`), sıcak kahve tonları. Büyük köşe yuvarlaklıkları, beyaz kartlar, yumuşak gölgeler.
- **Oda listesi kartları:** Konu etiketi, oda başlığı, konuşmacı adları (yanlarında mikrofon simgesi), üst üste binen avatarlar ve "42+", alt satırda dinleyici ve konuşmacı sayısı, sağda "Join Room →" düğmesi.
- **Oda içi:** 3 sütunlu avatar ızgarası, ad etiketleri ve köşede mikrofon rozeti. Konuşan kişide ince bir halka.
- **Alt çubuk:** Solda "Leave Rooms" (hapı biçiminde, ok simgeli), sağda küçük daire düğmeler (davet et, el kaldır).
- **Alt sekmeler:** Canlı odalar, oda oluştur, yaklaşan.

**Zircle'a uyanlar:**
- **Bilgili ses kanalı satırları:** "İçinde kim var, kaç kişi" bilgisini kanal listesinde göstermek. Bugünkü önizlemenin daha derli toplu hâli.
- **Izgara görünümü:** 8 kişiyi aşınca yörüngeye geçmek yerine kullanılabilir.
- **Ayrılma düğmesi:** Yalnız bir simge değil, metni olan bir düğme.
- **Açık tema için palet ilhamı.**

**Uymayanlar:**
- **Dinleyici ve konuşmacı sayısı ayrımı:** Zircle'da böyle bir rol ayrımı yok.
- **Keşif ve öneri akışı:** Zircle sunucu tabanlı, herkese açık oda keşfi yok.

### R4. Clubhouse (bilinen kalıplar; makale okunamadı)
- **Sahne ve dinleyiciler:** Konuşmacılar sahnede, takip edilenler ve diğer dinleyiciler ayrı gruplarda.
- **Sessizce ayrıl:** Odadan çıkış düğmesi.
- **Küçültülmüş oda çubuğu:** Odadan çıkmadan uygulamada gezinirken altta kalan çubuk.
- **Girişte mikrofon kapalı:** Dinleyici olarak girersin, konuşmak için el kaldırırsın.

**Zircle'a uyanlar:**
- **Küçültülmüş çubuk:** Zaten var (`VoiceStatusBar fixed`); görünümü ve bilgisi zenginleştirilebilir.
- **"Sessiz katıl":** İstenen akışla birebir örtüşüyor.

**Uymayanlar:** Sahne ve dinleyici ayrımı. Sunucu tarafında rol yok, eklemek ürün değişikliği olur (bkz. 5).

### R5. Discord (bilinen kalıplar; blog yazısı okunamadı)
- **Kanal listesi:** Ses kanalında içerideki kişiler satırın altında, konuşan kişide yeşil halka.
- **Ses paneli:** Altta kalıcı bir panel; bağlantı kalitesi, oda adı, bağlantıyı kes, mikrofon ve kulaklık düğmeleri.
- **Mobil:** Ses kanalına girince tam ekran bir oda görünümü açılıyor. Burada katılımcı ızgarası ve altta büyük kontrol düğmeleri var; aşağı kaydırınca küçülüp çubuğa dönüşüyor.

**Zircle'a uyanlar:** Zircle'ın yerleşimi zaten bu modele yakın. Eksik parça şu: **ses kanalına girince ana alanda bir oda görünümü** (ızgara, büyük kontroller), kanal listesinde yalnız kısa bir özet. Telefonda bu görünüm tam ekran açılır ve aşağı kaydırınca küçültülmüş çubuğa iner.

## 4. Önerilen tasarım yönleri (ilk tur; reddedildi)

Ortak yapı (her yönde aynı, yalnızca görünüm değişir):

1. **Ses kanalı satırı:** Ad, içeridekilerin ilk 3–4 avatarı, üst üste binen avatarlar ve "+n", kişi sayısı. Konuşan biri varsa satırda hareketli küçük bir dalga simgesi. Konuşan sayısı istemcide, `voice_occupants` ile birleştirilerek yalnızca içindeyken hesaplanabilir. Odada değilken bu sayı için sunucunun konuşma durumunu yayınlaması gerekir; bu bir sunucu değişikliği (bkz. 5).
2. **Oda görünümü (ana alanda, yeni):**
   - **Katılımcı ızgarası:** Duyarlı, 1–4 sütun.
   - **Konuşan kişi:** Avatarın etrafında hareketli halkalar ve "konuşuyor" etiketi ya da simgesi; halkalar yalnızca renge dayanmıyor.
   - **Durum rozetleri:** Avatar köşesinde mikrofon kapalı ve sağır rozetleri.
   - **Ek alanlar:** Ekran paylaşımı ve Birlikte İzle bu görünümün içinde. Odanın yazılı sohbeti yan panelde ya da sekmede.
3. **Alt kontrol çubuğu:** Mikrofon (en büyük), sağırlaştır, ses çıkışı (hoparlör ya da kulaklık seçimi, `setSinkId` destekleyen tarayıcılarda), ekran paylaş, ayrıl (kırmızı ve metinli). Dokunma alanları en az 44×44 px, birincil düğme 56 px.
4. **Aktif çağrı çubuğu:** Mevcut sabit çubuğun yeni hâli: oda adı, canlı konuşan kişinin küçük avatarı, bağlantı durumu noktası ve metni, mikrofon ve ayrıl düğmeleri. Tıklayınca oda görünümüne döner.
5. **Katılma akışı:** Kanala tek tıkla katılınca, son kullanılan ayarla girilir. Yanında "Sessiz katıl" seçeneği: satırdaki küçük bir menüde ya da Shift ile tıklayarak. Aktif kanala tekrar tıklamak artık **ayrılmaz**, oda görünümünü açar.
6. **Durumlar:**
   - **Bağlanıyor:** İskelet ızgara ve "Bağlanıyor…".
   - **Yeniden bağlanıyor:** Sarı şerit ve kişi başına dönen simge.
   - **Bağlantı koptu:** Hata kartı ve "Yeniden katıl" düğmesi.
   - **Mikrofon izni reddedildi:** Tarayıcıya ya da Windows'a göre adım adım düzeltme yönergesi; "Dinleyici olarak devam et" seçeneği.
   - **Boş oda:** "Burada henüz kimse yok" ve "Katıl" düğmesi.
   - **Tek kişilik oda:** "Odada yalnızsın" ve "Davet bağlantısı kopyala".
7. **Erişilebilirlik:**
   - **Duyurular:** `aria-live="polite"` ile "X konuşmaya başladı" türü değil, yalnızca katılma, ayrılma ve bağlantı durumları (konuşma duyuruları ekran okuyucuyu boğar).
   - **Etiketler:** Her düğmede `aria-pressed` ve durumu söyleyen etiket.
   - **Hareket:** Konuşma halkası `prefers-reduced-motion` açıkken durağan kalın bir çerçeveye dönüşür.
   - **Kontrast:** Tüm metinler AA (4,5:1), simgeler ve kenarlıklar 3:1.

### Yön A: "A2 · Tek renk" (sitenin görünümü)
- **Palet:** Mevcut nötr ölçek aynen. Vurgu yine en açık nötr (`#f5f5f5`). Tek renkli istisna konuşma için yeşil (`--success #5c9a72`, sitedeki `--site-speaking` ile aynı).
- **Biçim:** Konuşma göstergesi sitedeki gibi ince eş merkezli halkalar. Yörünge fikri oda görünümünde büyük ölçekte sürüyor (8 kişiye kadar çember dizilimi, fazlası ızgara).
- **Tipografi:** Inter. Başlıklar için sıkı harf aralığı (−0,02 em), sitedekiyle aynı.
- **Ölçüler:** 4 px tabanlı boşluk aynen. Köşeler: küçük 6, orta 10, büyük 16, hap 999. Gölge yok, ayrım ince çizgiyle.
- **Neden:** Site ile uygulama tek ürün gibi görünür; en az risk. Mevcut token'lar korunur.

### Yön B: "Gece moru" (R1'den, maskot renkleriyle)
- **Palet:** Koyu, hafif mor tonlu yüzeyler (`#14121c`, `#1c1928`, `#262236`). Vurgu maskotun moru (`#8D87CE`; metin için açık tonu `#b4afe6`). Konuşma halkası morun parlak tonu ve yumuşak ışıma.
- **Tipografi:** Gövde Inter. Oda ve sunucu adları için daha yuvarlak bir başlık yazı tipi (ör. Jost ya da Manrope; yerel olarak paketlenir, CSP'ye dokunmaz).
- **Ölçüler:** Köşeler daha yuvarlak (10, 14, 22). Birincil mikrofon düğmesi dolgulu ve büyük.
- **Neden:** Daha sıcak ve "sosyal" bir his; maskotla bağ kurar. Riski: Site A2 tek renkli kalırsa ikisi arasında fark oluşur.

### Yön C: "Açık lavanta" (R3'ten)
- **Palet:** Açık tema öncelikli: lavanta zemin (`#eeedf6`), beyaz kartlar, çivit vurgu (`#4337ee`), koyu metin (`#1d1a2b`). Koyu karşılığı da token'larla tanımlanır.
- **Biçim:** Kart temelli yerleşim, yumuşak gölgeler, büyük köşeler (12, 16, 24). Oda görünümünde 3–4 sütunlu ızgara ve sade ince halka.
- **Neden:** Ferah ve samimi, gündüz kullanımına uygun. Riski: Bugünkü koyu ve tek renkli kimlikten en uzak yön.

**Ortak teknik karar (yön ne olursa olsun):**
- **Token'lar:** Bütün renkler ve ölçüler `index.css`'teki tek token dosyasında toplanır. Eklenecekler: `--radius-*`, `--shadow-*`, `--voice-speaking`, `--voice-connecting`, `--voice-reconnecting`, `--control-size-*`.
- **Sabit değerler:** Bileşenlerdeki gömülü değerler token'a taşınır.
- **Tema:** Koyu ve açık tema ikisi de tanımlanır.

## 5. Kapsam dışı ya da karar gereken noktalar

- **Konuşmacı ve dinleyici ayrımı:** Sunucu tarafında rol, el kaldırma ve moderasyon gerektirir; bugünkü "herkes konuşabilir" modelini değiştirir. Önerim: Bu turda yapılmasın. "Konuşuyor / mikrofonu açık / sessiz / sağır" gruplaması bu ihtiyacı görsel olarak karşılar.
- **Odaya girmeden konuşan sayısı:** Sunucunun konuşma durumunu kanal üyesi olmayanlara yayınlaması gerekir (yeni olay ve trafik). Önerim: Önce yalnız "kaç kişi var" bilgisi gösterilsin, konuşan sayısı oda içinde gösterilsin.
- **Hoparlör ya da kulaklık seçimi:** Tarayıcıda çıkış aygıtı seçimi (`setSinkId`) Chromium ve Electron'da var, Safari'de yok. Desteklenmeyen yerde düğme gizlenir.
- **"Bütün uygulama" kapsamı:** Ses dışındaki ekranlar (sohbet, ayarlar, pencereler, giriş) seçilen yönün token'larıyla yenilenir. Bu belge ses deneyimine odaklanıyor, çünkü verilen görev ve referanslar onu hedefliyor.

## 6. Önerilen iş sırası

1. **Tasarım tuvali:** A, B ve C için aynı dört kare: kanal listesi ve aktif çağrı çubuğu, oda görünümü (4 kişi, biri konuşuyor), durumlar (bağlanıyor, izin reddedildi, boş oda), telefon görünümü. Hepsi koyu ve açık temada. Kullanıcı seçer.
2. **Token'lar:** Seçilen yönün token'ları `index.css`'e yazılır; mevcut bileşenler gömülü değerlerden arındırılır. Derleme ve testler çalıştırılır.
3. **Ses arayüzü:**
   - oda görünümü ve kontrol çubuğu,
   - kanal satırı ve aktif çağrı çubuğu,
   - katılma akışı ("Sessiz katıl", tekrar tıklayınca ayrılmama),
   - durumlar ve erişilebilirlik.

   Her adımdan sonra tip kontrolü, testler ve derleme çalıştırılır.
4. **Kalan ekranlar:** Sohbet, ayarlar, pencereler ve giriş yeni token'larla güncellenir.
5. **Özet:** Neyin değiştiği ve hangi fikrin hangi referanstan alındığı yazılır.

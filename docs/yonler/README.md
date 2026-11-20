# Zircle için iki özgün yön

20 Kasım 2026. **Durum: reddedildi (20 Kasım).** Kullanıcı ikisini de beğenmedi; yerine kendi gönderdiği konsept seçildi (bkz. `docs/ornek-tasarim/`).

Taslakları tarayıcıda aç: `yon-1-seritler.html` ve `yon-2-agirlik.html`. Dalgalar ve sesler sahte veriyle oynar. Yazı tipi Inter, bu klasördeki `fonts/` içinden yüklenir.

**Ortak kurallar:** Siyah ve gri renkler ile onaylı token'lar (`docs/design-system.md`) geçerli. Renk yalnız anlam taşır: konuşuyor (yeşil), mikrofon kapalı ve ayrıl (kırmızı). İki yön de Discord ya da TeamSpeak'e benzememek için simgeli sunucu şeridini, avatar kartlarını ve yeşil konuşma halkasını kullanmaz.

## Kullanıcıların alıştığı temel işlevler

`design-refs/` artık tasarım kaynağı değil. Yalnız bu listeyi çıkarmak için kullanıldı. İki yön de hepsini karşılar.

1. Ses bağlıyken her ekranda görünen bir durum: hangi oda, bağlantı iyi mi.
2. Tek tıkla mikrofon ve kulaklık (sağırlaştırma); her zaman aynı yerde.
3. Ayrı ve belirgin bir "Ayrıl" düğmesi.
4. Kimin konuştuğu, anında.
5. Kişi başına durum: mikrofon kapalı, sağır, ekran paylaşıyor.
6. Girmeden bir ses kanalında kimlerin olduğu.
7. Ekran paylaşma ve paylaşılanı izleme.
8. Ses ayarlarına hızlı erişim; mikrofonun çalıştığını görmek.
9. Sunucu ve kanal değiştirme, yazılı sohbet: hepsi aynı pencerede.
10. Kendi adın ve durumun.
11. Odadayken yazışabilmek.

## Yön 1: Şeritler

Ses zamana yayılır. Odadaki her kişi yatay bir şerit; sesi son bir dakikanın dalgası olarak sağdan sola akar. Kim konuşuyor, kim az önce konuştu, kim hiç konuşmadı: bir bakışta görünür.

```
┌ zircle  Oyun Gecesi ───────────────────────────────── — □ ✕ ┐
│ ⌄ Oyun Gecesi  ılılı │ Akşam muhabbeti   4 kişi   Oda Yazılar │
│   # genel            │ Ece    ▁▂▅█▆▃▁   ▂▅▇▅▂     ▃▆█▇▅ ●   │
│   🔈 Akşam muh. ▂▅▃  │ Mert   ▁    ▃▇█▆▃     [ekran]         │
│     Ece, Mert, sen   │ Deniz  - - - - mikrofon kapalı - - -  │
│   🔈 Ranked ▁▁▂      │ Arda   ▁         ▃▅▃      ▂▄▂         │
│ › Kod Kulübü   ▁▁    │        1 dk önce     30 sn     şimdi  │
│                      │ Ece 21.42  B sitesine iki kişi gelin  │
│ Arda  ████░░ sessiz  │ Bağlı   ( 🎤 ) 🎧 🖥 ⚙       [Ayrıl] │
└──────────────────────┴────────────────────────────────────────┘
```

- **Sol:** Sunucular simge değil, ağaç. Her sunucunun ve ses kanalının yanında küçük bir etkinlik çizgisi var: girmeden nerede konuşulduğunu görürsün.
- **Sol alt:** Kendi mikrofon seviyen hep görünür. "Mikrofonum çalışıyor mu" sorusu ayara girmeden çözülür.
- **Oda:** Ekran paylaşımı, paylaşanın şeridinde küçük bir görüntü; tıklayınca büyür. Odada yazılanlar şeritlerin altında, aynı zaman çizgisinde.
- **Kalabalık oda:** 8 kişiden sonra şeritler incelir, 20'den sonra liste kayar.
- **Telefon:** Ağaç gizlenir; şeritler tam genişlik, ad sütunu daralır.
- **Güçlü yanı:** "Az önce kim konuştu" bilgisini veren tek yön. Ses uygulaması olduğu ilk bakışta belli.
- **Riski:** Çizim yükü (şerit başına saniyede 4 kare, `canvas`). Odada değilken kanalların etkinlik çizgisi sunucu değişikliği ister: sunucunun konuşma etkinliğini yayınlaması gerekir. Bu yapılmazsa çizgi yalnız içinde olduğun odada canlı olur.

## Yön 2: Ağırlık

Ses, yazıya ağırlık verir. Odadakiler büyük isimler olarak yazılır. Biri konuştukça adı kalınlaşır ve parlar, susunca incelir. Inter'in değişken kalınlık ekseni sesin düzeyini izler. Mikrofonu kapalı olanın adı içi boş çizgiyle yazılır.

```
┌ zircle ───────────────────────────────────────────────── — □ ✕ ┐
│ Oyun Gecesi ⌄   │ Akşam muhabbeti  4 kişi │ Odada yazılanlar  │
│                 │                         │                   │
│ genel           │ ▌ Ece        Konuşuyor  │                   │
│ klipler         │ ▏ Mert       Ekran [İzle]│ Ece 21.42         │
│ Akşam muhabbeti │ ▏ Deniz°     Mikrofon kapalı              │
│  Ece, Mert, sen │ ▏ Arda       Sen        │ Mert 21.43        │
│ Ranked          │                         │                   │
│  Kaan, Selin    │ ( Bağlı  🎤 🎧 🖥 ⚙  Ayrıl ) │ [odaya yaz]     │
│ Arda  (sen)     │                         │                   │
└─────────────────┴─────────────────────────┴───────────────────┘
```

(° içi boş çizgiyle yazılmış ad)

- **Aynı dil her yerde:** Kanal listesinde, ses kanalının altındaki adlardan konuşanınki kalın. Sol altta kendi adın mikrofonunla birlikte kalınlaşır; ayrıca mikrofon göstergesi gerekmez.
- **Konuşma göstergesi yalnız kalınlığa dayanmaz:** Adın solunda sesin düzeyini gösteren dikey çubuk (konuşurken yeşil) ve "Konuşuyor" yazısı da var.
- **Sol:** Sunucu, başlıktaki açılır menüden seçilir. Liste tamamen yazı, simge yok.
- **Kalabalık oda:** 8 kişiden sonra isimler yarı boyuta iner ve iki sütuna geçer.
- **Telefon:** Yazılar paneli bir sekmeye, kanal listesi bir menüye geçer. İsimler tam genişlik.
- **Güçlü yanı:** Çok sade ve sakin; tek bir fikir her yerde tekrar eder. Kurması kolay (CSS kalınlığı; Inter zaten pakette).
- **Riski:** Avatarlar ses odasında yok, yalnız üye listesi ve profillerde görünür. Uzun adlar kısaltılır. Odada değilken konuşanı göstermek Yön 1'deki aynı sunucu değişikliğini ister.

## Seçimden sonra

1. Seçilen yönün token'ları `index.css`'e eklenir (onaylı sistem; yön için gerekenler ayrıca yazılır).
2. Önce iskelet ve ses odası, sonra kanal listesi ve kullanıcı paneli, en son durumlar (bağlanıyor, izin yok, boş oda) ve Windows ayrıntıları.
3. Her büyük adımdan sonra testler, tip kontrolü, derleme ve ekran görüntüleri.

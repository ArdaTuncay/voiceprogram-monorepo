# Ana pencere örneği

20 Kasım 2026. **Durum: onaylandı ve uygulandı (20 Kasım).** Gerçek uygulamanın ekran görüntüleri: `docs/screenshots/uygulama-*.png`. Örnekten farklar: paylaşılan medya düğmesi eklenmedi (özelliği yok); arama "Ara" hapı, tıklayınca açılan bir kutu (eski işleyiş korundu); DM kartlarında son mesaj yerine çevrimiçi durumu.

Kullanıcının gönderdiği konsepte göre (`design-refs/ana-pencere-ayrik-yuvarlak-paneller.png`) hazırlandı. İşleyiş bugünkü uygulamayla aynı; yalnız görünüm değişiyor.

- **Görseller:** `1-sunucu.png`, `2-tum-uyeler.png`, `3-arkadaslar.png`, `4-profil-menusu.png` (1440×900, 2x).
- **Canlı örnek:** `ana-pencere.html`. Arkadaşlar düğmesi, üye listesi oku, üye paneli düğmesi ve profil menüsü tıklanabilir.

## Renk (kullanıcı kararı, 20 Kasım)

- **Tek ton:** Zemin ile paneller aynı gri (`#171717`). Siyah yok; panelleri ince bir kenar çizgisi ayırır. Kartlar bir ton açık (`#1f1f1f`), daireler `#262626`.
- **Yeşil vurgu:** `#d9f99d`. Logo, seçili sunucu ve kanal, ekleme düğmesi, çevrimiçi noktası, konuşma halkası, "Ses bağlı", açık mikrofon, gönder, bahsetme, rozetler.
- **Kırmızı** yalnız mikrofon kapalı ve kanaldan ayrılma için.

## Bugünkü uygulamadaki karşılıkları

| Örnekte | Bugün |
|---|---|
| Sol şerit: logo, Direkt Mesajlar, Arkadaşlar, sunucular, + | `ServerSidebar` (aynı düğmeler, aynı işleyiş) |
| Sunucu başlık kartı: davet, sunucu ayarları | Kanal listesinin üstündeki `server-header` |
| Paylaşılan medya düğmesi | **Yeni.** Sağdaki "Dosyalar" yerine sunucu tarafında ayrı tutulacak; içeriği sonra yapılacak |
| Kanal kartları, kategoriler | Kanal listesi (kategori açma kapama, okunmamış noktası) |
| Ses kanalı kartı ve içindekiler | `VoiceOrbit` ve `voice_occupants` önizlemesi (liste olarak) |
| Sol alttaki "Ses bağlı" kartı | `VoiceStatusBar` (her görünümde erişilebilir) ve kanal altındaki ekran paylaş, Birlikte İzle düğmeleri |
| Üst sağ: ara, üyeler, bildirimler, ayarlar, profil | Arama düğmesi, `UserSettingsModal`; çıkış profil menüsüne taşındı (bugün sol üstteki kullanıcı panelinde) |
| Bildirim rozeti | Bekleyen arkadaşlık istekleri (tıklayınca Arkadaşlar > Bekleyen istekler) |
| Sağda üyeler kartı | Bugün yalnız çevrimiçi üyeler. Ok ile tüm üyeler rollerine göre açılır (`GET /servers/:id/members` zaten var) |
| Arkadaşlar görünümü, solda DM kartları | `FriendsPanel` ve DM listesi |

**Not:** Görseldeki gibi DM kartlarında son mesaj önizlemesi için sunucunun bu bilgiyi göndermesi gerekir; şu an yok. Örnekte yerine çevrimiçi durumu yazıyor.

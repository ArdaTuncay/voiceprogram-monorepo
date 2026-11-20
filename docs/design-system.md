# Tasarım sistemi (öneri)

20 Kasım 2026. Dal: `feat/uygulama-tasarim`. **Durum: uygulandı (20 Kasım).** Token'lar `frontend/src/index.css`'te. Renk sonradan değişti: siyah yok, tek gri ton, vurgu yeşil `#d9f99d` (açık temada `#a3e635`, yazı için `#3f6212`); bkz. `docs/ornek-tasarim/README.md`. Aşağıdaki "Senin kararın gereken noktalar" bölümü geçersiz: kullanıcı referanslardan yerleşim almak yerine özgün bir yön istedi (bkz. `docs/yonler/`).

Kaynaklar: `docs/design-research.md` (bölüm 0), `design-refs/`, ui-ux-pro-max araması.

## Yön

- **Biçim:** Sade ve işlevsel (ui-ux-pro-max: "Minimalism & Swiss Style"). Tek yazı tipi, net hiyerarşi, az ve anlamlı hareket.
- **Renk:** Bugünkü siyah ve gri ölçek aynen kalır. Renk yalnız anlam taşır: konuşuyor (yeşil), uyarı (sarı), hata ve ayrıl (kırmızı).
- **ui-ux-pro-max'ten almadıklarımız:** Önerdiği mor ve pembe palet (renk kararıyla çelişiyor), Russo One ve Chakra Petch yazı tipleri (oyun teması fazla; ayrıca Google Fonts bağlantısı CSP'ye takılır), tanıtım sayfası kalıbı (bu bir uygulama ekranı).

## Token'lar

Hepsi `frontend/src/index.css` içine eklenir. Mevcut token'lar korunur; adları değişmez.

### Renk (yeni)

| Token | Koyu | Açık | Kullanım |
|---|---|---|---|
| `--bg-elevated` | `#2e2e2e` | `#ffffff` | Oda kartları, yüzen kontrol hapı, menüler |
| `--bg-hover` | `rgba(255,255,255,.06)` | `rgba(0,0,0,.05)` | Satır üzerine gelince |
| `--bg-selected` | `rgba(255,255,255,.10)` | `rgba(0,0,0,.08)` | Seçili kanal, basılı düğme |
| `--border-strong` | `rgba(255,255,255,.14)` | `rgba(0,0,0,.14)` | Panel ve kart kenarı |
| `--voice-speaking` | `var(--success)` | `var(--success)` | Konuşma halkası |
| `--voice-connecting` | `var(--text-muted)` | `var(--text-muted)` | Bağlanıyor |
| `--voice-reconnecting` | `var(--warning)` | `var(--warning)` | Yeniden bağlanıyor |
| `--voice-off` | `var(--danger)` | `var(--danger)` | Mikrofon kapalı, sağır, bağlantı koptu |

**Kontrast** (WCAG; metin 4,5:1, simge ve çizgi 3:1):

- `--text-normal` `--bg-elevated` üstünde: 10,8:1. `--text-muted`: 5,4:1.
- Konuşma yeşili (koyu): `--bg-primary` üstünde 5,4:1, `--bg-elevated` üstünde 4,1:1.
- Kırmızı (koyu) `--bg-elevated` üstünde: 3,6:1. Simge için yeterli, küçük metin için **değil**; kırmızı metin `--bg-primary` üstünde kalır.
- Açık tema: `--text-muted` beyaz üstünde 7,8:1, yeşil 6,5:1, kırmızı 6,5:1.
- Paneller birbirinden yalnız renkle ayrılmaz (1,3:1); `--border` ya da `--border-strong` ile ayrılır.

### Tipografi

- **Yazı tipi:** Yalnız Inter (pakette gömülü, `@fontsource-variable/inter`). Kod ve kısayol için `--font-mono: ui-monospace, Consolas, monospace`.
- **Boyutlar:** Mevcut ölçek kalır (12, 13, 15, 17, 20, 24 px). Yeni: `--font-size-2xl: 1.875rem` (30 px), boş oda ve hata ekranı başlıkları için.
- **Kalınlık (yeni):** `--font-weight-regular: 400`, `--font-weight-medium: 500`, `--font-weight-semibold: 600`, `--font-weight-bold: 700`. Bugün 600 ve 700 karışık; başlıklar 600'de toplanır, 700 yalnız sayılar ve rozetler için.
- **Harf aralığı (yeni):** `--tracking-tight: -0.01em` (başlıklar), `--tracking-wide: 0.04em` (büyük harfli kategori adları).

### Boşluk

Mevcut 4 px tabanlı ölçek kalır (4–40 px). Yeni: `--space-12: 48px`, `--space-16: 64px` (oda ekranı kenar boşlukları).

### Köşe yuvarlaklığı (yeni)

Bugün bileşenlerde 20 ayrı değer var (1–24 px). Altıya iner:

| Token | Değer | Kullanım | Bugünkü değerlerden |
|---|---|---|---|
| `--radius-xs` | 4px | Rozet, küçük etiket | 1, 2, 3, 4, 5 |
| `--radius-sm` | 6px | Kanal satırı, giriş kutusu, düğme | 6 |
| `--radius-md` | 8px | Mesaj eki, açılır menü | 8, 9, 10 |
| `--radius-lg` | 12px | Panel, oda kartı | 11, 12 |
| `--radius-xl` | 16px | Pencere (modal) | 16, 18, 20, 24 |
| `--radius-full` | 999px | Avatar, hap, yuvarlak düğme | 50%, 999px |

### Gölge (yeni)

Koyu temada katmanı renk ayırır; gölge yalnız yüzen öğelerde. Bugünkü 13 farklı gölge üçe iner.

| Token | Koyu | Açık | Kullanım |
|---|---|---|---|
| `--shadow-sm` | `0 1px 0 rgba(0,0,0,.2)` | `0 1px 2px rgba(0,0,0,.06)` | Başlık şeridi alt çizgisi |
| `--shadow-md` | `0 4px 16px rgba(0,0,0,.4)` | `0 4px 16px rgba(0,0,0,.10)` | Menü, ipucu, açılır panel |
| `--shadow-lg` | `0 8px 32px rgba(0,0,0,.6)` | `0 8px 32px rgba(0,0,0,.16)` | Pencere, yüzen kontrol hapı |

### Hareket (yeni)

| Token | Değer | Kullanım |
|---|---|---|
| `--duration-instant` | 80ms | Basma geri bildirimi |
| `--duration-fast` | 150ms | Renk ve üzerine gelme (bugünkü `--transition-fast` bunu kullanır) |
| `--duration-normal` | 200ms | Panel açma, kanal altı liste |
| `--duration-slow` | 300ms | Pencere ve oda ekranı girişi |
| `--duration-pulse` | 1200ms | Konuşma halkası döngüsü |
| `--ease-out` | `cubic-bezier(0.2, 0, 0, 1)` | Giriş |
| `--ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | Çıkış (girişten kısa) |
| `--ease-linear` | `linear` | Dönen yükleme simgesi |

- **Sürekli hareket** yalnız konuşma halkasında ve yükleme simgesinde.
- **`prefers-reduced-motion`:** Bugün 30 bileşenden yalnız birinde var. `index.css`'e tek bir genel kural eklenir: geçişler ve döngüler durur. Konuşma halkası durağan, kalın bir çerçeveye döner; konuşan kişi yine görünür.

### Ölçüler (yeni)

| Token | Değer | Kullanım |
|---|---|---|
| `--control-size-sm` | 32px | Kullanıcı panelindeki küçük düğmeler (telefonda 44'e çıkar) |
| `--control-size-md` | 44px | Kontrol hapındaki düğmeler |
| `--control-size-lg` | 56px | Mikrofon (birincil) |
| `--avatar-xs` | 20px | Kanal altındaki kişiler |
| `--avatar-sm` | 32px | Mesaj, üye listesi |
| `--avatar-lg` | 80px | Oda kartı |
| `--rail-width` | 72px | Sunucu şeridi (bugünkü) |
| `--sidebar-width` | 240px | Kanal listesi (bugünkü) |
| `--members-width` | 280px | Üye listesi (bugünkü) |
| `--header-height` | 48px | Kanal başlığı (bugünkü) |
| `--titlebar-height` | 32px | Electron başlık çubuğu (yeni) |

### Katman sırası (yeni)

Bugün 1'den 3000'e dağınık. `--z-sticky: 20`, `--z-dropdown: 500`, `--z-overlay: 1500`, `--z-modal: 2000`, `--z-toast: 2500`, `--z-titlebar: 3000`. Mevcut değerler aynı kalır, yalnız adlandırılır.

## Senin kararın gereken noktalar

1. **Panel biçimi**
   - **A (önerim):** Ayrı, yuvarlak köşeli paneller; aralarında 8 px boşluk (`ana-pencere-ayrik-yuvarlak-paneller.png`).
   - **B:** Bugünkü gibi bitişik sütunlar, yalnız rötuş (`ana-pencere-klasik-uc-sutun-rotuslu.png`).
2. **Ses odası ekranı**
   - **A (önerim):** Ana alanın tamamı katılımcı kartları; yazılı sohbete geçince oda küçülür, sol alttaki "Ses bağlı" kartından geri dönülür (`ses-odasi-konusanlar-kart-dinleyenler-izgara.png`).
   - **B:** Ekran bölünür: üstte kartlar, altta yazılı sohbet (`ses-odasi-arama-ustte-sohbet-altta.png`).
3. **Token'lar:** Onaydan sonra `index.css`'e yazılır. İlk adımda bileşenlerdeki sabit köşe, gölge ve süre değerleri bu token'lara taşınır. Görünümde küçük kaymalar olur (ör. 20 px köşe 16 px'e iner).

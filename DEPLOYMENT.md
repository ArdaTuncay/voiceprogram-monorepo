# VoiceProgram — Canlıya Çıkış Rehberi

Bu rehber, backend'i (Phoenix, Docker ile) Render veya Railway'e, frontend'i (React/Vite) Vercel'e nasıl deploy edeceğinizi adım adım anlatır.

## Ön Koşullar

- Proje bir GitHub deposunda olmalı (Render/Railway/Vercel hepsi git tabanlı deploy yapar). Proje şu an git deposu değil — önce şunu yapın:
  ```bash
  cd VoiceProgram
  git init
  git add .
  git commit -m "Initial commit"
  ```
  Sonra GitHub'da boş bir repo oluşturup `git remote add origin <url>` + `git push -u origin main` ile gönderin.
- Render **veya** Railway hesabı (backend için) — bu rehber ikisini de kapsar, birini seçin.
- Vercel hesabı (frontend için).
- Bir PostgreSQL veritabanı (Render/Railway'in kendi managed Postgres'i yeterli).

**Genel sıra:** Önce veritabanı → sonra backend (Docker) → sonra frontend (Vercel) → son olarak backend'e frontend'in gerçek adresini (`FRONTEND_URL`) girip yeniden deploy edin. Bu son adım gerekli çünkü backend'in CORS/WebSocket güvenlik kontrolleri frontend'in adresini bilmek zorunda — bu adres frontend deploy edilmeden bilinemez.

---

## Adım 1: PostgreSQL Veritabanı

### Render
1. Render Dashboard → **New** → **PostgreSQL**.
2. Bir isim verin (örn. `voiceprogram-db`), plan seçin (Free/Starter yeterli).
3. Oluşturduktan sonra **Internal Database URL**'i kopyalayın (backend ile aynı Render bölgesindeyse bunu kullanın, dışarıdan erişim gerekiyorsa **External Database URL**'i kullanın).

### Railway
1. Railway projesine **New** → **Database** → **PostgreSQL** ekleyin.
2. Railway otomatik olarak `DATABASE_URL` değişkenini o servise ekler; backend servisiniz aynı projede olursa Railway bunu backend'e de otomatik referans olarak bağlayabilir (`${{Postgres.DATABASE_URL}}` gibi).

---

## Adım 2: Backend'i Deploy Et (Docker)

Backend klasöründe (`/backend`) hazır bir `Dockerfile` var — multi-stage build ile Elixir/Phoenix'i derleyip minimal bir Debian imajında çalıştırıyor. Migration'lar konteyner her başladığında otomatik çalışıyor (`bin/migrate && bin/server`).

### Render
1. Render Dashboard → **New** → **Web Service**.
2. GitHub reponuzu bağlayın.
3. **Root Directory**: `backend`
4. **Runtime**: Docker (Render, `backend/Dockerfile`'ı otomatik algılar).
5. **Environment Variables** (Adım 4'te tam liste var) — en azından `DATABASE_URL`, `SECRET_KEY_BASE`, `PHX_HOST`, `PHX_SERVER=true` girin.
6. **Create Web Service** — ilk build birkaç dakika sürebilir (Docker image derleniyor).
7. Deploy bitince Render size bir URL verir (örn. `https://voiceprogram-backend.onrender.com`) — bunu not edin, frontend'e bu adresi gireceksiniz.

### Railway
1. Railway projesinde **New** → **GitHub Repo** ile reponuzu bağlayın.
2. Servis ayarlarında **Root Directory**'yi `backend` yapın.
3. Railway `Dockerfile`'ı otomatik algılar (Settings → Build → Builder: Dockerfile).
4. **Variables** sekmesinden ortam değişkenlerini girin (Adım 4).
5. **Settings → Networking → Generate Domain** ile bir public URL alın.

---

## Adım 3: Backend Ortam Değişkenleri (Environment Variables)

| Değişken | Açıklama | Örnek |
|---|---|---|
| `DATABASE_URL` | Postgres bağlantı adresi | `ecto://user:pass@host/dbname` (veritabanı servisinizden kopyalayın) |
| `SECRET_KEY_BASE` | Cookie/oturum imzalama anahtarı, **rastgele üretilmeli** | Terminalde `mix phx.gen.secret` çalıştırıp çıktısını yapıştırın, ya da `openssl rand -base64 48` |
| `PHX_HOST` | Backend'in kendi public adresi (şema olmadan, sadece host) | `voiceprogram-backend.onrender.com` |
| `PHX_SERVER` | Sunucunun gerçekten başlaması için | `true` |
| `FRONTEND_URL` | Frontend'in adresi — CORS ve WebSocket origin kontrolü için **kritik** (Adım 5'ten sonra girilecek) | `https://voiceprogram.vercel.app` (birden fazla adres için virgülle ayırın) |
| `PORT` | Render/Railway genelde otomatik ayarlar, elle girmenize gerek yok | — |
| `POOL_SIZE` | (opsiyonel) Veritabanı bağlantı havuzu boyutu | `10` |

**Not:** `FRONTEND_URL` girilmezse backend `CORS`'u herkese açık (`*`) bırakır ve WebSocket origin kontrolünü tamamen kapatır (`check_origin: false`) — geliştirme/test için çalışır ama üretimde **mutlaka** gerçek frontend adresinizi girin, aksi halde herhangi bir site sizin API'nize istek atabilir.

`mix phx.gen.secret` çalıştırmak için yerel makinenizde:
```bash
cd backend
mix phx.gen.secret
```

---

## Adım 4: Veritabanı Migration'ları

Migration'lar Docker imajı her başladığında (`CMD ["/bin/sh", "-c", "/app/bin/migrate && /app/bin/server"]`) **otomatik olarak** çalışır — elle bir şey yapmanıza gerek yok. İsterseniz ilk kurulumda örnek verileri (varsayılan "Ana Sunucu" + kanallar) eklemek için seed script'ini de çalıştırabilirsiniz:

- **Render**: Dashboard → servisiniz → **Shell** sekmesinden:
  ```bash
  /app/bin/backend eval "Code.eval_file(\"priv/repo/seeds.exs\")"
  ```
  (Not: seeds.exs derlenmiş release'e dahil edilmemiş olabilir çünkü kaynak kod değil; bu adım opsiyoneldir — atlarsanız uygulama yine de çalışır, sadece kullanıcılar ilk girişte kendi sunucularını "+" ile oluşturur.)
- **Railway**: Servis → **Settings → Deploy → Custom Start Command** ile geçici olarak değiştirip bir kerelik çalıştırabilir, veya Railway CLI ile `railway run` kullanabilirsiniz.

---

## Adım 5: Frontend'i Vercel'e Deploy Et

1. [vercel.com/new](https://vercel.com/new) → GitHub reponuzu import edin.
2. **Root Directory**: `frontend`
3. **Framework Preset**: Vite (Vercel genelde otomatik algılar).
4. **Build Command**: `npm run build` (varsayılan, değiştirmeyin).
5. **Output Directory**: `dist` (varsayılan).
6. **Environment Variables**:

   | Değişken | Değer |
   |---|---|
   | `VITE_API_URL` | Backend'inizin tam adresi, örn. `https://voiceprogram-backend.onrender.com` (sonunda `/` **olmadan**) |

7. **Deploy**'a basın. Bitince Vercel size bir adres verir (örn. `https://voiceprogram.vercel.app`).

---

## Adım 6: Backend'e Frontend Adresini Bildirin (Geri Dönüp Güncelleme)

Frontend'in gerçek adresini öğrendiniz — şimdi backend'e dönüp:

1. Render/Railway'de backend servisinizin ortam değişkenlerine gidin.
2. `FRONTEND_URL` değişkenini frontend'in Vercel adresiyle güncelleyin (örn. `https://voiceprogram.vercel.app`).
3. Servisi yeniden deploy edin (genelde ortam değişkeni değişince otomatik redeploy tetiklenir; değilse elle "Redeploy" / "Restart" basın).

---

## Test Etme

1. Vercel adresinizi açın (`https://voiceprogram.vercel.app`), kayıt olun.
2. Tarayıcı DevTools → Network sekmesinde `/api/...` isteklerinin backend adresinize gittiğini ve `200` döndüğünü doğrulayın (CORS hatası varsa Console'da kırmızı bir "blocked by CORS policy" mesajı görürsünüz — bu durumda `FRONTEND_URL`'i kontrol edin).
3. Bir sunucu oluşturun, mesaj gönderin — WebSocket bağlantısının kurulduğunu (Network → WS sekmesinde `101 Switching Protocols`) doğrulayın.
4. Sesli kanala girip mikrofon izni isteğinin geldiğini doğrulayın (Vercel zaten HTTPS servis ettiği için bu sorunsuz çalışmalı).
5. Farklı ağlardaki (ör. biri ev Wi-Fi'si, diğeri mobil veri) iki kişiyle sesli/ekran paylaşımı testi yapın — **bkz. aşağıdaki bilinen sınırlama**.

---

## Bilinen Sınırlamalar / Sıradaki Adımlar

- **TURN sunucusu yok.** Şu an sadece herkese açık bir STUN sunucusu (`stun.l.google.com:19302`) kullanılıyor. Aynı yerel ağdaki veya "kolay" NAT'lar arkasındaki kullanıcılar arasında WebRTC (ses/ekran paylaşımı) sorunsuz çalışır, ama simetrik NAT veya kısıtlayıcı kurumsal/mobil ağlar arkasındaki kullanıcılar arasında bağlantı kurulamayabilir. Gerçek dünya güvenilirliği için bir TURN sunucusu (örn. [Twilio STUN/TURN](https://www.twilio.com/docs/stun-turn), veya kendi barındırdığınız [coturn](https://github.com/coturn/coturn)) eklenmesi önerilir — bu ayrı bir sonraki adım olarak planlanabilir.
- **Davet linkleri yok** — kullanıcılar sadece kendi sunucularını oluşturabiliyor, başka birinin sunucusuna katılma mekanizması yok.
- **Token yenileme yok** — oturum token'ı 24 saat sonra geçersiz olur, kullanıcı tekrar giriş yapmalı.
- İlk deploy'da veritabanı boş olacağı için (seed script'i opsiyonel), her kullanıcı kendi sunucusunu "+" ile oluşturarak başlar.

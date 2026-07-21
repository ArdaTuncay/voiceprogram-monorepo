# VoiceProgram — Canlıya Çıkış Rehberi

Bu rehber, backend'i (Phoenix, Docker ile) Render veya Railway'e, frontend'i (React/Vite) Vercel'e nasıl deploy edeceğinizi adım adım anlatır.

## Ön Koşullar

- Proje bir GitHub deposunda olmalı (Render/Railway/Vercel hepsi git tabanlı deploy yapar) — proje zaten bir git deposu ve GitHub'a bağlı (`git remote -v` ile doğrulayın), bu adımı atlayabilirsiniz.
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
| `CLOUDFLARE_ORIGIN_SECRET` | (opsiyonel ama Cloudflare kullanıyorsanız **kritik**) Cloudflare Transform Rule ile eklenen `X-Origin-Secret` header'ıyla eşleşmesi gereken gizli değer — bkz. `BackendWeb.RequireCloudflarePlug` | `openssl rand -hex 32` ile üretin |
| `SENTRY_DSN` | (opsiyonel) Beklenmedik hataları/çökmeleri Sentry'e göndermek için | sentry.io projenizin DSN'i |
| `METERED_TURN_USERNAME` / `METERED_TURN_CREDENTIAL` | (opsiyonel ama gerçek dünya güvenilirliği için **önerilir**) Metered.ca'nın TURN sunucusu için statik kimlik bilgisi çifti — bkz. `Backend.Turn` ve PROJECT_ARCHITECTURE.md 2.9. İkisi de set edilmezse (veya biri eksikse) backend sessizce STUN-only'ye düşer, tek başına set edilen bir tanesi de yok sayılır | Metered.ca panelinizden alın |
| `S3_BUCKET` (+ `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_URL_BASE`) | (opsiyonel ama **kalıcı dosya yüklemeleri için gerekli**) Set edilmezse `Backend.Uploads` yerel diske yazar — Render/Railway'in çoğu planında konteyner yeniden başladığında/yeniden deploy edildiğinde bu diskteki dosyalar kaybolur. AWS S3, Cloudflare R2 veya DigitalOcean Spaces desteklenir (bkz. aşağıdaki "Depolama" bölümü ve `config/runtime.exs`) | R2 örneği aşağıda |

**Not:** `FRONTEND_URL` girilmezse backend `CORS`'u herkese açık (`*`) bırakır ve WebSocket origin kontrolünü tamamen kapatır (`check_origin: false`) — geliştirme/test için çalışır ama üretimde **mutlaka** gerçek frontend adresinizi girin, aksi halde herhangi bir site sizin API'nize istek atabilir.

**Not:** `CLOUDFLARE_ORIGIN_SECRET` girilmezse `RequireCloudflarePlug` hiçbir şey yapmaz (no-op) — Cloudflare'i domain'inizin önüne koyduysanız mutlaka set edin, aksi halde biri Render/Railway'in verdiği `*.onrender.com`/`*.up.railway.app` adresine doğrudan istek atarak Cloudflare'i (WAF, edge rate-limit, IP maskeleme) tamamen atlayabilir.

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

## ⚠️ Bilinen Deploy Etkisi: `20260715000000_replace_token_valid_from_with_token_version` Migration'ı Tüm Oturumları Geçersiz Kılar

Bu migration `users` tablosundaki `token_valid_from` (timestamp) alanını kaldırıp yerine `token_version` (integer, `default: 0`) ekliyor; `Backend.Accounts.generate_user_token/1` ve `authenticate_token/1` artık oturum token'ının geçerliliğini bu yeni alana göre kontrol ediyor (bkz. `backend/lib/backend/accounts.ex`).

**Sonuç:** bu migration deploy edildiği an, **deploy öncesi imzalanmış tüm token'lar** (yani o anda aktif olan tüm oturumlar) geçersiz olur — çünkü o token'lar eski formatta (`token_version` alanı olmadan) imzalanmış, `authenticate_token/1` bunları `{:error, :invalid}` olarak reddeder. Bu, güvenlik açısından zararsızdır (kullanıcı sadece yeniden giriş yapmak zorunda kalır, veri kaybı olmaz) ama beklenmedik bir "herkes aniden çıkış yapılmış" deneyimi yaratabilir:

- Deploy sonrası açık olan tüm sekmeler/cihazlar bir sonraki API isteğinde/WebSocket yeniden bağlanmasında 401 alıp login ekranına düşecek.
- Bunu deploy penceresi/duyurusu planlarken hesaba katın (ör. "bakım sonrası tekrar giriş yapmanız gerekebilir" gibi bir not).
- Migration'lar zaten container her başladığında otomatik çalıştığından (`bin/migrate && bin/server`), bu davranış deploy'un bir parçası olarak kendiliğinden gerçekleşir — ekstra bir işlem yapmanız gerekmiyor, sadece bunu bekleyin.

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

## Depolama (S3/R2): Nesne Yaşam Döngüsü (Lifecycle) Politikaları

`S3_BUCKET` ortam değişkeni set edildiğinde (bkz. Adım 3, ve `config/runtime.exs`) backend yüklenen dosyaları `Backend.Uploads.S3` üzerinden bir S3-uyumlu bucket'a (AWS S3, Cloudflare R2, DigitalOcean Spaces) yazar. Bucket'ın kendisinde aşağıdaki iki Lifecycle kuralının tanımlanması önerilir — bunlar backend kodundan tamamen bağımsız, bulut sağlayıcısının kendi tarafında otomatik çalışan temizlik kurallarıdır:

1. **Yarıda kalan çok parçalı (multipart) yüklemelerin iptali** — iptal edilen veya yarıda kesilen büyük dosya yüklemeleri bucket'ta gizlice yer kaplamaya devam edebilir. `AbortIncompleteMultipartUpload` kuralı, başlatılıp **7 gün** içinde tamamlanmayan multipart yüklemeleri otomatik iptal edip temizler. Prefix kısıtlaması yok — tüm bucket'a uygulanır, çünkü yarım kalan parçalar herhangi bir key altında oluşabilir.
2. **Yetim geçici dosyaların silinmesi** — ileride "yüklenip hiçbir mesaja bağlanmamış" dosyalar için ayrı bir `uploads/tmp/` prefix'i kurgulanırsa, bu prefix altındaki nesneler `Expiration` kuralıyla **14 gün** sonra kalıcı olarak silinir. **Not:** Bu prefix şu an kod tarafında kullanılmıyor (`Backend.Uploads.store/1` düz, prefix'siz rastgele dosya adları üretir) — kural, böyle bir ayrım ileride eklendiğinde devreye girmesi için şablon olarak hazırlanmıştır.

### JSON (AWS CLI `put-bucket-lifecycle-configuration`)

Aşağıdaki içeriği `lifecycle.json` olarak kaydedin — hem AWS S3 hem de Cloudflare R2'nin S3-uyumlu API'siyle aynı formatı kabul eder:

```json
{
  "Rules": [
    {
      "ID": "abort-incomplete-multipart-uploads",
      "Status": "Enabled",
      "Filter": {},
      "AbortIncompleteMultipartUpload": {
        "DaysAfterInitiation": 7
      }
    },
    {
      "ID": "expire-orphaned-tmp-uploads",
      "Status": "Enabled",
      "Filter": {
        "Prefix": "uploads/tmp/"
      },
      "Expiration": {
        "Days": 14
      }
    }
  ]
}
```

Uygulamak için:

```bash
# AWS S3
aws s3api put-bucket-lifecycle-configuration \
  --bucket <bucket-adiniz> \
  --lifecycle-configuration file://lifecycle.json

# Cloudflare R2 (aynı komut, S3-uyumlu endpoint üzerinden)
aws s3api put-bucket-lifecycle-configuration \
  --endpoint-url https://<account_id>.r2.cloudflarestorage.com \
  --bucket <bucket-adiniz> \
  --lifecycle-configuration file://lifecycle.json
```

### XML (ham S3 REST API `PutBucketLifecycleConfiguration` gövdesi)

Bir araç/panel JSON değil ham XML istiyorsa aynı iki kural:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<LifecycleConfiguration>
  <Rule>
    <ID>abort-incomplete-multipart-uploads</ID>
    <Status>Enabled</Status>
    <Filter></Filter>
    <AbortIncompleteMultipartUpload>
      <DaysAfterInitiation>7</DaysAfterInitiation>
    </AbortIncompleteMultipartUpload>
  </Rule>
  <Rule>
    <ID>expire-orphaned-tmp-uploads</ID>
    <Status>Enabled</Status>
    <Filter>
      <Prefix>uploads/tmp/</Prefix>
    </Filter>
    <Expiration>
      <Days>14</Days>
    </Expiration>
  </Rule>
</LifecycleConfiguration>
```

### AWS S3 Konsolu (elle kurulum)

1. S3 → bucket'ınız → **Management** sekmesi → **Lifecycle rules** → **Create lifecycle rule**.
2. **Kural 1:** İsim `abort-incomplete-multipart-uploads`, kapsam "Apply to all objects in the bucket", **Lifecycle rule actions** altında yalnızca *"Delete expired object delete markers or incomplete multipart uploads"* işaretleyin → **Number of days** = `7`.
3. **Kural 2:** İsim `expire-orphaned-tmp-uploads`, kapsam "Limit the scope..." → Prefix = `uploads/tmp/`, action *"Expire current versions of objects"* → **Number of days** = `14`.

### Cloudflare R2 Panosu (elle kurulum)

1. R2 → bucket'ınız → **Settings** → **Object Lifecycle Rules** → **Add rule**.
2. **Kural 1:** **Rule name** = `abort-incomplete-multipart-uploads`, prefix boş bırakın (tüm bucket), **Action** = "Delete incomplete multipart uploads", **After** = `7 days`.
3. **Kural 2:** **Rule name** = `expire-orphaned-tmp-uploads`, **Prefix** = `uploads/tmp/`, **Action** = "Delete objects", **After** = `14 days`.

---

## Bilinen Sınırlamalar / Sıradaki Adımlar

- **TURN sunucusu opsiyonel, set edilmezse yok.** Backend Metered.ca'nın statik TURN kimlik bilgisi çiftini destekliyor (bkz. yukarıdaki `METERED_TURN_USERNAME`/`METERED_TURN_CREDENTIAL`, `Backend.Turn`, PROJECT_ARCHITECTURE.md 2.9) — bu ikisi deploy'da set edilirse gerçek bir TURN relay'i devreye girer. Set edilmezse sadece herkese açık bir STUN sunucusu (`stun.l.google.com:19302`) kullanılır: aynı yerel ağdaki veya "kolay" NAT'lar arkasındaki kullanıcılar arasında WebRTC (ses/ekran paylaşımı) sorunsuz çalışır, ama simetrik NAT veya kısıtlayıcı kurumsal/mobil ağlar arkasındaki kullanıcılar arasında bağlantı kurulamayabilir.
- **Token yenileme yok** — oturum token'ı 24 saat sonra geçersiz olur, kullanıcı tekrar giriş yapmalı.
- İlk deploy'da veritabanı boş olacağı için (seed script'i opsiyonel), her kullanıcı kendi sunucusunu "+" ile oluşturarak başlar.

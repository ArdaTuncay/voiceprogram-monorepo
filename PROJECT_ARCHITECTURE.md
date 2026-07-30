# PROJECT_ARCHITECTURE.md — Zircle Ana Mühendislik El Kitabı

> **Bu doküman kimin için?** Bu projeyi (Zircle — Discord benzeri topluluk/sesli sohbet uygulaması) daha önce hiç görmemiş bir yapay zekanın, tek bir soru sormadan sistemi %100 anlayıp kaldığı yerden devam edebilmesi için yazılmıştır. Her iddia gerçek kod dosyaları okunarak doğrulanmıştır; dosya yolları ve satır numaraları birebir verilmiştir. Kodun kendisiyle çelişen hiçbir varsayım yapılmamıştır — aksine, aşağıda birkaç yerde **popüler ama bu projede geçerli olmayan varsayımlar açıkça düzeltilmiştir** (örn. "Tailwind CSS kullanılıyor" — kullanılmıyor; "Ecto.Multi ile race condition çözülüyor" — çözülmüyor, farklı bir desen kullanılıyor).
>
> **Repo kökü:** `C:\Users\ardat\Desktop\VoiceProgram`
> **Backend:** `backend/` — Elixir 1.x / Phoenix 1.8.9 / Bandit 1.12.0 / Ecto 3.14 / PostgreSQL
> **Frontend:** `frontend/` — React 19 / TypeScript / Vite / Zustand / Phoenix JS client (düz CSS, Tailwind YOK)

---

## İçindekiler

1. [🏗️ Teknoloji Yığını & Mimari Omurga](#1-teknoloji-yığını--mimari-omurga)
2. [🛡️ Güvenlik, Rate-Limiting & Dependency Uyumluluğu](#2-güvenlik-rate-limiting--dependency-uyumluluğu)
3. [💾 Veritabanı İş Mantıkları & Performans](#3-veritabanı-iş-mantıkları--performans)
4. [🎙️ WebRTC Ses Kanalları & Perfect Negotiation](#4-webrtc-ses-kanalları--perfect-negotiation)
5. [🧪 Kalite Güvence (QA) ve Test Altyapısı](#5-kalite-güvence-qa-ve-test-altyapısı)
6. [✨ Faz 10 — Yeni Eklenen Özellikler](#6-faz-10--yeni-eklenen-özellikler)
7. [📌 Bilinen Boşluklar / Devam Notları](#7-bilinen-boşluklar--devam-notları)

---

## 1. Teknoloji Yığını & Mimari Omurga

### 1.1 Backend — Elixir / Phoenix / Bandit / Ecto

**Ana bağımlılıklar (`backend/mix.lock`'tan doğrudan okunan sürümler):**

| Paket | Sürüm | Rol |
|---|---|---|
| `phoenix` | 1.8.9 | Web framework |
| `bandit` | 1.12.0 | HTTP/WebSocket sunucusu (adapter) |
| `plug` | 1.20.3 | HTTP middleware zinciri |
| `plug_crypto` | 2.1.1 | Token imzalama/şifreleme |
| `ecto` / `ecto_sql` | 3.14.0 | ORM / query builder |
| `postgrex` | 0.22.3 | PostgreSQL sürücüsü |
| `jason` | 1.4.5 | JSON encode/decode |
| `hammer` | 7.4.0 | Rate limiting (ETS backend) |
| `remote_ip` | 1.2.0 | Reverse-proxy arkasında gerçek client IP tespiti |
| `cors_plug` | 3.0.3 | CORS |
| `sentry` | 13.3.0 | Hata izleme |
| `pbkdf2_elixir` | 2.3.1 | Parola hash'leme |
| `phoenix_ecto` | 4.7.0 | Phoenix-Ecto entegrasyonu |
| `phoenix_live_dashboard` | 0.8.7 | Dev/ops dashboard |
| `phoenix_live_view` | 1.2.7 | (mevcut ama bu projede LiveView sayfası aktif kullanılmıyor — sadece LiveDashboard için transitif bağımlılık) |
| `websock_adapter` | 0.6.0 | WebSocket adapter katmanı |
| `req` | 0.6.2 | HTTP client (S3 upload, link preview fetch için) |
| `swoosh` | 1.26.3 | E-posta gönderimi |

> **Not:** `plug_cowboy` **mix.lock'ta resolve edilmiş bir bağımlılık olarak yok** — proje Cowboy değil, tamamen **Bandit** üzerinde çalışıyor. `Plug.Cowboy` hiçbir yerde kullanılmıyor.

**Bandit adapter konfigürasyonu — `backend/config/config.exs:33-35`:**
```elixir
config :backend, BackendWeb.Endpoint,
  url: [host: "localhost"],
  adapter: Bandit.PhoenixAdapter,
  ...
```

**Port/network ayarları:**
- `backend/config/runtime.exs:23-24` (tüm ortamlar): `http: [port: String.to_integer(System.get_env("PORT", "4000"))]` — varsayılan port **4000**.
- `backend/config/dev.exs:22`: `http: [ip: {0, 0, 0, 0}]` — dev'de tüm interface'lerden dinliyor.
- Prod'a özel (`runtime.exs:122-132`, sadece `config_env() == :prod`):
  ```elixir
  config :backend, BackendWeb.Endpoint,
    url: [host: host, port: 443, scheme: "https"],
    http: [ip: {0, 0, 0, 0, 0, 0, 0, 0}],   # IPv6 dahil tüm interface'ler
    check_origin: check_origin,
    secret_key_base: secret_key_base
  ```
  `check_origin`, `FRONTEND_URL` env değişkeni set edilmemişse artık **boot sırasında `raise` ile hata fırlatıyor** (önceden sessizce `false`'a düşüyordu — yani WebSocket origin kontrolü prod'da yanlış konfigürasyonla tamamen kapalı kalabiliyordu). Bu boşluk çözüldü (bkz. [Bölüm 7](#7-bilinen-boşluklar--devam-notları), madde 3).
- `PHX_SERVER=true` env var'ı set edilmedikçe server otomatik başlamıyor (`runtime.exs:19-21`) — release script'lerinde standart Phoenix davranışı.

**Endpoint plug zinciri (özet, `backend/lib/backend_web/endpoint.ex`):**

Sıralama önemlidir — üstten alta:
1. `RemoteIp` — gerçek client IP'sini `conn.remote_ip`'ye yazar (bkz. [2.1](#21-remote_ip--reverse-proxy-arkasında-gerçek-ip-tespiti))
2. `BackendWeb.RequireCloudflarePlug` — Cloudflare bypass koruması (bkz. [2.2](#22-requirecloudflareplug--cloudflare-bypass-koruması))
3. `Plug.Static` — `priv/static` (yüklenen dosyalar dahil) servis eder
4. Dev-only: `Phoenix.CodeReloader`
5. `Plug.RequestId`, `Plug.Telemetry`
6. `Plug.Parsers` — `length: 12_000_000` (bkz. [2.4](#24-multipart-parser-sınırı))
7. `Plug.MethodOverride`, `Plug.Head`
8. `Plug.Session`
9. `BackendWeb.Router`

**Ecto şema envanteri (`backend/lib/backend/**/*.ex`):**

| Context modülü | Şema(lar) | Sorumluluk |
|---|---|---|
| `Backend.Accounts` | `accounts/user.ex` (`users`) | Kayıt, `Phoenix.Token` tabanlı authentication, online/offline durum |
| `Backend.Servers` | `servers/server.ex` (`servers`), `servers/server_member.ex` (`server_members`), `servers/invite.ex` (`server_invites`) | Discord-tarzı "guild"ler, üyelik, davet kodları, kanal pozisyon yönetimi |
| `Backend.Chat` | `chat/channel.ex` (`channels`), `chat/message.ex` (`messages`), `chat/message_reaction.ex` (`message_reactions`) | Sunucu içi text/voice kanalları + mesajlar + reaksiyonlar |
| `Backend.DirectMessages` | `direct_messages/dm_room.ex` (`dm_rooms`), `direct_messages/dm_message.ex` (`dm_messages`), `direct_messages/dm_message_reaction.ex` (`dm_message_reactions`) | Birebir DM'ler — `Backend.Chat`'in ayna context'i, **tamamen ayrı tablolar** |
| `Backend.Friends` | `friends/friendship.ex` (`friendships`) | Arkadaşlık istekleri/kabulleri (tek yönlü satır modeli) |
| `Backend.Uploads` | (şema yok — `uploads/s3.ex` yardımcı modül) | Dosya ekleri: local disk veya S3-uyumlu depolama |
| `Backend.Presence` | — (`Phoenix.Presence` instance) | "Kim burada" takibi — voice odaları, chat kanalları, DM odaları |
| `Backend.RateLimiter` | — (`Hammer` instance) | ETS tabanlı rate limiting |
| `Backend.SlowQueryLogger` | — | Telemetry tabanlı yavaş sorgu izleme |
| `Backend.LinkPreview` | — | Chat linkleri için OpenGraph/meta veri çekme |
| `Backend.Mailer` | — | `Swoosh.Mailer` wrapper'ı |
| `Backend.Repo` | — | `Ecto.Repo` + Postgres adapter |
| `Backend.Release` | — | Compiled release içinde migration çalıştırma task'ları |

**`Backend.Chat` ve `Backend.DirectMessages` mimari ilişkisi (kritik nokta):** Bu iki context, **tek bir birleşik "message" tablosu değil, tamamen paralel iki tablo seti** kullanır:

```
Backend.Chat                          Backend.DirectMessages
─────────────                         ───────────────────────
channels (server_id FK)               dm_rooms (user_one_id, user_two_id — kanonik sıralı çift)
messages (channel_id FK)              dm_messages (dm_room_id FK)
message_reactions                     dm_message_reactions
```

Her iki `Message` şeması da neredeyse birebir aynı alanlara sahiptir (`content`, `file_url`, `file_type`, `is_edited`, `reactions` (virtual), `seq` (DB-atanan monoton sıra, `read_after_writes: true`)). Bu bilinçli bir kod tekrarıdır — `direct_messages.ex`'in moduledoc'u bunu açıkça "`Backend.Chat`'in ayna context'i" olarak tanımlar. Yeni bir mesaj-ilişkili özellik eklerken (örn. arama, bkz. [6.3](#63-mesaj-arama-message-search)) **her iki context'e de ayrı ayrı** eklenmelidir.

### 1.2 Frontend — React / Vite / TypeScript / Zustand

> ⚠️ **Önemli düzeltme:** Bu proje **Tailwind CSS kullanmıyor**. `frontend/package.json`'da `tailwindcss`, `postcss`, `autoprefixer` bağımlılıkları **yok**; `tailwind.config.*` / `postcss.config.*` dosyaları **yok**. Styling tamamen **düz (vanilla) CSS** ile yapılıyor — her component kendi `.css` dosyasını `import './X.css'` ile import ediyor (BEM benzeri class isimlendirme, `frontend/src/index.css`'te tanımlı CSS custom property'ler — `--bg-primary`, `--bg-secondary`, `--text-heading`, `--accent` vb. — üzerinden tema tutarlılığı sağlanıyor).

**Bağımlılıklar (`frontend/package.json`):** sadece `phoenix` (Phoenix JS client), `react`, `react-dom`, `zustand` — minimal bir yığın. Dev bağımlılıkları: `vite`, `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, `oxlint` (ESLint değil), `typescript`, `@vitejs/plugin-react`.

**`frontend/vite.config.ts` (tam dosya, 37 satır):**
```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
  server: {
    host: true,
    hmr: { protocol: 'ws', host: 'localhost', port: 5173 },
    proxy: {
      '/api':     { target: 'http://localhost:4000', changeOrigin: true, secure: false },
      '/socket':  { target: 'http://localhost:4000', ws: true, changeOrigin: true, secure: false },
      '/uploads': { target: 'http://localhost:4000', changeOrigin: true, secure: false },
    },
  },
})
```
`defineConfig` `vitest/config`'ten geliyor — bu dosya hem Vite build hem Vitest test config'idir. Dev'de `/api`, `/socket` (WebSocket, `ws: true`), `/uploads` backend'e (`:4000`) proxy'leniyor.

**Routing yok:** `frontend/src/App.tsx` (55 satır) hiçbir router kütüphanesi kullanmıyor. Tek koşullu render: `user` state'i varsa `<Chat>`, yoksa `<Auth>`. Auth kontrolü `loadSession()` (satır 11-13) ile `useState`'in lazy initializer'ında yapılıyor (`getStoredToken()` + `loadStoredUser()`).

#### Zustand Store Envanteri

Projede **7 store dosyası** var (`frontend/src/stores/*.ts`) — ama bunlardan biri (`useSocketStore.ts`) gerçek bir Zustand store değil, sadece bir **custom hook** (`useSocketSync`) export ediyor.

| Dosya | Tür | Sorumluluk | Diğer store'a bağımlılık |
|---|---|---|---|
| `useSessionStore.ts` | Zustand store (18 satır) | `forcedLogoutAt: number` + `triggerForcedLogout()` — reactivity dışı yerlerden (`services/session.ts`) App.tsx'i Auth ekranına düşürmek için | yok |
| `useConnectionStore.ts` | Zustand store (44 satır) | `isConnected`, `hasConnectedBefore`, `reconnectedAt` — socket bağlantı durumu | yok |
| `useFriendStore.ts` | Zustand store (103 satır) | `friendships`, `loading`, `error` + CRUD action'ları + socket reducer'ları (`handleFriendRequestReceived` vb.) | yok |
| `useServerStore.ts` | Zustand store (373 satır) | `servers`, `activeServerId`, `channels`, `activeChannelId`, unread set'ler, `memberStatuses`, kanal CRUD/pozisyon güncelleme, `groupChannelsByCategory` (pure fonksiyon, store state'i değil) | yok |
| `useChatStore.ts` | Zustand store (~330 satır) | Aktif kanalın mesajları, draft, typing, upload, arama state'i (Faz 10) | **`useServerStore.getState()`**'i okuyor (`activeServerId`/`activeChannelId` için) |
| `useDMStore.ts` | Zustand store (~373 satır) | Aktif DM odasının mesajları, oda listesi, unread, draft, typing, arama state'i (Faz 10) | yok (kendi `activeRoomId`'sini kendi tutar) |
| `useSocketStore.ts` | **Custom hook** (163 satır), Zustand store DEĞİL | `useSocketSync(userId)` — tüm Phoenix Channel join/leave efektlerini ve event→store yönlendirmesini merkezi olarak yönetir | Hepsini (`useChatStore`, `useDMStore`, `useServerStore`, `useFriendStore`) `getState()` üzerinden çağırır |

> Kullanıcının aradığı "5 store" listesi (`useChatStore`, `useDMStore`, `useServerStore`, `useSocketStore`, `useSessionStore`) doğru isimlerle mevcut, ama gerçekte **toplam 7 dosya** var (+ `useFriendStore`, `useConnectionStore`) ve `useSocketStore` bir store değil bir senkronizasyon hook'udur.

#### `useSocketSync` — Merkezi Senkronizasyon Mekanizması

`frontend/src/stores/useSocketStore.ts`, `Chat.tsx:117`'de bir kez çağrılır (`useSocketSync(user.id)`), 6 `useEffect` içerir:

1. **Text channel effect** (satır 27-45): `activeChannelId` değişince `useChatStore.getState().resetForChannelSwitch()` + `joinChatChannel(...)`.
2. **Server topic effect** (satır 53-65): `activeServerId` değişince `joinServerChannel(...)`.
3. **DM room effect** (satır 70-85): `activeRoomId` değişince `useDMStore.getState().resetForRoomSwitch()` + `joinDmChannel(...)`.
4. **Reconnect resync effect** (satır 97-101): `reconnectedAt` değişince `useFriendStore.getState().refreshFriendships()` + `useServerStore.getState().resyncActiveServer()` — socket kısa süreliğine koptuysa kaçırılmış olabilecek state'i tazeler.
5. **Notification permission effect** (satır 104-108): bir kerelik `Notification.requestPermission()`.
6. **User topic effect** (satır 114-162): `userId` bazlı, komponent ömrü boyunca bir kez `joinUserChannel(userId, ...)` — kişisel bildirim kanalı.

**Event → Store Handler eşleşme tablosu (uçtan uca doğrulanmış):**

| Topic | Phoenix event | Hedef store action |
|---|---|---|
| `chat:<channelId>` | join `ok` | `useChatStore.setMessages(resp.messages)` + `useServerStore.setChannelError('')` |
| `chat:<channelId>` | `shout` | `useChatStore.addMessage(msg)` |
| `chat:<channelId>` | join `error` | `useServerStore.setChannelError(reason)` |
| `chat:<channelId>` | presence sync | `useChatStore.setOnlineUsers(users)` |
| `chat:<channelId>` | `user_typing` | `useChatStore.setTypingUser(user_id, username, is_typing)` |
| `chat:<channelId>` | `reaction_toggled` | `useChatStore.handleReactionToggled(payload)` |
| `chat:<channelId>` | `message_updated` | `useChatStore.handleMessageUpdated(msg)` |
| `server:<serverId>` | `channel_created` / `channel_deleted` / `channel_positions_updated` / `server_updated` / `member_left` | `useServerStore.handleChannel*` / `handleServerUpdated` / `handleMemberLeft` (no-op şu an) |
| `dm:<roomId>` | join `ok` / `shout` / `user_typing` / `reaction_toggled` / `dm_message_updated` | `useDMStore.setMessages` / `addMessage` / `setTyping` / `handleReactionToggled` / `handleMessageUpdated` |
| `user:<userId>` | `new_message` | `useServerStore.markUnread`/`markServerUnread` + `Notification` API + tıklanınca `navigateToNotification` |
| `user:<userId>` | `server_deleted` / `member_kicked` | `useServerStore.removeServerAndDeselect(server_id)` |
| `user:<userId>` | `member_status_changed` | `useServerStore.handleMemberStatusChanged` |
| `user:<userId>` | `friend_request_received` / `friend_request_accepted` / `friend_removed` | `useFriendStore.handleFriendRequest*` / `handleFriendRemoved` |
| `user:<userId>` | `new_dm_message` | `useDMStore.handleNewDmMessage(payload)` + `Notification` API |

> `voice:*` topic'i `useSocketSync` kapsamı dışındadır — ses kanalı tamamen ayrı bir hook'ta (`frontend/src/hooks/useVoiceChannel.ts`) yönetilir, bkz. [Bölüm 4](#4-webrtc-ses-kanalları--perfect-negotiation).

#### `frontend/src/services/socket.ts` — Bağlantı Katmanı

```ts
socket = new Socket(resolveSocketUrl(), { params: () => ({ token: getStoredToken() }) });
```
- `params` bir **fonksiyon** olarak geçilir (sabit obje değil) — her reconnect denemesinde `localStorage`'dan güncel token okunması için.
- Reconnect/heartbeat: Phoenix'in **varsayılan** mantığı kullanılıyor, özel `reconnectAfterMs`/`heartbeatIntervalMs` **verilmemiş**.
- `MAX_FAILED_CONNECTS_BEFORE_GIVING_UP = 3` — ardışık 3 başarısız bağlantı denemesinden sonra (`establishedConnections === 0` iken) `disconnectSocket()` + `forceLogout()` tetiklenir; bu, geçersiz/iptal edilmiş bir token'ı geçici bir ağ kesintisinden ayırt etmek içindir.
- `disconnectSocket()` modül scope'undaki 5 channel referansını (`textChannel`, `voiceChannel`, `userChannel`, `dmChannel`, `serverChannel`) `leave()` edip null'lar, sonra `socket.disconnect()` çağırır.

Export edilen tüm fonksiyonlar: `joinChatChannel`, `shout`, `sendTyping`, `toggleReaction`, `editMessage`, `joinDmChannel`, `sendDmMessage`, `sendDmTyping`, `toggleDmReaction`, `editDmMessage`, `joinVoiceChannel`, `sendVoiceOffer`, `sendVoiceAnswer`, `sendIceCandidate`, `sendVoiceStatus`, `joinUserChannel`, `joinServerChannel`, `disconnectSocket`.

#### Uçtan Uca Akış: "Kullanıcı Bir Mesaj Gönderdiğinde"

```
1. Chat.tsx: Enter tuşu → handleKeyDown → sendMessage()
       (useChatStore((s) => s.sendMessage))
2. useChatStore.ts:253-259  sendMessage()
       draft.trim() → boşsa çık → stopTypingNow() → shout(content) → draft=''
3. services/socket.ts:132-134  shout(content, fileUrl?, fileType?)
       textChannel?.push('shout', { content, file_url, file_type })
4. backend/.../chat_channel.ex:54-73  handle_in("shout", params, socket)
       Chat.create_message(attrs)
       ├─ broadcast!(socket, "shout", serialized)              → chat:<channelId> topic'indeki HERKESE (gönderen dahil)
       └─ notify_other_members(...) → her üyenin user:<id>'sine "new_message" (unread/bildirim için)
       {:reply, :ok, socket}
5. services/socket.ts:111  textChannel.on('shout', msg => callbacks.onShout(msg))
6. useSocketStore.ts:36    onShout: msg => useChatStore.getState().addMessage(msg)
7. useChatStore.ts:127     addMessage → messages dizisine ekle → React re-render
   (paralel) services/socket.ts:316 → useSocketStore.ts:116-134 → useServerStore.markUnread + Notification API
```

Bu "gönderenin de kendi mesajını broadcast'ten alması" deseni (optimistic local update YOK), tüm reaction/edit akışlarında da tekrarlanan bilinçli bir mimari karardır — store'lar "tek doğruluk kaynağı broadcast'tir" convention'ını izler (bkz. `useChatStore.ts` içindeki `toggleReaction`/`editMessage` yorumları).

---

## 2. Güvenlik, Rate-Limiting & Dependency Uyumluluğu

### 2.1 `remote_ip` — Reverse-Proxy Arkasında Gerçek IP Tespiti

**Dosya:** `backend/lib/backend_web/endpoint.ex:22-54`, paket: `remote_ip ~> 1.2` (lock: `1.2.0`).

Endpoint pipeline'ının **en başında**, `Plug.Static`'ten bile önce çalışır:
```elixir
plug RemoteIp, headers: ["cf-connecting-ip"], proxies: @cloudflare_ip_ranges
```

- Trust edilen header **sadece `cf-connecting-ip`**'dir — `X-Forwarded-For` **değil**. Bunun bilinçli bir seçim olduğu kod yorumunda açıklanır: `CF-Connecting-IP`, Cloudflare'in "gerçekten kim bağlandı" için verdiği tek değerdir; `X-Forwarded-For` client tarafından spoof edilebilecek bir zincirdir.
- `@cloudflare_ip_ranges` (satır 29-36), Cloudflare'in resmi yayınladığı IPv4/IPv6 edge aralıklarını (`173.245.48.0/20`, `104.16.0.0/13`, `2400:cb00::/32` vb.) içeren **statik, elle bakımı gereken** bir liste — otomatik güncelleme mekanizması yok.
- Mimari gerekçe (satır 38-53): Render/Railway gibi PaaS'lar düz HTTP reverse proxy olduğundan, `conn.remote_ip` normalde proxy'nin adresi olurdu — bu da IP bazlı rate-limit bucket'larını (bkz. 2.3) kırardı. `RemoteIp`, `conn.remote_ip`'yi en erken noktada doğru değerle yeniden yazarak bunu çözer.

### 2.2 `RequireCloudflarePlug` — Cloudflare Bypass Koruması

**Dosya:** `backend/lib/backend_web/plugs/require_cloudflare_plug.ex` (48 satır)

**Problem:** `RemoteIp`'in Cloudflare IP allowlist'i, isteğin *gerçekten* Cloudflare üzerinden geçtiğini garanti etmez — sadece header içindeki IP zincirini filtreler. Render/Railway her zaman devre dışı bırakılamayan bir `*.onrender.com`/`*.up.railway.app` fallback hostname sunduğundan, bir saldırgan Cloudflare'i tamamen atlayıp uygulamaya **doğrudan** istek atabilir ve sahte bir `cf-connecting-ip` header'ı ekleyebilir.

**Çözüm — paylaşılan sır (shared-secret) header:** Bir Cloudflare Transform Rule, Cloudflare üzerinden geçen her isteğe `X-Origin-Secret: <rastgele değer>` header'ı ekler (client bunu göremez/ayarlayamaz — Cloudflare origine iletirken kendisi ekler). Plug bunu karşılaştırır:
```elixir
def call(conn, _opts) do
  case Application.get_env(:backend, :cloudflare_origin_secret) do
    nil ->
      conn

    secret ->
      case get_req_header(conn, "x-origin-secret") do
        [^secret] -> conn
        _ -> conn |> send_resp(:forbidden, "") |> halt()
      end
  end
end
```

- **Konfigürasyon:** `backend/config/runtime.exs:79` → `config :backend, :cloudflare_origin_secret, System.get_env("CLOUDFLARE_ORIGIN_SECRET")`.
- **Dev ortamında pasif:** `backend/config/dev.exs:66`'da bu satır yorumda (`# config :backend, :cloudflare_origin_secret, "dev-secret"`) — yani dev/test'te secret set edilmediğinden plug **no-op** çalışır, hiçbir koruma sağlamaz. Sadece prod'da `CLOUDFLARE_ORIGIN_SECRET` env var'ı set edilirse aktif olur. Bu, dev ortamının kendisi için bilinçli bir tercih (yerelde önünde Cloudflare yok) ve değiştirilmedi — ama artık `backend/test/backend_web/plugs/require_cloudflare_plug_test.exs` `call/2`'yi izole çağırarak hem no-op yolunu hem de enforce-mode'u (secret set edilmişken: doğru header geçer, eksik/yanlış header 403+boş body ile `halt`, `x-origin-secret` birden fazla değerle gelirse de `[^secret]` pattern'i tek-değer eşleşme aradığından 403 — bu kasıtlı davranış, güvenlik açığı değil) doğruluyor.
- **Kapsam:** `endpoint.ex` satır 58'de doğrudan endpoint pipeline'ına eklenir (router'daki bir pipeline'a değil) — yani **her route için** geçerlidir, `RemoteIp`'den hemen sonra, statik dosya servisinden önce çalışır.

### 2.3 Rate Limiting — Hammer (ETS)

**Kütüphane:** `Hammer ~> 7.0` (lock: `7.4.0`), ETS backend.

```elixir
# backend/lib/backend/rate_limiter.ex
defmodule Backend.RateLimiter do
  use Hammer, backend: :ets
end
```
```elixir
# backend/config/config.exs:28-30
config :backend, Backend.RateLimiter,
  clean_period: :timer.minutes(1),
  key_older_than: :timer.minutes(10)
```
> ETS tabanlıdır — **tek node için** çalışır, çok node'lu bir deploy'da paylaşılmaz (kod yorumunda açıkça belirtilmiş).

**Plug:** `backend/lib/backend_web/plugs/rate_limiter_plug.ex`
- Key'ler `{controller_module, action_name}` ile scope'lanır.
- **IP bazlı key her zaman uygulanır** (`ip_string(conn.remote_ip)`); ek olarak `:key` seçeneğiyle (opsiyonel `plug` argümanı) belirtilen ikinci bir key daha vurulur — böylece saldırgan tek boyutu sabit tutup diğerini değiştirerek limiti atlatamaz. `:key` üç şekilde kullanılabilir:
  - `{:param, "alan_adi"}` (varsayılan: `{:param, "email"}`, login/register için) — `conn.params`'tan (path/query/body hepsini kapsar) okunur. `UserController.login/register` email bazlı, `InviteController.create` ise `"server_id"` path param'ı bazlı çalışır.
  - `:current_user` — `conn.assigns.current_user.id` (yalnızca `:authenticated` pipeline'ından sonra anlamlı); hedef alana göre değil **kimliği doğrulanmış çağırana göre** sınırlar, böylece "farklı kullanıcı adları deneyerek limiti atlatma" (enumeration) mümkün olmaz. `FriendController.request` bunu kullanır.
  - Key çıkarılamazsa (alan yok/boş, `current_user` assign edilmemiş) sadece düz IP limiti uygulanır.
- Aşım durumunda `429 Too Many Requests` + `{"error": "Too many requests. Please try again later."}`.

**Uygulandığı endpoint'ler:**

| Controller/Action | Limit | Key |
|---|---|---|
| `UserController.login` / `.register` | Dakikada **5** istek | IP + `{:param, "email"}` (varsayılan) |
| `UploadController.create` | Dakikada **10** istek | IP (body'de "email" alanı yok, düz IP'ye düşer) |
| `PreviewController.show` | Dakikada **15** istek | IP (düz IP, `:key` verilmemiş) |
| `FriendController.request` | Dakikada **20** istek | IP + `:current_user` — spam/enumeration koruması |
| `InviteController.create` | Dakikada **10** istek | IP + `{:param, "server_id"}` |

**Bilinen Sınırlama — fixed-window pencere sınırında burst:** `Backend.RateLimiter`, Hammer'ın varsayılan algoritması olan `:fix_window`'u kullanıyor (`use Hammer, backend: :ets` — `:algorithm` belirtilmemiş). Bu algoritma, pencereleri **mutlak wall-clock zamanına** (`System.system_time(:millisecond)`, saniyenin/dakikanın kesin sınırına hizalı) göre böler; Hammer'ın kendi kaynak koduna göre bunun bilinen matematiksel sonucu, bir pencere sınırına denk gelen bir burst'ün kısa bir süre içinde limitin **~2 katına kadarını** geçirebilmesidir (ör. 60 saniyede 20 limitiyle: 11:59:59'da 20 istek + 12:00:01'de 20 istek daha = 2 saniyede 40 istek, her ikisi de kendi penceresinde limit dahilinde). Hammer, bu isteniyorsa `:sliding_window` algoritmasını öneriyor. Mevcut limitler (login/register/upload/friend/invite/channel event'leri) için bu risk kabul edilebilir görülüyor çünkü: (1) bu endpoint'lerin hiçbiri tek başına kritik bir kaynağı korumuyor (hepsi "ikinci savunma katmanı", asıl korumalar auth/authorization/DB constraint'leri), (2) limitler zaten cömert taraflı seçildi (gerçek kullanıcı davranışının çok üzerinde), 2 katına çıkması bile pratik bir DoS/brute-force riski oluşturmuyor, (3) `:fix_window`'un tek node'lu ETS backend'iyle birlikte düşük overhead'i, mevcut tek-instance deploy'da basitliğin karmaşıklığa tercih edildiği bilinçli bir seçim. İleride kötüye kullanım paterni gözlenirse (ör. loglarda ardışık pencere sınırı istismarı görülürse), `Backend.RateLimiter`'ı `use Hammer, backend: :ets, algorithm: :sliding_window` ile değiştirmek düşük riskli bir yükseltme — API (`hit/3`) aynı kalıyor, sadece pencere matematiği değişiyor. Bu sınırlama, `test/backend_web/controllers/friend_controller_rate_limit_test.exs`'teki bir test flake'inin kök nedenini araştırırken keşfedildi (bkz. testin kendi yorumu) — o testteki flake'in asıl nedeni bu değildi (test kendi yavaşlığı yüzünden wall-clock ile yarışıyordu, ayrı bir konu, testte düzeltildi), ama araştırma sırasında bu üretim-zamanı sınırlaması netleşti ve buraya kaydedildi.

**Kapsam dışı — bilinçli sınır:** `ServerController`, `ChannelController`, `DmController`'ın geri kalan action'ları (ör. sunucu/kanal oluşturma, mesaj geçmişi/arama) rate limiter **kullanmıyor**; şu ana kadar korunan yüzeyler brute-force'a en açık ikisi (auth, upload) artı spam/enumeration riski taşıyan ikisi (arkadaşlık isteği, davet kodu).

**WebSocket kanal trafiği — `BackendWeb.ChannelRateLimiter` ile çözüldü:** Mesaj gönderme (`shout`) REST üzerinden değil, WebSocket kanalları üzerinden yapılıyor — `BackendWeb.RateLimiterPlug` bir HTTP `Plug` olduğundan kanal `handle_in/3` callback'lerini hiç kapsamıyor. Bunun için `backend/lib/backend_web/channels/channel_rate_limiter.ex` altında `Backend.RateLimiter.hit/3`'ü doğrudan saran ince bir yardımcı modül eklendi (`ChannelRateLimiter.limited?/5`) ve `chat_channel.ex`/`dm_channel.ex`/`voice_channel.ex`'teki ilgili her `handle_in` bunu çağırıyor:

- **Key stratejisi:** her zaman `socket.assigns.user_id` bazlı (IP değil — soket zaten kimliği doğrulanmış, NAT arkasında birden fazla meşru kullanıcı aynı IP'yi paylaşabilir), event tipi ve channel/room/topic ile katmanlanmış — bir kullanıcının bir odadaki spam'i başka bir odasını etkilemiyor.
- **Aşım davranışı:** kanal/bağlantı kapatılmıyor. Reply bekleyen event'ler (`shout`/`update_message`/`toggle_reaction`) `{:reply, {:error, %{reason: "rate_limited"}}, socket}` döner ve broadcast/DB yazma tamamen atlanır. Zaten `{:noreply, socket}` dönen event'ler (`update_status`, `video_offer`/`video_answer`/`ice_candidate`) sessizce (yani ek bir reply eklemeden — bu event'ler için istemci zaten bir reply beklemiyor) sadece kendi etkilerini (Presence güncellemesi / relay) atlıyor. Her iki durumda da `Logger.warning` ile (`user_id` + event adı, **mesaj içeriği hariç**) loglanıyor.
- **Frontend henüz `{:error, %{reason: "rate_limited"}}` cevabını ele almıyor** — `frontend/src/services/socket.ts`'teki ilgili `push()` çağrılarının hiçbirinde bir `.receive("error", ...)` handler'ı yok (yalnızca join response'ları için var). Bu bilinçli olarak bu işin kapsamı dışında bırakıldı çünkü store'ların "tek doğruluk kaynağı broadcast'tir" convention'ını nasıl etkileyeceği ayrıca konuşulmalı; bkz. [Bölüm 7](#7-bilinen-boşluklar--devam-notları).

| Kanal / Event | Limit | Key kapsamı | Gerekçe |
|---|---|---|---|
| `chat_channel.ex` / `dm_channel.ex` `"shout"` | 10 saniyede **15** mesaj | user_id + channel/room id | İnsan yazma hızının kat kat üzerinde — script/flood'u yakalar, gerçek kullanıcıyı kısıtlamaz |
| `chat_channel.ex` / `dm_channel.ex` `"update_message"` | Dakikada **10** düzenleme | user_id + channel/room id | Düzenleme, göndermeden çok daha seyrek bir eylem |
| `chat_channel.ex` / `dm_channel.ex` `"toggle_reaction"` | Dakikada **30** toggle | user_id + channel/room id | Kullanıcılar art arda birkaç reaksiyon ekleyebilir, ama sınırsız değil |
| `voice_channel.ex` `"update_status"` (mute/deafen) | Dakikada **30** güncelleme | user_id + topic | Seyrek, bilinçli bir kullanıcı eylemi — cömert bir üst sınır yeterli |
| `voice_channel.ex` `"video_offer"`/`"video_answer"`/`"ice_candidate"` | 10 saniyede **50** sinyal mesajı | user_id + topic + **peer çifti** (`to` alanı), **üç event tipi arasında paylaşılan tek bucket** | Bir WebRTC negotiation'ı sırasında kısa sürede onlarca ICE candidate üretilmesi normal ve beklenen davranış — limit event tipi başına değil, tek bir peer bağlantısının negotiation'ı başına konuldu ki gerçek trafiği kırmasın, yalnızca bir peer'e yönelik bariz bir flood'u yakalasın |

### 2.4 Multipart Parser Sınırı & Magic-Bytes Doğrulaması

#### Magic-Bytes (Sihirli Bayt) Doğrulaması

**Dosya:** `backend/lib/backend/uploads.ex` (155 satır)

**Desteklenen tipler (`@allowed_extensions`):**

| Content-Type | Uzantı |
|---|---|
| `image/png` | `.png` |
| `image/jpeg` | `.jpg` |
| `image/gif` | `.gif` |
| `image/webp` | `.webp` |

**Doğrulama akışı (`store/1`):** `with` zinciri → `validate_type` → `validate_signature` → `validate_size`.

**Neden gerekli?** Client'ın gönderdiği `Content-Type` header'ı kolayca sahtelenebilir (örn. zararlı bir `.html`/`.svg`/`.exe` dosyasını `image/png` diye etiketleyip yükletme saldırısı). Bu yüzden dosyanın ilk **12 byte**'ı (`@header_bytes_needed = 12`) okunup gerçek dosya imzası kontrol edilir:

```elixir
defp signature_matches?(
       "image/png",
       <<0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, _::binary>>
     ), do: true

defp signature_matches?("image/jpeg", <<0xFF, 0xD8, 0xFF, _::binary>>), do: true

defp signature_matches?("image/gif", <<0x47, 0x49, 0x46, 0x38, _::binary>>), do: true
# "GIF8" — hem GIF87a hem GIF89a'yı kapsar

defp signature_matches?(
       "image/webp",
       <<0x52, 0x49, 0x46, 0x46, _size::binary-size(4), 0x57, 0x45, 0x42, 0x50, _::binary>>
     ), do: true
# RIFF....WEBP

defp signature_matches?(_content_type, _header), do: false
```

**Reddedilen durumlar (hepsi `422 Unprocessable Entity`, `upload_controller.ex:13-37`):**

| Hata | Mesaj |
|---|---|
| `{:error, :unsupported_type}` | "Desteklenmeyen dosya türü. İzin verilenler: PNG, JPEG, GIF, WEBP" |
| `{:error, :invalid_file_signature}` | "Dosya içeriği beyan edilen türle uyuşmuyor" |
| `{:error, :too_large}` | "Dosya çok büyük (maksimum 8MB)" |
| `{:error, :invalid_file}` | "Dosya yüklenemedi" |
| (form'da `%Plug.Upload{}` yok) | `400 Bad Request` — "Yüklenecek dosya bulunamadı" |

**Depolama:** `adapter/0`, `:backend, :uploads` config'inden `:local` (disk, `priv/static/uploads`, `Plug.Static` ile servis edilir) veya `:s3` (S3/R2/Spaces uyumlu, `Backend.Uploads.S3` — SigV4 imzalı, `ex_aws` **kullanmadan** `Req` ile elle yazılmış) seçer.

#### Multipart Parser Sınırı

**`backend/lib/backend_web/endpoint.ex:92-104`:**
```elixir
plug Plug.Parsers,
  parsers: [:urlencoded, :multipart, :json],
  pass: ["*/*"],
  json_decoder: Phoenix.json_library(),
  length: 12_000_000
```

**Neden 12MB, uygulama limiti 8MB iken?** Kod yorumunda (satır 96-103) açıklandığı gibi: Plug'ın multipart parser limiti, uygulamanın 8MB'lık (`@max_size_bytes`, `uploads.ex:25`) limitiyle tam aynı olsaydı, multipart encoding'in boundary/header overhead'i eklendiğinde 8MB'a yakın bir dosya, `Backend.Uploads.store/1`'in kullanıcı dostu hata mesajına hiç ulaşmadan, parser seviyesinde sert bir hata ile reddedilebilirdi. Bu yüzden parser limiti bilinçli olarak **12MB**'a yükseltildi; **gerçek uygulanan sınır her zaman 8MB**'dir (`uploads.ex:135-141`):
```elixir
@max_size_bytes 8 * 1024 * 1024   # 8 MB

defp validate_size(path) do
  case File.stat(path) do
    {:ok, %{size: size}} when size <= @max_size_bytes -> :ok
    {:ok, _too_big} -> {:error, :too_large}
    {:error, _} -> {:error, :invalid_file}
  end
end
```

> ⚠️ **Kullanıcı prompt'undaki iddia hakkında not:** "Multipart parser limiti 12MB'a **çekildi** (yani düşürüldü)" değil — parser limiti **8MB'lık uygulama sınırının üzerine çıkarılarak 12MB'a yükseltildi**, tam tersi bir amaçla: parser'ın 8MB app-level kontrolünden önce yanlış/ham bir hata fırlatmasını önlemek için. DoS önleme burada gerçek app-level 8MB sınırı ve dakikada 10 upload rate-limit'i ile sağlanıyor.

### 2.5 Dependency Sürümleri & CVE Notu

`git log --oneline --all -- backend/mix.lock backend/mix.exs` çıktısında (4 commit: `931807d`, `0014506`, `9d7b043`, `bd4d8d9`) **CVE numarası veya açık bir "güvenlik yaması" commit mesajı bulunmamaktadır.** `mix.exs`/`mix.lock` içinde de CVE referansı içeren yorum satırı yoktur.

> ⚠️ **Kullanıcı prompt'undaki iddia hakkında not:** "8 kritik CVE paketi yamalandı" iddiası kod/commit geçmişinde doğrulanamamıştır — böyle bir doküman veya commit izi bulunamadı, UYDURULMAMIŞTIR. Bunun yerine gerçek durum şudur: proje genel olarak güncel majör sürümleri kullanıyor (Phoenix 1.8.9, Bandit 1.12.0, Ecto 3.14.0 — bkz. [1.1](#11-backend--elixir--phoenix--bandit--ecto) tablosu), ve brute-force/DoS sınıfı saldırılara karşı **rate limiting (Hammer)**, **magic-bytes doğrulama** ve **multipart boyut sınırı** ile korunuyor.

**`mix_audit` + `hex.audit` artık `precommit`'e entegre — iki bağımsız advisory kaynağı, ikisi de gerçek bir gate:** `{:mix_audit, "~> 2.1", only: [:dev, :test], runtime: false}` eklendi (lock: `2.1.5`), ve `mix.exs`'teki `precommit` alias'ı artık `compile --warnings-as-errors` → `deps.audit` → `hex_audit!/1` → `deps.unlock --unused` → `format` → `test` sırasıyla çalışıyor:

- **`mix deps.audit`** (`mix_audit`), `mirego/elixir-security-advisories` GitHub reposunu **her çalıştığında kendisi senkronize ediyor** (`~/.local/share/elixir-security-advisories-mirego`'ya `git clone`/`git pull --rebase` — ayrı bir "fetch" komutu **yok**, senkronizasyon `MixAudit.Repo.synchronize/0` içinde `mix deps.audit`'in kendisine gömülü, kaynak kodundan doğrulandı). **Bu, `deps.audit`'in her precommit çalışmasında `git` + ağ erişimi gerektirdiği anlamına geliyor — CI kurulumunda `git` PATH'te olmalı ve advisory-repo'ya (GitHub) giden trafiğe izin verilmeli**, yoksa senkronizasyon (hata fırlatmadan, `System.cmd` sonucu kontrol edilmiyor) sessizce başarısız olup son senkronize edilen (veya hiç senkronize edilmemiş) veriyle çalışabilir. Bir advisory bulunursa `System.stop(1)` çağırıyor — bu senkron/immediate bir kırılma.
- **`mix hex.audit`** (Hex client'ına gömülü, `mirego/elixir-security-advisories`'ten tamamen bağımsız, OSV.dev/EEF advisory verisini kullanan ayrı bir mekanizma) `precommit`'e `"hex.audit"` string'i olarak DEĞİL, `hex_audit!/1` adlı özel bir `mix.exs` fonksiyonu üzerinden ekli — bunun iki ayrı, kaynak kodundan doğrulanmış nedeni var:
  1. **"task could not be found":** `hex.audit`, Hex archive'ından geliyor (proje bağımlılığı değil); `compile`/`deps.audit` alias'ta ondan önce çalışınca dependency compilation code path'leri budayıp `Code.ensure_loaded(Mix.Tasks.Hex.Audit)`'i `{:error, :nofile}`'a düşürüyor (bilinen bir Elixir/Hex etkileşimi, elixirforum'da doğrulandı).
  2. **Dekoratif kırılma riski:** Hex'in kendi `lib/mix/tasks/hex.ex` kaynağında, bir advisory bulununca `Mix.Tasks.Hex.set_exit_code/1` çağrılıyor, ve bu da (test env dışında) `System.at_exit(fn _ -> System.halt(code) end)` yapıyor — yani VM'in DOĞAL olarak sonlanacağı ana kadar ERTELENMİŞ bir halt. Bu, `mix hex.audit`'i doğrudan alias'a string olarak eklenseydi `precommit`'in genel exit code'unun doğru (non-zero) olacağı ama `deps.unlock`/`format`/**`test`**'in advisory bulunmuş olsa bile SONUNA KADAR çalışmaya devam edeceği anlamına geliyordu — bu ampirik olarak doğrulandı (geçici olarak `mint`'i 1.9.2'ye geri alıp test edildi: `test` 85/85 tamamlandıktan SONRA `mix precommit` exit code 1 verdi). Bu "gerçek bir gate, dekoratif değil" gereksinimini karşılamıyordu.
  
  Çözüm: `hex_audit!/1`, `mix hex.audit`'i **ayrı bir `mix` alt-süreci** (`System.cmd/3`) olarak çalıştırıyor — bu hem (1)'i çözüyor (temiz bir süreç Hex archive'ını sorunsuz yüklüyor) hem de (2)'yi çözüyor (alt-sürecin exit code'u ANINDA kontrol ediliyor ve `Mix.raise/1` ile hemen kırılıyor, Hex'in kendi ertelenmiş halt'ını beklemeden). Aynı senaryoyla (mint 1.9.2) doğrulandı: artık `deps.unlock`/`format`/`test` HİÇBİRİ çalışmadan `mix precommit` anında `** (Mix) mix hex.audit found retired or vulnerable dependencies` ile duruyor.

**Bu turdaki tarama sonucu (mint 1.9.3'e yükseltildikten sonra):**
```
=== mix deps.audit ===
No vulnerabilities found.

=== mix hex.audit ===
No retired or security advisory packages found
```
Her iki kaynak da temiz. `mix precommit` uçtan uca (compile → deps.audit → hex.audit → deps.unlock → format → test, 85/85) sorunsuz geçti.

**Çözülen bulgu — `mint` CVE-2026-59249:** Bir önceki turda `mix hex.audit` (OSV.dev/EEF verisiyle) `mint 1.9.2`'de `EEF-CVE-2026-59249` (MEDIUM, "sign-tolerant HTTP/1 chunk-size parser... response smuggling") buldu; `mix deps.audit`'in o zamanki db'sinde bu CVE henüz yoktu — iki aracın farklı advisory kaynakları kullandığının kanıtı, bu yüzden ikisi de `precommit`'e eklendi. `mint` (`req` → `finch` → `mint` zinciriyle transitive, `mix.exs`'te doğrudan bağımlılık değil) `mix deps.update mint` ile **hedeflenerek** `1.9.3`'e yükseltildi (diğer hiçbir paket etkilenmedi, `mix deps.update mint` çıktısında hepsi "Unchanged"). `1.9.3`'ün bu CVE'yi düzelttiği mint'in kendi `CHANGELOG.md`'sinden doğrulandı: *"Prevent signed integers when parsing HTTP/1 chunk sizes. This is a fix for CVE-2026-59249."*

### 2.6 Güvenlik Header'ları — `BackendWeb.SecurityHeadersPlug`

**Önce netleştirilmesi gereken soru:** bu backend HTML sayfası (frontend build'i) mi serve ediyor, yoksa sadece API/WS/upload mı? `backend_web/router.ex` incelendiğinde tek route grubu `/api/*` altındaki JSON endpoint'leri (+ dev-only `/dev/dashboard` ve `/dev/mailbox`, sadece `Application.compile_env(:backend, :dev_routes)` true iken) ve `endpoint.ex`'teki iki WebSocket soketi (`/socket`, `/live`). Hiçbir yerde `"*path"` gibi bir catch-all route veya `index.html` render'ı yok. `BackendWeb.static_paths/0` (`assets fonts images uploads favicon.ico robots.txt`) `Plug.Static`'e statik olarak neyin serve edilebileceğini söylüyor, ama `backend/priv/static/` içinde fiilen sadece `favicon.ico`, `robots.txt` ve boş bir `uploads/` dizini var — `assets`/`fonts`/`images` dizinleri hiç yok, yani derlenmiş bir frontend bundle'ı bu depoda hiç bulunmuyor. `DEPLOYMENT.md`'ye göre de frontend (React/Vite) **ayrı olarak Vercel'e** deploy ediliyor; backend (Phoenix/Docker) Render/Railway'de çalışıyor ve ikisi `FRONTEND_URL` ile CORS/WS origin üzerinden haberleşiyor. Sonuç: bu backend **sadece JSON API + WebSocket + kullanıcı tarafından yüklenen sohbet görselleri** (`/uploads/*`, `Backend.Uploads` sadece `image/png|jpeg|gif|webp` kabul ediyor) serve ediyor — hiçbir zaman HTML render etmiyor.

Bu netleştirme, CSP kararının temelini oluşturuyor: `BackendWeb.SecurityHeadersPlug` (`backend/lib/backend_web/plugs/security_headers_plug.ex`) `endpoint.ex` pipeline'ında `RequireCloudflarePlug`'dan hemen sonra, `Plug.Static`'ten önce çalışıyor — böylece statik/upload dosyaları dahil **her** response bu header'ları alıyor:

| Header | Değer | Neden |
|---|---|---|
| `x-content-type-options` | `nosniff` | Her zaman — tarayıcının response'un `Content-Type`'ını "sniff" edip farklı yorumlamasını engeller (özellikle `/uploads/*` altında kullanıcı yüklediği dosyalar için önemli) |
| `referrer-policy` | `strict-origin-when-cross-origin` | Her zaman — cross-origin isteklerde tam URL yerine sadece origin sızdırılır |
| `x-frame-options` | `DENY` | Her zaman — backend HTML render etmediği için zararsız, ama clickjacking savunmasını ucuza garantiler |
| `content-security-policy` | `default-src 'none'; img-src 'self'; frame-ancestors 'none'` | Backend'in **sadece** kendi origin'inden görsel (chat attachment) serve ettiği, hiçbir script/style/font/HTML render etmediği doğrulandığı için mümkün olan en sıkı policy — `frame-ancestors 'none'` `x-frame-options` ile aynı korumayı CSP seviyesinde tekrarlıyor |
| `strict-transport-security` | `max-age=31536000; includeSubDomains` | **Sadece `:prod`** — `config/runtime.exs`'te `config :backend, :environment, config_env()` ile runtime'a yazılan bir flag üzerinden (derleme zamanı `Mix.env()`'e değil, `Application.get_env(:backend, :environment)`'a bakılıyor) gate'leniyor; dev'de HTTP üzerinden çalışıldığı için HSTS eklenirse yerel geliştirme kırılır |

Test: `backend/test/backend_web/plugs/security_headers_plug_test.exs` — plug'ı izole `call/2` ile (HSTS'in `:dev`'de yokluğunu, `:prod`'da varlığını `Application.put_env(:backend, :environment, ...)` ile simüle ederek) ve gerçek endpoint pipeline'ı üzerinden hem bir JSON API isteği (`GET /api/servers`, 401) hem de `Plug.Static`'ten servis edilen bir dosya (`GET /robots.txt`, 200) için doğruluyor.

### 2.7 Health Check ve Container Sertleştirme

**Denetim sonucu — Dockerfile zaten iki kriteri karşılıyordu, sıfırdan yazılmadı:**
- **Multi-stage build:** zaten vardı (`builder`/`runner` iki ayrı `FROM`, satır 15/47) — final image'a sadece `mix release`'in derlediği release kopyalanıyor (`COPY --from=builder ... /app/_build/${MIX_ENV}/rel/backend`), `mix`/`hex`/`rebar`/kaynak kod/`deps` cache'i taşınmıyor.
- **Non-root user:** zaten vardı (`USER nobody`, satır 67) — `chown nobody /app` + `COPY --chown=nobody:root` ile.
- **`.dockerignore`:** zaten vardı, `_build/`, `deps/`, `.git/`, `test/`, `*.md` gibi build-dışı içerikleri zaten dışlıyordu.
- **Eksik olan tek şey — HEALTHCHECK direktifi:** yoktu, bu turda eklendi.

**Frontend için ayrı bir Docker image'ı yok — doğrulandı.** `DEPLOYMENT.md`'nin Adım 5'i frontend'in (`Root Directory: frontend`, `Build Command: npm run build`, `Output Directory: dist`) doğrudan **Vercel**'e statik build olarak deploy edildiğini net biçimde söylüyor; backend (Docker) ise Render/Railway'de. Repoda `docker-compose.yml` veya benzeri bir orkestrasyon dosyası da yok.

**Yeni endpoint — `GET /api/healthz` (`BackendWeb.HealthController`):**
- **Kimlik doğrulama gerektirmiyor** — `router.ex`'te `:authenticated` pipeline'ı OLMAYAN scope'a eklendi (register/login ile aynı scope).
- **`RequireCloudflarePlug`'un dışında tutuldu** — bu plug `endpoint.ex` seviyesinde HER isteğe (router'dan önce) uygulanıyor, router-seviyesinde bir "skip" yeterli değildi. `RequireCloudflarePlug`'a `@exempt_paths ["/api/healthz"]` eklendi: Render/Railway'in kendi health check'i Cloudflare'i hiç görmeden konteynere doğrudan istek atar — bu istisna olmasaydı, `CLOUDFLARE_ORIGIN_SECRET` prod'da set edildiği an her health check 403 alır, "unhealthy" görünüp instance'ın döngüsel olarak öldürülüp yeniden başlatılmasına yol açardı.
- **Rate limiting'in dışında** — basitçe hiçbir `BackendWeb.RateLimiterPlug` bu route'a hiç eklenmedi (route-bazlı, opt-in bir mekanizma olduğu için "dışında tutmak" otomatik).
- **Sadece "process ayakta" değil, gerçek DB kontrolü:** `Backend.Repo.query("SELECT 1")` — başarılıysa `200 {"status":"ok","database":"ok"}`, başarısızsa (hata döndürürse VEYA exception fırlatırsa — `rescue` ile ikisi de yakalanıyor, connection pool'da hiç bağlantı yoksa `Repo.query` bir tuple değil exception fırlatabilir) `503 {"status":"error","database":"error"}`.

**Test — gerçek bir "DB koptu" simülasyonu, mock değil:** `Ecto.Adapters.SQL.Sandbox.checkin/1`'in `shared: true` modda (bu proje `async: false` testlerde bunu kullanıyor) hiçbir etkisi olmadığı görüldü — checked-out bağlantı çağıran test process'ine değil, `ConnCase`'in kurduğu ayrı bir **owner** process'ine ait, `checkin` çağıran process'in kendi (var olmayan) checkout'unu iptal ediyor, owner'ınkini değil. Çözüm: `Backend.DataCase.setup_sandbox/1` artık owner pid'ini döndürüyor (`BackendWeb.ConnCase`'in context'ine `sandbox_owner` olarak ekleniyor — geriye dönük uyumlu bir ek, mevcut hiçbir testi bozmadı, `mix precommit` ile doğrulandı), test bu pid'i `Sandbox.stop_owner/1` ile erken durdurup gerçekten "bu process için kullanılabilir bağlantı yok" durumunu üretiyor. `on_exit`'teki ikinci `stop_owner` çağrısı `Process.alive?/1` ile korunuyor (aksi halde test geçse bile `on_exit` zaten-durmuş bir process'i durdurmaya çalışıp hata verirdi).

**HEALTHCHECK — curl/wget YOK, gereksiz paket eklenmedi.** Minimal `debian:bookworm-slim` runtime image'ında ne curl ne wget var, ikisi de eklenmedi (saldırı yüzeyini büyütmemek için). Bunun yerine `Backend.Release.health_check/0` (`rel/overlays/bin/healthcheck` ile çağrılıyor — proje zaten `bin/migrate` için aynı deseni kullanıyordu) `:gen_tcp` (Erlang/OTP'nin `:kernel` uygulamasının parçası, HER zaman mevcut, ekstra dep/paket gerektirmiyor) ile konteynerin kendi `GET /api/healthz`'ine ham bir HTTP isteği atıyor ve yanıtın `"HTTP/1.1 200"` ile başlayıp başlamadığına bakıyor.

**Kritik güvenlik detayı — `eval` vs `rpc`:** `Backend.Release.health_check/0`, `bin/healthcheck` scripti üzerinden **`RELEASE_NAME eval`** ile çağrılıyor, `rpc` ile DEĞİL. `eval` her çağrıda kendi kısa ömürlü, ayrı bir BEAM instance'ı başlatır (çalışan sunucuya hiç dokunmaz); `rpc` ise ifadeyi ÇALIŞAN production node'unun içinde çalıştırır. Fonksiyon içindeki `System.halt/1`'in `eval` ile çağrıldığında sadece bu geçici health-check process'ini kapattığı, `rpc` ile çağrılsaydı **gerçek production sunucusunu anında öldüreceği** — kodun kendi `@doc`'unda açıkça belirtildi, ileride biri "aynı görünüyor" diyip `rpc`'ye çevirmesin diye.

**`mix compile --warnings-as-errors` ve `mix precommit`:** İkisi de temiz geçti — `credo --strict` 0 bulgu, `dialyzer` 0 hata (`health_check/0`'ın hiç geri dönmediğini `@spec health_check() :: no_return()` ile açıkça belirtmek gerekti, yoksa dialyzer'ın `no_local_return` uyarısı `mix precommit`'i kırıyordu), `mix test` **87 passed** (85 eskiden + 2 yeni health check testi).

**Docker build — bu makinede Docker kurulu değil, doğrulandı (`docker --version` hem Bash hem PowerShell'de "command not found"), bu yüzden imaj gerçekten build edilemedi.** Dockerfile ve `bin/healthcheck` syntax'ı elle, satır satır gözden geçirildi: `HEALTHCHECK`'in çok satırlı `\` devamı satır sonu boşluğu içermiyor (`grep -n ' $'` ile doğrulandı — bir Dockerfile'da satır sonu boşluğu devam karakterini bozar), `bin/healthcheck` `bin/migrate` ile birebir aynı, zaten-kanıtlanmış desende (`cat -A` ile LF-only satır sonları doğrulandı), `chmod +x rel/overlays/bin/*` wildcard'ı yeni dosyayı da otomatik kapsıyor (dosya adı eklemeye gerek yok). Yüksek güven var ama **gerçek bir `docker build` ile doğrulanmadı** — bu, bu turun tek eksik doğrulama adımı.

### 2.8 Gözlemlenebilirlik: Yapılandırılmış Log ve Periyodik Metrikler

**Araştırma sonucu (bu turda doğrulandı, tahmin edilmedi):** Ne `config/*.exs`'te ne `mix.exs`'te `logger_json` veya benzeri bir yapılandırılmış-log paketi kuruluydu — sadece Elixir'in varsayılan insan-okunur `:default_formatter`'ı vardı. Eklenecek sürüm hem [hex.pm API'sinden](https://hex.pm/api/packages/logger_json) hem yerel `mix hex.info logger_json` ile doğrulandı: **`logger_json ~> 7.0` (güncel: 7.0.4)**.

**Yapılandırılmış log — SADECE prod:**
- `config/runtime.exs`'in `if config_env() == :prod do` bloğuna eklendi: `config :logger, :default_handler, formatter: {LoggerJSON.Formatters.Basic, metadata: :all}`. `Basic` formatter seçildi — Google Cloud/Datadog/Elastic'e özel değil, herhangi bir log sistemiyle uyumlu genel JSON formatı (Render/Railway'e uyuyor). API, kütüphanenin gerçekten indirilen kaynağından (`deps/logger_json/lib/logger_json/formatter/metadata.ex`) doğrulandı — `:all` değeri gerçekten destekleniyor (`update_metadata_selector(:all, ...)`).
- `config/dev.exs`/`config/config.exs`'in `:default_formatter`'ı (insan-okunur text format) **hiç dokunulmadı** — dev'de JSON okumak can sıkıcı olurdu.
- **Mevcut hiçbir `Logger.info`/`warning`/`error` çağrısı değiştirilmedi** (rate limiter, `RequireCloudflarePlug`, ICE diagnostics dahil) — `logger_json` var olan çağrıları otomatik olarak JSON'a çeviriyor, aynı mesaj metni artık JSON nesnesinin `"message"` alanında.
- `metadata: :all` (config.exs'in `:default_formatter`'ındaki `[:request_id]`'den daha geniş) seçildi ki `Backend.Telemetry.PeriodicReporter`'ın `event`/`active_voice_channels`/... gibi metadata alanları da JSON'da ayrı, aranabilir alanlar olarak çıksın — JSON'a geçmenin asıl amacı bu.
- **credo bulgusu, düzeltildi:** `credo --strict`, `PeriodicReporter`'ın yeni metadata anahtarlarının `config.exs`'teki `:default_formatter` `metadata:` allowlist'inde tanımlı olmadığını yakaladı — bu allowlist'e eklendi (dev'in format string'i `$metadata` içermediği için dev'de bir görsel etkisi yok, ama credo'nun niyeti doğru şekilde belgelemesini sağlıyor, ve prod'un ayrı `metadata: :all` ayarını etkilemiyor).

**Render/Railway log arayüzünde arama:** Prod'da her log satırı artık `{"time": "...", "severity": "info", "message": "...", "metadata": {...}}` şeklinde tek satır JSON. Log görüntüleyicinin JSON/metin arama kutusuna:
- `"event":"periodic_metrics"` — sadece periyodik özet satırlarını filtrelemek için.
- `"candidate_type":"relay"` veya `event=... connection_state=connected` (mesaj metni, ICE diagnostic satırları hâlâ interpolasyonlu düz metin olarak `"message"` alanında) — belirli bir ICE sonucunu aramak için.
- `"event":"periodic_metrics"` + göz taraması ile `ice_relay_count`/`ice_connected_total` oranını zaman içinde takip etmek, TURN sunucusu kararını buna dayandırmak için (bkz. 4.4.1).

**Periyodik metrik özeti — `Backend.Telemetry.PeriodicReporter` (yeni GenServer, `application.ex`'in supervision tree'sine eklendi):**
- Varsayılan **5 dakikada bir** (`@default_interval`, `config :backend, Backend.Telemetry.PeriodicReporter, interval: ...` ile override edilebilir — bkz. `config.exs`'teki yorum satırı) tek bir `Logger.info("periodic metrics summary", event: "periodic_metrics", active_voice_channels: ..., connected_voice_users: ..., ice_relay_count: ..., ice_connected_total: ..., uptime_seconds: ...)` basıyor.
- **Aktif ses kanalı/bağlı kullanıcı sayısı — `Phoenix.Tracker`/`Phoenix.Presence`'ın gerçek bir API sınırı keşfedildi:** Presence'ın "tüm aktif topic'leri listele" diye bir fonksiyonu **yok** (sadece belirli bir topic'i sorgulayan `list/2` var — `deps/phoenix_pubsub/lib/phoenix/tracker.ex`'in gerçek kaynağından doğrulandı). Bu yüzden yeni state icat etmek yerine iki VAR OLAN veri kaynağı birleştirildi: `Backend.Chat.list_voice_channel_ids/0` (yeni, basit bir sorgu — DB'deki tüm `type: "voice"` kanalların id'lerini döner) her voice kanalın id'sini verir, sonra her biri için `Backend.Presence.list("voice:<id>")` çağrılıp en az 1 kişi olan odalar sayılır, kullanıcı sayıları toplanır.
- **Relay oranı — basit bir ETS sayaç, gerekçeli:** `Backend.Telemetry.IceStatsCounter` — `:counters` (sabit boyutlu index önceden ayrılmalı) veya bir `Agent` (tek process'te seri çağrı — burada gereksiz bir overhead, projede zaten `Backend.RateLimiter` için kullanılan ETS deseni hazırken) yerine düz ETS `update_counter/4` seçildi, dakikada birkaç artıştan fazlası olmayan bir sayaç için en basit, projeyle tutarlı çözüm. `BackendWeb.VoiceChannel`'ın `"report_ice_stats"` handler'ı, sadece `connection_state == "connected"` olan sonuçlar için (`"failed"` hiç candidate seçmemiş olabilir, oran hesabına girmemeli) `IceStatsCounter.record_connected(candidate_type == "relay")` çağırıyor. `PeriodicReporter` her tick'te `read_and_reset/0` ile okuyup sıfırlıyor — yani her özet satırı sadece **kendi aralığını** kapsıyor, boot'tan beri toplam değil. Okuma-sonra-sıfırlama arasında mükemmel atomik değil (kabul edilebilir — birkaç haftalık log grep'lemesi için, faturalandırılan/alarm kurulan bir metrik değil).
- **Uptime:** `PeriodicReporter` GenServer'ının kendi `System.monotonic_time(:second)` farkı — `:init.get_status/0` gibi düşük seviyeli bir API'ye gerek yok.
- **Bilinçli olarak SADECE bu — yeni DB tablosu, ayrı analytics altyapısı YOK.** Amaç birkaç hafta boyunca logları grep'leyip tek bir altyapı kararına (TURN sunucusu kurulup kurulmayacağı) veri sağlamak, kalıcı bir telemetri pipeline'ı kurmak değil — kapsam bilinçli olarak burada tutuldu.

**Test — gerçek zamanlamayı ve gerçek Presence verisini doğruluyor, mock değil:**
- `voice_presence_summary/0` public bırakıldı (GenServer'ın kendi zamanlayıcısını beklemeden/mock'lamadan doğrudan çağrılabilsin diye) — gerçek `server_fixture`/`Servers.create_channel` ile oluşturulan voice kanallara gerçek `Backend.Presence.track/4` çağrılarıyla katılımcı eklenip toplamların doğru çıktığı doğrulandı (boş kanalların sayılmadığı ayrı bir testle de kanıtlandı).
- Periyodiklik: 15ms gibi kısa bir interval'la, kayıtsız (uygulamanın kendi supervised singleton'ıyla çakışmayan) bir GenServer instance'ı başlatılıp `ExUnit.CaptureLog.capture_log/2` ile log çıktısı yakalanıp en az 3 kez tetiklendiği doğrulandı. **Gerçek bir tuzak bulundu ve düzeltildi:** `capture_log`'un `:level` seçeneği global `Logger.level/0`'ı (test.exs'te `:warning`) **geçersiz kılmıyor** (kendi dokümantasyonunda açıkça yazıyor) — `:info` seviyesindeki çağrılar hiçbir handler'a ulaşmadan filtreleniyordu. Çözüm: `Logger.put_module_level(PeriodicReporter, :info)` (test sonunda `on_exit` ile temizlenen, modül-bazlı, dokümante edilmiş resmi API) global seviyeyi değiştirmeden sadece bu modülün loglarını geçirdi.
- `IceStatsCounter`'ın kendi artış/okuma/sıfırlama/tablo-yok davranışı ayrı, izole testlerle kapsandı.
- `mix precommit`: **95 test geçti** (87 eskiden + 8 yeni), credo/dialyzer temiz.

### 2.9 TURN Sunucusu Entegrasyonu (Metered.ca)

**Mimari — statik credential, sıfır harici API çağrısı.** `GET /api/voice/turn-credentials` (kimlik doğrulaması zorunlu, `BackendWeb.RateLimiterPlug` ile dakikada 10'a sınırlı, `key: :current_user`) `Backend.Turn.fetch_ice_servers/0`'ı çağırır — bu fonksiyon **hiçbir ağ isteği yapmaz**, sadece `Application.get_env(:backend, :turn_config)`'tan okuduğu statik bir `%{username:, credential:}` çiftinden Metered'in TURN Server ürününün 5 sabit URL'sini (`stun:stun.relay.metered.ca:80`, `turn:global.relay.metered.ca:80`, `turn:global.relay.metered.ca:80?transport=tcp`, `turn:global.relay.metered.ca:443`, `turns:global.relay.metered.ca:443?transport=tcp`) doldurup JSON olarak döner.

**Neden canlı API çağrısı yok — gerçek bir tur içi keşif, ilk tasarımdan dönüş:** İlk denemede `Backend.Turn`, Metered'in `GET /api/v1/turn/credentials?apiKey=...` REST endpoint'ini (resmi dokümantasyonundan doğrulanmış: metered.ca/docs/turn-rest-api/get-credential/) her istekte canlı çağırıyordu — bu, Metered'in **yönetilen video/ses** ürününün dinamik-token API'si. Uçtan uca test sırasında bu endpoint gerçek kullanıcının API key'iyle sürekli `{"error":"Invalid API Key"}` (401) döndürdü; teşhis (key'in kendi içeriği hiç okunmadan/yazdırılmadan — sadece uzunluk/boşluk/tırnak kontrolü ve Metered'in ham hata mesajının doğrudan gösterilmesiyle) kullanıcının aslında **TURN Server** ürününü (dashboard'da "zircle" projesi) satın aldığını ortaya çıkardı — bu ürün dinamik token API'si sunmuyor, tek, kalıcı bir username/credential çifti veriyor. Tasarım buna göre basitleştirildi: `Req`/HTTP çağrısı tamamen kaldırıldı, saf config-tabanlı bir liste üreticisine dönüştürüldü — artık network gecikmesi, timeout, veya Metered tarafındaki bir kesinti hiçbir zaman bu endpoint'i etkilemiyor.

**Config anahtarı:** `config :backend, :turn_config, %{username: ..., credential: ...}` — yerelde `config/dev.secret.exs` (bkz. `dev.secret.exs.example`), prod'da `config/runtime.exs`'in `if config_env() == :prod` bloğunda `METERED_TURN_USERNAME`/`METERED_TURN_CREDENTIAL` env var'larından. İkisinden biri eksikse (veya boş string ise) `Backend.Turn` bunu "yapılandırılmamış" sayıp fallback'e düşer — yarım bir credential çiftini asla göndermez.

**Fallback davranışı:** Config yoksa/eksikse, `Backend.Turn.fetch_ice_servers/0` sadece Metered'in STUN girdisini (`stun:stun.relay.metered.ca:80`) içeren tek elemanlı bir liste döner ve `Logger.warning` ile "Metered TURN yapılandırılmamış" loglar — hata değil, çünkü TURN olmadan da uygulama STUN-only çalışmaya devam eder (bkz. 4.4). Frontend (`useVoiceChannel.ts`'in `fetchBackendTurnServers`'ı) bu endpoint'e her koşulda (config yok, network hatası, herhangi bir exception) sessizce `[]`'e düşer ve kendi statik Google STUN girdisini (`stun:stun.l.google.com:19302`) korur — backend'in döndürdüğü liste her zaman **eklenir**, mevcut statik listenin yerini almaz.

**Ücretsiz katman — düzeltme:** Bu projenin ilk araştırmasında (Metered'in genel fiyatlandırma sayfasından) ücretsiz katmanın 500 MB/ay olduğu doğrulanmıştı, ama kullanıcının **gerçek dashboard'u** TURN Server ürünü için **0.5 GB/ay (kredi kartsız)** gösteriyor — aynı rakam, farklı birim ifadesi, tutarlı. (Önceki bir turda ikinci elden kaynaklardan "20GB/ay" gibi yanlış bir rakam da geçmişti — dashboard'un kendi gösterdiği 0.5GB/ay burada otoriter kabul edildi.) Bu, gerçek kullanıcı trafiğinde TURN'e ne sıklıkla ihtiyaç duyulduğunu izlemenin (bkz. 4.4.1'deki ICE diagnostic logging — `ice_relay_count`/`ice_connected_total`) neden önemli olduğunu somutlaştırıyor: 0.5GB küçük bir kota, aşımı fark etmeden önce veri toplamak gerekiyor.

**Test:**
- `backend/test/backend/turn_test.exs` — `Backend.Turn`'ün saf mantığını izole test ediyor: config yokken/yarım-set'ken/boş string'ken STUN-only, tam set'ken 5 elemanlı tam liste.
- `backend/test/backend_web/controllers/voice_controller_test.exs` — auth zorunluluğu (401), STUN-only fallback'in gerçek HTTP response'unda göründüğü, config geçici olarak `Application.put_env`/`on_exit` ile set edildiğinde tam listenin JSON'da doğru döndüğü.
- `backend/test/backend_web/controllers/voice_controller_rate_limit_test.exs` — dakikada 10 limit sonrası 429 (diğer testlerle IP bucket çakışmasını önlemek için ayrı dosyada, ayrı sahte IP'lerle — bkz. `voice_controller_test.exs`'teki `with_unique_ip/2` yorumu).

**Uçtan uca doğrulama (bu turda):** Backend gerçek `dev.secret.exs` config'iyle başlatıldı, geçerli bir auth token ile `GET /api/voice/turn-credentials` çağrıldı — **gerçek Metered credential'larıyla dolu 5 elemanlı liste** döndü (username/credential `***` ile sansürlenerek, `urls` açık gösterilerek doğrulandı). `e2e/voice-channel.spec.ts` (bkz. 5.4) gerçek backend'e karşı tekrar çalıştırıldı — backend log'unda `GET /api/voice/turn-credentials`'ın **hiçbir "yapılandırılmamış" uyarısı olmadan**, sub-milisaniye sürede (ağ isteği yok, saf hesaplama) 200 döndürdüğü doğrulandı; test yine **1 passed** — aynı makinede iki peer olduğu için ICE yine `host` candidate'ı seçti (TURN relay'e gerek kalmadı), ama TURN endpoint'inin başarıyla çağrıldığı ve listeye eklendiği kanıtlandı.

---

## 3. Veritabanı İş Mantıkları & Performans

### 3.1 Simetrik Arkadaşlık Yarış Durumu (Race Condition)

**Model:** `Backend.Friends` (`backend/lib/backend/friends.ex`, 260 satır) **tek yönlü** bir `Friendship` satırı kullanır — `user_id` isteği gönderen, `friend_id` alıcıdır. Karşılıklı ayrı bir "reciprocal" satır yoktur; `status` `"pending" | "accepted" | "blocked"`.

> ⚠️ **Kullanıcı prompt'undaki iddia hakkında düzeltme:** Bu race condition **`Ecto.Multi` ile çözülmüyor**. Grep ile doğrulandı: **projenin tamamında (`backend/lib` altında) hiçbir yerde `Ecto.Multi` kullanılmıyor.** Bunun yerine "optimistic insert + unique constraint çakışmasını yakala ve yeniden çöz" deseni kullanılıyor — bu, gerçek kodda ne olduğudur ve aşağıda tam olarak açıklanmıştır.

**Changeset — iki katmanlı `unique_constraint` (`backend/lib/backend/friends/friendship.ex:18-34`):**
```elixir
def changeset(friendship, attrs) do
  friendship
  |> cast(attrs, [:user_id, :friend_id, :status])
  |> validate_required([:user_id, :friend_id, :status])
  |> validate_inclusion(:status, ["pending", "accepted", "blocked"])
  |> validate_not_self_friend()
  |> unique_constraint([:user_id, :friend_id])
  |> unique_constraint(:user_id,
    name: :friendships_symmetric_pair_index,
    message: "already have a pending or accepted friendship with this user"
  )
  |> foreign_key_constraint(:user_id)
  |> foreign_key_constraint(:friend_id)
end
```

**Migration tarihçesi (iki aşamalı — önce yönlü, sonra simetrik):**

1. `20260707195157_create_friendships.exs` — ilk hali, **sadece yönlü** çifti korur:
   ```elixir
   create unique_index(:friendships, [:user_id, :friend_id])
   create index(:friendships, [:friend_id])
   ```
   Bu haliyle (A→B) ve (B→A) satırları **aynı anda var olabilirdi** — gerçek çift-kayıt riski buradan doğar.

2. `20260713214401_add_symmetric_unique_index_to_friendships.exs` — bunu kapatan **ifade (expression) unique index**:
   ```elixir
   create unique_index(
            :friendships,
            ["LEAST(user_id, friend_id)", "GREATEST(user_id, friend_id)"],
            name: :friendships_symmetric_pair_index
          )
   ```
   `LEAST`/`GREATEST` ile karşılaştırma normalize edilir, ama satırın gerçek `user_id`/`friend_id` değerlerine dokunulmaz. Migration'ın moduledoc'u bunun neden bir DB trigger veya satırları fiziksel olarak yeniden sıralama yerine bu şekilde yapıldığını açıklar: `user_id`/`friend_id` "kim gönderdi" anlamı taşır (yön, yetkilendirme için kullanılır) — fiziksel olarak yeniden sıralamak uygulama mantığını bozardı.

**Uygulama katmanındaki çözüm — `create_pending/2` (`friends.ex:199-224`):**

`send_request/2` → `resolve_request/3` → (eşleşen satır yoksa) `create_pending/2`. Insert `{:error, changeset}` dönerse ve `changeset.errors` içinde `:user_id` anahtarı varsa (simetrik index adıyla eşleşen hata), bu "aynı çift için eşzamanlı bir `send_request/2`'ye karşı yarışı kaybettim" anlamına gelir. Kod bunu böyle yorumlayıp `find_between/2` ile artık görünür olan satırı çeker ve `resolve_request/3`'ü **tekrar** çalıştırır (genellikle "karşılıklı istek → otomatik kabul" dalına düşer):

```elixir
# create_pending/2 içindeki hata yakalama (satır 210-218 yorumu):
# "Lost a race against a concurrent send_request/2 for the same pair
#  (in either direction) — the other insert already won ... resolve
#  against whatever it just created instead of surfacing a spurious
#  uniqueness error."
```

**Test kanıtı:** `backend/test/backend/friends_test.exs` içinde bu senaryo doğrudan test ediliyor — "eşzamanlı karşılıklı isteklerin tek arkadaşlığa çözülmesi" (race condition testi), ayrıca duplicate/ters-yönlü duplicate reddi.

### 3.2 DM Room Kanonik Çift Mantığı — Farklı Bir Yaklaşım

`Backend.DirectMessages.canonical_pair/2` (`direct_messages.ex:322-323`):
```elixir
def canonical_pair(a, b) when a <= b, do: {a, b}
def canonical_pair(a, b), do: {b, a}
```

Burada friendships'ten **farklı olarak DB'de ayrı bir simetrik expression index YOK** — çünkü `DmRoom` şemasının `user_one_id`/`user_two_id` alanları friendships'in `user_id`/`friend_id`'sinin aksine **anlam taşımaz** (kim DM'i başlattığı önemli değildir). Uygulama katmanı, insert etmeden önce zaten kanonik (low, high) sıraya sokar (`dm_room.ex` moduledoc: *"user_one_id/user_two_id must already be in canonical (sorted) order ... so the same two people always map to the same row regardless of who opened the DM."*).

**Migration** (`20260707200510_create_dm_rooms.exs`):
```elixir
create unique_index(:dm_rooms, [:user_one_id, :user_two_id])
create index(:dm_rooms, [:user_two_id])
```

**Race koruması:** `get_or_create_room/2` → `Repo.get_by` ile arar, yoksa `insert_room/2` dener; insert çakışırsa (`changeset.errors`'ta `:user_one_id`), `Repo.get_by!` ile zaten oluşmuş satır çekilir — friendships ile birebir aynı "optimistic insert + kaybedeni yeniden çözümle" deseni, ama tek katmanlı (expression index'e gerek yok).

### 3.3 Migration Tarihçesi & İndeks Yönetimi

**Tüm migration'lar (kronolojik, `backend/priv/repo/migrations/*.exs`):**

| Migration | Tablo | İndeks / Değişiklik |
|---|---|---|
| `20260702225625_create_users` | users | `unique_index([:email])`, `unique_index([:username])` |
| `20260702225626_create_messages` | messages | `index([:user_id])` |
| `20260703210637_create_channels` | channels | `unique_index([:name])` (global — sonra değişecek) |
| `20260703210638_add_channel_id_to_messages` | messages | `+channel_id`, `index([:channel_id])` |
| `20260703222123_create_servers` | servers | `index([:owner_id])` |
| `20260703222124_create_server_members` | server_members | `unique_index([:server_id,:user_id])`, `index([:user_id])` |
| `20260703222125_add_server_and_type_to_channels` | channels | `+server_id`, `+type`; **`drop_if_exists index([:name])`** → `unique_index([:server_id,:name])` (kanal adları artık sunucu içinde unique) |
| `20260705211807_create_server_invites` | server_invites | `unique_index([:code])`, `index([:server_id])` |
| `20260705220711_add_file_fields_to_messages` | messages | `+file_url`, `+file_type` |
| `20260705222628_make_message_content_optional` | messages | `content` nullable |
| `20260707195157_create_friendships` | friendships | `unique_index([:user_id,:friend_id])`, `index([:friend_id])` |
| `20260707200510_create_dm_rooms` | dm_rooms | `unique_index([:user_one_id,:user_two_id])`, `index([:user_two_id])` |
| `20260707200511_create_dm_messages` | dm_messages | `index([:dm_room_id])` |
| `20260710120000_create_message_reactions` | message_reactions | `index([:message_id])`, `unique_index([:message_id,:user_id,:emoji])` |
| `20260710120001_create_dm_message_reactions` | dm_message_reactions | `index([:dm_message_id])`, `unique_index([:dm_message_id,:user_id,:emoji])` |
| `20260710130000_add_token_valid_from_to_users` | users | `+token_valid_from :utc_datetime` |
| `20260710140000_widen_token_valid_from_precision` | users | `token_valid_from` → `:utc_datetime_usec` (saniye hassasiyeti yetersizdi) |
| `20260713115959_widen_message_timestamps_precision` | messages, dm_messages | `inserted_at` → `:utc_datetime_usec` |
| `20260713120000_add_cursor_indexes_to_messages` | messages, dm_messages | `drop index([:channel_id])` → `index([:channel_id,:inserted_at,:id])`; aynısı dm_messages için |
| `20260713130000_add_seq_to_messages` | messages, dm_messages | `+seq :bigserial`, `index([:channel_id,:seq])`, `index([:dm_room_id,:seq])` — **`inserted_at`'in Windows dev ortamında saat çözünürlüğü yetersiz kaldığı için eklendi** (moduledoc) |
| `20260713214401_add_symmetric_unique_index_to_friendships` | friendships | `friendships_symmetric_pair_index` (bkz. 3.1) |
| **`20260713215219_drop_unused_cursor_indexes`** | messages, dm_messages | **ÖLÜ İNDEKS TEMİZLİĞİ** — aşağıda detaylı |
| `20260714120000_add_is_edited_to_messages` | messages, dm_messages | `+is_edited :boolean` (Faz 10 — bkz. [6.1](#61-mesaj-düzenleme-message-editing)) |
| `20260714130000_add_parent_id_and_position_to_channels` | channels | `+parent_id` (self-ref, `on_delete: :nilify_all`), `+position`, `index([:parent_id])` (Faz 10 — bkz. [6.2](#62-kanal-kategorileri-channel-categories)) |
| `20260715000000_replace_token_valid_from_with_token_version` | users | `-token_valid_from`, `+token_version :integer default 0` — token iptali artık wall-clock karşılaştırması değil, tamsayı sürüm eşitliği (bkz. aşağıdaki not) |

**Ölü indeks kaldırma örneği — `20260713215219_drop_unused_cursor_indexes.exs`:**

```elixir
drop index(:messages, [:channel_id, :inserted_at, :id])
drop index(:dm_messages, [:dm_room_id, :inserted_at, :id])
```

Moduledoc'ta açıkça belirtilir: bu composite indeksler bir önceki migration'da (`20260713120000`) eklenmişti, ama **hemen ardından** (`20260713130000`) `seq` tabanlı bir monoton sıra alanı eklenip cursor sayfalama ona geçirilince, `(channel_id, inserted_at, id)` indeksleri **hiçbir sorgu tarafından hiç kullanılmadı** — buna rağmen her INSERT bu indeksleri güncellemeye devam ediyordu (yazma maliyeti, okuma faydası olmadan). Bu yüzden bir sonraki migration'da drop edildiler. **`seq` neden `inserted_at` yerine tercih edildi?** Çünkü `inserted_at`'in çözünürlüğü (özellikle Windows dev ortamında) art arda gönderilen mesajlar arasındaki sırayı güvenilir şekilde ayırt edemiyordu; `seq` ise DB-atanan (`read_after_writes: true`, `:bigserial`), asla client tarafından set edilemeyen, gerçek gönderim sırasını yansıtan monoton bir sayaçtır.

### 3.4 `SlowQueryLogger` — Yavaş Sorgu İzleme

**Dosya:** `backend/lib/backend/slow_query_logger.ex` (35 satır, tam):
```elixir
defmodule Backend.SlowQueryLogger do
  @slow_query_threshold_ms 200
  @handler_id "backend-slow-query-logger"

  def attach do
    case :telemetry.attach(@handler_id, [:backend, :repo, :query], &__MODULE__.handle_event/4, nil) do
      :ok -> :ok
      {:error, :already_exists} -> :ok
    end
  end

  def handle_event(_event_name, %{total_time: total_time}, metadata, _config) do
    total_time_ms = System.convert_time_unit(total_time, :native, :millisecond)
    if total_time_ms >= @slow_query_threshold_ms do
      Logger.warning("Slow query (#{total_time_ms}ms): #{metadata.query}")
    end
  end
end
```
- Eşik: **200ms**. `[:backend, :repo, :query]` telemetry event'ine (Ecto'nun otomatik yaydığı) attach olur.
- `Backend.Application.start/2` içinde (`backend/lib/backend/application.ex:15`) çağrılır — `Logger.add_handlers(:backend)`'ten hemen sonra, supervisor tree başlamadan önce.
- **Gerekçe:** Production'da Ecto'nun kendi per-query debug loglaması normalde kapalıdır (çok gürültülü olurdu); bu modül bunun yerine sadece "önemli ölçüde yavaş" sorguları `Logger.warning` seviyesinde loglar. Config dosyalarında (`config.exs`, `dev.exs`, `test.exs`, `prod.exs`, `runtime.exs`) `Backend.Repo` için ayrı bir `:log` seviyesi ayarı **yoktur** — tüm izleme bu tek telemetry handler'ı üzerinden yapılır.

### 3.5 Repo Konfigürasyonu

```elixir
# backend/lib/backend/repo.ex — tam dosya
defmodule Backend.Repo do
  use Ecto.Repo,
    otp_app: :backend,
    adapter: Ecto.Adapters.Postgres

  @impl Ecto.Repo
  def init(_context, config) do
    {:ok, maybe_add_https_hostname_check(config)}
  end

  defp maybe_add_https_hostname_check(config) do
    ssl_opts = Keyword.get(config, :ssl_opts)

    if ssl_opts && Keyword.get(ssl_opts, :verify) == :verify_peer do
      updated_ssl_opts =
        Keyword.put(ssl_opts, :customize_hostname_check,
          match_fun: :public_key.pkix_verify_hostname_match_fun(:https)
        )

      Keyword.put(config, :ssl_opts, updated_ssl_opts)
    else
      config
    end
  end
end
```

| Ortam | Ayarlar |
|---|---|
| `config.exs` (tüm ortamlar) | `migration_primary_key: [type: :binary_id]`, `migration_foreign_key: [type: :binary_id]` — **tüm tablolarda `id` UUID'dir**, integer değil |
| `dev.exs` | `pool_size: 10`, `stacktrace: true`, `show_sensitive_data_on_connection_error: true` |
| `test.exs` | `pool: Ecto.Adapters.SQL.Sandbox`, `pool_size: System.schedulers_online() * 2` |
| `runtime.exs` (prod) | `ssl: true`, `url: DATABASE_URL` (zorunlu, yoksa raise), `pool_size` `POOL_SIZE` env var ile override edilebilir (varsayılan 10), `ECTO_IPV6=true/1` ise `socket_options: [:inet6]`. `ssl_opts` artık `DATABASE_SSL_VERIFY` env var'ına göre kuruluyor (varsayılan **`verify_peer`** — güvenli taraf): `cacerts: :public_key.cacerts_get()` (OTP'nin sistem CA bundle'ı) kullanır, ya da `DATABASE_CA_CERT_FILE` set edilmişse onun yerine `cacertfile: <path>`; `server_name_indication` `DATABASE_URL`'den parse edilen host'tur. `DATABASE_SSL_VERIFY=verify_none` set edilirse eski davranışa (sertifika doğrulaması yok) dönülür, ama `Backend.Application.start/2` boot sırasında `Logger.warning` ile bunu açıkça loglar (bkz. [Bölüm 7](#7-bilinen-boşluklar--devam-notları), madde 4) |

**`Backend.Repo.init/2` — HTTPS-profilli wildcard hostname eşleşmesi (Render'da gerçek bir prod kesintisinden sonra eklendi):** Render'ın managed Postgres'i, bağlanılan hostname için wildcard bir SAN sertifikası sunuyor (örn. `*.frankfurt-postgres.render.com`) — gerçek deploy'da bu, her auto-deploy'da backend'i şu hatayla çökertti: `{bad_cert, {hostname_check_failed, {requested, "dpg-....frankfurt-postgres.render.com"}, {received, [...wildcard SAN'lar...]}}}`. Kök neden: Erlang'ın varsayılan TLS hostname kontrolü bu wildcard eşleşmesini kabul etmiyor; `:public_key.pkix_verify_hostname_match_fun(:https)` (RFC 6125'in HTTPS profili, wildcard'ları açıkça destekliyor) `customize_hostname_check` seçeneği olarak verilmesi gerekiyor.

**Bunun neden `config/runtime.exs`'e değil, `Backend.Repo.init/2`'ye eklendiğini anlamak kritik:** `config/runtime.exs`, release boot'unda Elixir'in `Config.Provider` (`Config.Reader`) mekanizmasıyla çalıştırılıyor ve sonucu bir dosyaya **metin olarak** persist ediyor (`elixir/lib/config/provider.ex`'in `write_config!/2`'si, `:io_lib.format("~tw", ...)` kullanıyor, sonra bir sonraki boot'ta `:file.consult` ile geri okunuyor) — `Config.Provider`'ın kendi moduledoc'u bunu açıkça söylüyor: *"Entries such as PIDs, references, and functions cannot be serialized."* `customize_hostname_check`'in gerektirdiği `match_fun` değeri gerçek bir Erlang fun'ı olduğundan, bunu doğrudan `runtime.exs`'in ürettiği `ssl_opts`'a koymak bir sonraki release boot'unda `:file.consult` çözümlemesini kırıp konteyneri **hiç ayağa kalkamadan** çökertirdi (aynı sınıf hata, bağımsız olarak [elixir-ecto/postgrex#608](https://github.com/elixir-ecto/postgrex/issues/608)'de de bildirilmiş — "Could not read configuration file. It has invalid configuration terms such as functions, references, and pids."). Bunun yerine `Ecto.Repo`'nun resmi `init/2` callback'i kullanıldı (`Ecto.Repo.Supervisor`, repo modülünde `init/2` varsa `function_exported?/3` ile otomatik çağırıyor — bkz. `deps/ecto/lib/ecto/repo/supervisor.ex`) — bu, Config.Provider'ın metin-tabanlı persist adımından SONRA, normal uygulama kodu olarak çalışıyor, yani fun değeri güvenle taşınabiliyor. Sadece `verify: :verify_peer` dalını etkiliyor (`verify_none`'a hiç dokunmuyor) ve dev/test'te `ssl_opts` hiç set edilmediğinden orada no-op. Doğrulama: `backend/test/backend/repo_test.exs` (4 test — verify_peer/verify_none/ssl_opts-yok/`:runtime` context) + `Config.Reader.read!/2` ile gerçek `runtime.exs`'i simüle edip `Backend.Repo.init/2`'den geçirerek uçtan uca `ssl_opts`'un doğru şekillendiği manuel olarak da doğrulandı.

**Önemli öğrenim — bu neden bir önceki turdaki yerel testte hiç ortaya çıkmadı:** Bu makinedeki yerel PostgreSQL kurulumu (native, TLS'siz, `sslmode` hiç devrede değil) hiçbir zaman bir SSL/TLS handshake'i, dolayısıyla hostname/sertifika doğrulamasını hiç test etmedi — `mix precommit`/`mix test` tamamen bu TLS yolunun dışında kalıyor. `DATABASE_SSL_VERIFY=verify_peer`'in kendisi daha önce (bkz. madde 4 altında) sadece "genel CA doğrulaması çalışıyor mu" diye soyut olarak doğrulanmıştı, gerçek bir sağlayıcının SAN/wildcard sertifika şekliyle hiç karşılaşmamıştı. Bu, "yerelde/testte çalışıyor ama gerçek bir bulut sağlayıcısında çalışmıyor" sınıfı bir sürpriz — yerel Postgres kurulumu TLS'siz olduğu sürece, TLS'e özgü herhangi bir davranış (sertifika zinciri, SNI, hostname eşleşme kuralları) sadece gerçek bir managed Postgres'e karşı ilk deploy'da ortaya çıkabilir; ileride TLS'e dokunan bir değişiklik yapılırsa bunu yerel bir doğrulama olmadan "test edildi" saymamak gerekir.

---

## 4. WebRTC Ses Kanalları & Perfect Negotiation

### 4.1 `joinGenerationRef` — Hızlı Arka Arkaya Tıklama Kalkanı

**Dosya:** `frontend/src/hooks/useVoiceChannel.ts` (660 satır)

**Tanım (satır 153):**
```ts
// Bumped by every leave() (including the one join() always starts with —
// see both below) — lets an in-flight join() recognize, after each
// await, that it's been superseded (a *different* join() started, the
// active room disappeared, the hook unmounted, ...) and bail out instead
// of clobbering newer state or leaking this attempt's own mic stream/
// channel/analyser.
const joinGenerationRef = useRef(0);
```

**Mekanizma:**
1. `leave()` her çağrıldığında `joinGenerationRef.current += 1` yapar (satır 534) — hem bir odadan gerçekten ayrılırken hem de her `join()` çağrısının **kendisi tarafından** başlangıçta çağrılır (temiz state garantisi için).
2. `join(roomId)` (satır 566-640) önce `leave()` çağırır (bu sayacı arttırır), sonra kendi "nesil numarasını" yakalar: `const myGeneration = joinGenerationRef.current;`.
3. Her `await` noktasından **sonra** (mikrofon izni alındıktan sonra VE voice kanalına Phoenix join'i tamamlandıktan sonra), `joinGenerationRef.current !== myGeneration` kontrolü yapılır:
   ```ts
   stream = await navigator.mediaDevices.getUserMedia({ audio: true });
   if (joinGenerationRef.current !== myGeneration) {
     // Kullanıcı mikrofon izni beklenirken başka bir kanala tıkladı —
     // bu attempt'in stream'ini hemen durdur, hiçbir state'e yazma.
     stream.getTracks().forEach((track) => track.stop());
     return;
   }
   // ...
   const { leave: leaveChannel, existingPeerIds } = await joinVoiceChannel(roomId, {...});
   if (joinGenerationRef.current !== myGeneration) {
     // Kanal join'i beklenirken supersede edildi — az önce join olunan
     // odadan ayrıl, mic stream'i durdur, hiçbir şey ata.
     leaveChannel();
     stream.getTracks().forEach((track) => track.stop());
     stopWatchingSpeaking(user.id);
     return;
   }
   ```
4. Eğer hiçbir zaman supersede edilmezse, `leaveVoiceRef.current = leaveChannel; setActiveRoomId(roomId);` ile state güncellenir ve odadaki mevcut herkese (`existingPeerIds`) `callPeer` çağrılır.

**Neden bu gerekli?** Kullanıcı A odasına tıklar (mikrofon izni bekleniyor) → hemen ardından B odasına tıklar. İkinci tıklama `leave()`'i tetikler (sayaç: 0→1), sonra kendi `join()`'ini başlatır (`myGeneration = 1`). Birinci `join()` çağrısı (`myGeneration = 0`) mikrofon izni geldiğinde uyanır ama `joinGenerationRef.current` artık `1`'dir — kendi `stream`'ini kapatıp sessizce çıkar, B odasına ait state'i asla ezmez. Bu olmasaydı, A'nın gecikmiş `getUserMedia` yanıtı B'ye bağlıyken `activeRoomId`'yi A'ya geri çevirebilir ve bir mikrofon stream'i sızdırabilirdi.

### 4.2 Perfect Negotiation — Uygulanan Varyant

> ⚠️ **Kullanıcı prompt'undaki iddia hakkında düzeltme:** Kodda **`onnegotiationneeded` event handler'ı, `makingOffer` flag'i veya `ignoreOffer` flag'i YOKTUR** (dosyanın tamamı okunarak doğrulandı — bu üç identifier hiçbir yerde geçmiyor). Negotiation, tarayıcının otomatik `negotiationneeded` event'i yerine **uygulama kodu tarafından açıkça** tetiklenir (`callPeer`, `restartIceForPeer`, ekran paylaşımı başlat/durdur). Ancak Perfect Negotiation'ın **çekirdek fikri** — glare durumunda peer ID karşılaştırmasıyla polite/impolite rol belirleme ve `setLocalDescription({type:'rollback'})` ile kurtarma — **gerçekten uygulanmıştır**, sadece flag tabanlı değil `pc.signalingState` tabanlı bir varyantla.

**Glare'ı önce tasarımla engelleme:** Yeni katılan kullanıcı odadaki herkesi arar, tersi olmaz — `join()` yorumunda (satır 622-624): *"We're the newcomer: call everyone already in the room so each pair negotiates exactly once (no simultaneous offer/offer glare)."* Backend tarafında bu, `voice_channel.ex:23-25`'te `existing_peers`'in katılımcı Presence'a eklenmeden **önce** yakalanmasıyla garanti edilir.

**Glare gerçekten oluşursa (esas olarak iki taraf da aynı anda ICE restart tetiklediğinde) — `handleOffer`, satır 375-417:**
```ts
async function handleOffer(payload: VoiceSignalPayload) {
  if (payload.to !== user.id || !payload.sdp) return;
  const pc = await getOrCreatePeerConnection(payload.from);

  // Glare: iki taraf da aynı anda offer gönderdi (genelde aynı bozulmuş
  // bağlantı için ikisi de ICE restart başlatmış). setRemoteDescription
  // burada InvalidStateError fırlatır çünkü zaten bekleyen bir local
  // offer var. Bunu perfect negotiation'ın yaptığı gibi peer id
  // karşılaştırmasıyla çöz: leksikografik olarak büyük id "impolite"tir
  // ve kendi offer'ını korur (gelen offer'ı düşürür — çünkü karşı taraf
  // simetrik olarak bizimkini kabul edecektir), küçük id ise "polite"tir
  // ve gelen offer'ı kabul etmek için kendi offer'ını rollback eder.
  const isGlare = pc.signalingState === 'have-local-offer';
  const isImpolite = user.id > payload.from;

  if (isGlare && isImpolite) return;

  try {
    if (isGlare) {
      await pc.setLocalDescription({ type: 'rollback' });
    }
    await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
  } catch {
    // Rollback çakışmayı temiz çözemedi — bağlantıyı bozuk bir
    // signaling state'te bırakma, bu offer'ı cevaplamak yerine kısa
    // bir gecikmeyle taze bir ICE restart tetikle.
    window.setTimeout(() => {
      const current = peersRef.current.get(payload.from);
      if (current) void restartIceForPeer(payload.from, current);
    }, GLARE_RECOVERY_DELAY_MS);
    return;
  }

  flushPendingCandidates(payload.from, pc);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  sendVoiceAnswer({ from: user.id, to: payload.from, sdp: answer });
}
```

**`callPeer` (ilk offer, satır 342-347):**
```ts
async function callPeer(peerId: string) {
  const pc = await createPeerConnection(peerId);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  sendVoiceOffer({ from: user.id, to: peerId, sdp: offer });
}
```

**ICE restart / reconnect (`onconnectionstatechange`, satır 296-331):**
- `'disconnected'` → "reconnecting" işaretlenir, `ICE_DISCONNECT_GRACE_MS = 3000` ms beklenir (çünkü "disconnected" genelde geçicidir), sonra state tekrar kontrol edilip `restartIceForPeer` çağrılır.
- `'failed'` → beklemeden hemen `restartIceForPeer`.
- `'connected'` → bekleyen reconnect timer'ı temizler.
- `'closed'` → `closePeer(peerId)`.

```ts
async function restartIceForPeer(peerId: string, pc: RTCPeerConnection) {
  try {
    pc.restartIce();
    const offer = await pc.createOffer({ iceRestart: true });
    await pc.setLocalDescription(offer);
    sendVoiceOffer({ from: user.id, to: peerId, sdp: offer });
  } catch {
    closePeer(peerId);
  }
}
```

**ICE candidate kuyruklaması (`handleIceCandidate`, satır 427-437):** `remoteDescription` henüz set edilmemişse, gelen candidate `pendingCandidatesRef` içinde kuyruklanır ve `remoteDescription` set edildikten sonra `flushPendingCandidates` ile uygulanır.

**Mute/Deafen:** `toggleMute()` yerel audio track'lerin `enabled` bayrağını değiştirir + `sendVoiceStatus` gönderir. `toggleDeafen()` açıldığında mikrofonu da zorla susturur (Discord'daki gibi); ses kapatma işleminin kendisi `Chat.tsx` içinde `<audio>` elementlerinin `muted` özelliğiyle yapılır, bu hook'ta değil.

**Ekran paylaşımı:** `startScreenShare()`/`stopScreenShare()` her peer connection'a track ekler/çıkarır ve her biri için ayrı ayrı yeniden `createOffer`/`setLocalDescription`/`sendVoiceOffer` ile renegotiate eder. Yeni bir peer connection kurulurken zaten aktif bir ekran paylaşımı varsa, track proaktif olarak eklenir (satır 265-270) — geç katılan biri paylaşımı baştan görür.

### 4.3 Backend: `voice_channel.ex` — Sinyal Röle Katmanı

**Dosya:** `backend/lib/backend_web/channels/voice_channel.ex` (88 satır, tam)

```elixir
@impl true
def join("voice:" <> room_id, _params, socket) do
  case Chat.get_channel(room_id) do
    nil ->
      {:error, %{reason: "channel not found"}}

    channel ->
      if Servers.member?(channel.server_id, socket.assigns.user_id) do
        # Peers already tracked in this room before we track ourselves
        # below — the joining client uses this list to initiate WebRTC
        # offers, so each pair only negotiates once (no offer/offer glare).
        existing_peers = socket |> Presence.list() |> Map.keys()
        send(self(), :after_join)
        {:ok, %{peers: existing_peers}, socket}
      else
        {:error, %{reason: "not authorized"}}
      end
  end
end

@impl true
def handle_info(:after_join, socket) do
  {:ok, _} =
    Presence.track(socket, socket.assigns.user_id, %{
      username: socket.assigns.username,
      online_at: System.system_time(:second),
      muted: false,
      deafened: false
    })

  push(socket, "presence_state", Presence.list(socket))
  {:noreply, socket}
end
```

**`handle_in` event tablosu:**

| Event | Davranış |
|---|---|
| `"update_status"` | `muted`/`deafened`'i çağıranın kendi Presence metadata'sına `Presence.update/3` ile merge eder — Presence'ın kendi `presence_diff` broadcast'i devreye girer, özel bir event yayınlanmaz |
| `"video_offer"` | `broadcast_from!(socket, "video_offer", Map.put(payload, "from", socket.assigns.user_id))` |
| `"video_answer"` | `broadcast_from!(socket, "video_answer", Map.put(payload, "from", socket.assigns.user_id))` |
| `"ice_candidate"` | `broadcast_from!(socket, "ice_candidate", Map.put(payload, "from", socket.assigns.user_id))` |

Üç sinyal event'i de **opak röle**dir — sunucu `sdp`/`candidate` içeriğini incelemez, sadece `"from"`'u kimliği doğrulanmış `socket.assigns.user_id` ile **her zaman ezerek** üzerine yazar (bir client'ın başka bir kullanıcı kimliğine bürünerek sahte sinyal mesajı gönderememesi için). `"to"` alanı client'ın gönderdiği gibi geçirilir ve sadece client tarafında filtrelemede kullanılır — **odadaki herkes her sinyal broadcast'ini alır**, `payload.to !== user.id` kontrolü frontend'de yapılır.

> ⚠️ **Backend'de duplicate-join koruması YOK:** `join/3` sadece kanal varlığını (`Chat.get_channel/1`) ve sunucu üyeliğini (`Servers.member?/2`) kontrol eder — "bu `user_id` bu odada zaten track edilmiş mi" kontrolü **yapılmaz**. Aynı kullanıcı iki sekmeden aynı anda join olursa, her ikisi de kendi Phoenix channel process'ini oluşturur ve aynı `user_id` key'iyle `Presence.track` çağırır; `Phoenix.Presence` aynı key için birden fazla meta'yı destekler (reddetmez/dedupe etmez) — bkz. [Bölüm 7](#7-bilinen-boşluklar--devam-notları).

### 4.4 TURN/STUN — Dinamik-Öncelikli İki Kademeli Yapı + STUN Fallback

**Tamamen frontend tarafında** (`useVoiceChannel.ts:32-100`) yönetilir — repo'da TURN kimlik bilgisi veren bir backend endpoint/controller **yoktur**.

**Çözümleme sırası (`resolveIceServers`, satır 78-91):**
1. **Dinamik (yönetilen TURN sağlayıcısı):** `VITE_TURN_API_URL` set edilmişse, `fetchDynamicIceServers()` bu URL'den JSON çeker (hem düz bir dizi — Metered.ca tarzı — hem `{ iceServers: [...] }` — bir backend proxy'si arkasındaki Xirsys tarzı bir sağlayıcı — kabul edilir). `withTimeout()` ile sarmalanmış, `ICE_SERVERS_FETCH_TIMEOUT_MS = 4000` ms.
2. **Statik tek TURN sunucusu:** `buildStaticIceServers()` — her zaman Google'ın herkese açık STUN'unu (`stun:stun.l.google.com:19302`) içerir, artı `VITE_TURN_URL`/`VITE_TURN_USERNAME`/`VITE_TURN_PASSWORD` üçü birden set edilmişse statik bir coturn-tarzı TURN girişi.
3. **Sadece STUN fallback:** Ne #1 ne #2 konfigüre edilmemişse veya fetch başarısız/timeout olursa.

```ts
async function resolveIceServers(): Promise<RTCIceServer[]> {
  const apiUrl = import.meta.env.VITE_TURN_API_URL;
  if (apiUrl) {
    try {
      const servers = await withTimeout(fetchDynamicIceServers(apiUrl), ICE_SERVERS_FETCH_TIMEOUT_MS);
      if (servers.length > 0) return servers;
    } catch (err) {
      console.warn('TURN API\'sinden ICE sunucuları alınamadı, statik yapılandırmaya dönülüyor:', err);
    }
  }
  return buildStaticIceServers();
}
```

Sonuç sekme başına **bir kez** hesaplanıp cache'lenir (`iceServersPromise`/`getIceServers()`, satır 95-100) — sekmedeki her peer connection aynı çözülmüş listeyi/kimlik bilgilerini paylaşır, tekrar tekrar fetch edilmez.

#### 4.4.1 ICE Diagnostic Logging — TURN Kararını Veriye Dayandırmak İçin

**Neden eklendi:** Şu an sadece herkese açık bir STUN sunucusu var, yönetilen bir TURN sunucusu yok (bkz. yukarısı ve `DEPLOYMENT.md`'nin "Bilinen Sınırlamalar" bölümü) — simetrik NAT/kısıtlayıcı ağlar arkasındaki gerçek kullanıcılar için bağlantı hiç kurulamayabilir. Bir TURN sunucusu kurmak (yönetilen bir sağlayıcı ile maliyetli) gerekip gerekmediğine **tahminle değil veriyle** karar vermek için, her peer bağlantısının gerçekte hangi ICE candidate tipini (`host`/`srflx`/`prflx`/`relay`) kullandığını ve nihai sonucunu (`connected`/`failed`) üretimde topluyoruz. **Bu tur SADECE görünürlük ekliyor — TURN sunucusu kurulumuna henüz geçilmedi, o ayrı bir sonraki karar.**

- **Tespit — `useVoiceChannel.ts`'in `logIceOutcome`'ı:** `onconnectionstatechange`'in `'connected'`/`'failed'` case'lerinde, geçiş anında **bir kez** (polling yok) `pc.getStats()` çağrılır; `candidate-pair` tipinde `nominated: true` olan rapor bulunur, onun `localCandidateId`'sine karşılık gelen `local-candidate` raporunun `candidateType` alanı okunur. `'failed'`'da hiç nominated pair olmayabilir — bu durumda `candidateType: null` ("none") loglanır, bu da kendi başına anlamlı bir sinyal (ICE denenecek bir yol bile seçemedi).
- **PII yok:** Sadece `candidateType` okunuyor — candidate'ın `address`/`ip`/`port`/`relatedAddress` alanlarına (gerçek kullanıcı IP'si veya TURN relay IP'si) hiç dokunulmuyor, ne loglanıyor ne de backend'e gönderiliyor.
- **Frontend'de Sentry yok (bu turda doğrulandı — `package.json`, `node_modules`, `src/` hiçbirinde referans yok, sadece backend'e özel).** Bu yüzden `Sentry.addBreadcrumb` değil, yapılandırılmış bir `console.info('[voice-ice] peer=... candidateType=... connectionState=...')` kullanılıyor.
- **Backend event'i — bilinçli bir karar, mühendislik kararı gerekçeli sunuldu ve onaylandı:** `console.info` tek başına hiçbir yerde agregat edilmiyor/toplanmıyor — gerçek kullanıcılardan veri toplama hedefine hizmet etmiyor. `BackendWeb.VoiceChannel`'a yeni bir `"report_ice_stats"` `handle_in`'i eklendi: `candidate_type`/`connection_state`'i (bilinmeyen/beklenmeyen bir değere karşı `normalize/3` ile allowlist'e zorlanmış) tek bir `Logger.info` satırına yazıyor — **yeni bir DB tablosu veya ayrı bir analytics altyapısı YOK**, bilinçli olarak: bu birkaç hafta boyunca logları grep'leyip tek bir altyapı kararını bilgilendirmek için, kalıcı bir telemetri pipeline'ı değil. Diğer tüm `voice_channel.ex` handler'larıyla aynı `ChannelRateLimiter` desenini kullanıyor (dakikada 20, sadece kötü niyetli/hatalı bir client'ın sahte log satırı basmasına karşı bir bariyer — bu event zaten peer bağlantısı başına en fazla 2 kez ateşleniyor).
- **Test:** `webrtcTestUtils.ts`'teki `FakeRTCPeerConnection`'a bir `getStats()` mock'u eklendi (varsayılan: nominated `host` pair — testin çoğu bu ayrımı önemsemiyor, ilgilenen testler kendi instance'ında override ediyor, `signalingState`/`connectionState` ile aynı konvansiyon). `useVoiceChannel.test.ts`'in `vi.mock('../../services/socket', ...)` fabrikasına eksik olan `sendIceDiagnostics: vi.fn()` eklendi (yoksa yeni testler `TypeError: sendIceDiagnostics is not a function` ile patlıyordu) ve `'connected'`/`'failed'` için 2 yeni test eklendi (26 → 28 test, hepsi geçiyor).
- **Uçtan uca doğrulandı:** `e2e/voice-channel.spec.ts` (bkz. 5.4) bu turda çalıştırıldığında backend logunda gerçek satırlar görüldü — `voice ICE diagnostic user_id=... room=voice:... candidate_type=host connection_state=connected` — iki tarafta da, hiçbir IP/adres alanı içermeden.
- **Yan bulgu, düzeltildi:** `npm run test` (vitest), Playwright'in `e2e/*.spec.ts` dosyalarını kendi test dosyası sanıp çalıştırmaya çalışıyordu ("Playwright Test did not expect test() to be called here") — önceki Playwright turundan kalma, o zaman sadece `npx playwright test` çalıştırılıp `npm run test` tekrar kontrol edilmediği için fark edilmemiş bir regresyon. `vite.config.ts`'in `test.exclude`'una `'e2e/**'` eklendi.

### 4.5 Sinyal Tipleri (Frontend)

```ts
// frontend/src/types.ts:167-172
export interface VoiceSignalPayload {
  from: string;
  to: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

// frontend/src/types.ts:69-75
export interface PresenceUser {
  user_id: string;
  username: string | null;
  online_at: number;
  muted?: boolean;
  deafened?: boolean;
}
```

`frontend/src/services/socket.ts`: `joinVoiceChannel(roomId, callbacks): Promise<VoiceChannelHandle>` (satır 230-270) `voice:${roomId}` topic'ine join olur, `Presence.onSync` bağlar, `'video_offer'`/`'video_answer'`/`'ice_candidate'` event'lerini dinler, join yanıtındaki `resp.peers`'ten `existingPeerIds` döner (backend'in `%{peers: existing_peers}`'ine karşılık gelir). `sendVoiceOffer`/`sendVoiceAnswer`/`sendIceCandidate`/`sendVoiceStatus` bu event'leri push eder.

---

## 5. Kalite Güvence (QA) ve Test Altyapısı

### 5.0 Yerel Geliştirme Ortamı Kurulumu

**PostgreSQL 17 bu makinede native kurulu ama bir Windows servisi olarak KAYITLI DEĞİL.** Kurulum yolu: `C:\Program Files\PostgreSQL\17` (data dizini: `C:\Program Files\PostgreSQL\17\data`). `Get-Service *postgres*` ve `sc.exe query state= all` ile doğrulandı — hiçbir eşleşme yok. Bunun pratik sonucu: **her makine yeniden başlatıldığında Postgres otomatik ayağa kalkmıyor**, `backend/config/dev.exs`/`test.exs`'teki `hostname: "localhost"` bağlantısı (port belirtilmemiş → Postgrex varsayılanı 5432) `econnrefused` ile başarısız olur ve `mix test`/`mix precommit` bu noktada durur.

**Her reboot sonrası elle başlatmak için:**

```powershell
& "C:\Program Files\PostgreSQL\17\bin\pg_ctl.exe" start -D "C:\Program Files\PostgreSQL\17\data" -l <bir log dosyası yolu>
```

Notlar:
- Temiz kapatılmamışsa (örn. reboot sırasında) `pg_ctl start` otomatik crash-recovery çalıştırır ("database system was not properly shut down; automatic recovery in progress") — bu normaldir, log'da "database system is ready to accept connections" ile bitmesi yeterlidir.
- Eğer `data\postmaster.pid` dosyası duruyor ama Postgres çalışmıyorsa (stale pid — bir önceki instance reboot ile öldü ama dosya temizlenmeden kaldı), `pg_ctl start` "lock file already exists" hatası verebilir. Silmeden önce dosyanın ilk satırındaki PID'in gerçekten ölü olduğunu doğrulayın (`Get-Process -Id <pid>` boş dönmeli), sonra dosyayı silip tekrar deneyin.
- `backend_dev` ve `backend_test` veritabanları zaten mevcutsa (`psql -U postgres -l` ile kontrol edin) `mix ecto.create` çalıştırmaya gerek yok.
- Kalıcı bir çözüm (örn. Postgres'i Windows servisi olarak kaydetmek — `pg_ctl register`) bilinçli olarak yapılmadı; bu not, o adım atılana kadar tekrar keşfedilmesin diye buradadır.

### 5.1 Backend — ExUnit, Credo, Dialyzer

**Test dosyaları (`backend/test/**/*.exs`, 9 dosya):**

| Dosya | Kapsam |
|---|---|
| `test_helper.exs` | ExUnit başlatma + `Ecto.Adapters.SQL.Sandbox` `:manual` moda alma |
| `backend_web/controllers/error_json_test.exs` | `ErrorJSON` — 404/500 hata gövdesi render'ı |
| `backend/servers_test.exs` | `Backend.Servers` — `member?/2`, `owner?/2`, `leave_server/2`, `kick_member/2` |
| `backend_web/channels/dm_channel_test.exs` | DM kanalına connect/join yetkilendirmesi, mesaj geçmişi, `shout` broadcast+bildirim, `toggle_reaction` |
| `backend_web/channels/chat_channel_test.exs` | Sunucu kanalına connect (**geçersiz/iptal edilmiş token dahil** — `"connect/3 rejects a token revoked by logout_all"`), join yetkilendirmesi, mesaj geçmişi, `shout`, `toggle_reaction` |
| `backend_web/channels/server_channel_test.exs` | Sunucuya connect/join, `channel_created` broadcast, kicked üye reddi, `member_left` broadcast |
| `backend/friends_test.exs` | `send_request/2` — pending oluşturma, karşılıklı istekte otomatik kabul, duplicate/ters-yönlü duplicate reddi, **eşzamanlı karşılıklı isteklerin tek arkadaşlığa çözülmesi (race condition testi)** |
| `backend/direct_messages_test.exs` | `member?/2`, `open_room/2` (arkadaş olmayanlar arası reddi, aynı çiftin her zaman aynı odaya çözülmesi), `toggle_reaction/4`, `list_messages/2` cursor sayfalama |
| `backend/chat_test.exs` | `toggle_reaction/4` (ekleme/kaldırma, çoklu kullanıcı gruplama, cross-channel reddi), `list_messages/2` reaction gruplama + cursor sayfalama |

**`backend/test/support/conn_case.ex`** — `BackendWeb.ConnCase`: `using` bloğu `Plug.Conn`, `Phoenix.ConnTest`, `BackendWeb.ConnCase` ve **`Backend.Fixtures`**'ı import eder; `setup` bloğu `Backend.DataCase.setup_sandbox(tags)` çağırır.

**`backend/test/support/data_case.ex`** — `Backend.DataCase`: `Ecto`, `Ecto.Changeset`, `Ecto.Query`, `Backend.DataCase`, `Backend.Fixtures` import eder. İki helper:
- `setup_sandbox(tags)`: `Sandbox.start_owner!(Backend.Repo, shared: not tags[:async])`, `on_exit` ile durdurulur.
- `errors_on(changeset)`: değişiklik seti hatalarını `%{field: ["mesaj"]}` biçimine çeviren klasik Phoenix helper'ı.

**Backend test suite sonucu (bu oturumda doğrulanmıştır):** `mix test` → **55 test, 55 geçti**, 0 hata.

**Credo (`backend/.credo.exs`, 222 satır) — artık `precommit`'in parçası:**
- `strict: false` — `.credo.exs` içinde strict mod **kapalı** (dosya değişmedi), ama `precommit` alias'ı artık her zaman `mix credo --strict` çağırıyor (bkz. aşağıdaki tablo).
- `mix.exs`'te bağımlılık var: `{:credo, "~> 1.7", only: [:dev, :test], runtime: false}` — `:test`'te de mevcut olduğu için `precommit`'in çalıştığı `:test` env'inde ek bir sorun çıkarmadı (ölçüldü, doğrulandı).
- Aktif kural grupları: Consistency (6), Design (`AliasUsage`, `TagFIXME`, `TagTODO`), Readability (~20 kural, `MaxLineLength: 120`), Refactor (13 kural, `CyclomaticComplexity`/`Nesting`/`FunctionArity` dahil), Warning (~20 kural). Pasif: `Readability.Specs`, `Refactor.ABCSize`, `Refactor.ModuleDependencies`, `Warning.UnsafeToAtom`.
- **Ölçülen süre:** `mix credo --strict` tek başına **~1.2 saniye**.
- **Satır sonu tutarsızlığı kökten çözüldü:** Daha önce `--strict` 14 "windows line endings" bulgusu veriyordu (Windows `core.autocrlf=true` + checkout'un CRLF'e çevirmesi yüzünden). Kök nedeni repo köküne eklenen **`.gitattributes`** (`* text=auto eol=lf` + `.ex`/`.exs`/`.md`/vb. için açık `eol=lf` kuralları) çözdü — artık hangi OS'te checkout edilirse edilsin çalışma dizini LF'de kalıyor, credo'nun kendi kontrolü kapatılmadı (kök neden düzeltildi, gelecekteki gerçek bir encoding sorunu sessizce bastırılmıyor). Ayrıca bu turda gerçek 2 bulgu (bir "nested module" önerisi `test/backend_web/channels/voice_channel_test.exs`'te, bir "nesting too deep" `voice_channel.ex`'in `join/3`'ünde — `with` zincirine refactor edildi, davranış değişmedi) düzeltildi; `mix credo --strict` şu an **0 bulgu, exit code 0**.

**Dialyzer — artık `precommit`'in parçası (ayrı bir `MIX_ENV=dev` alt-süreci olarak):**
- `mix.exs`'te bağımlılık var: `{:dialyxir, "~> 1.4", only: [:dev], runtime: false}` — bilinçli olarak `:dev`'de bırakıldı (aşağıya bakın).
- `project/0` fonksiyonunda **`:dialyzer` anahtarı yok** — PLT yolu, `plt_add_apps`, özel `flags` tanımlanmamış; dialyxir tamamen varsayılan ayarlarıyla çalışır.
- `.dialyzer_ignore.exs` **yok**.
- **Ölçülen süre:** PLT hiç yokken (sıfırdan inşa) **~1m18s** (PLT inşası tek başına 53s); PLT hazırken (sonraki her çalıştırma) **~5.3-5.4s**, tutarlı (3 kez ölçüldü).
- **Neden `MIX_ENV=dev` alt-süreci gerekti (`hex_audit!/1` ile aynı desen, `mix.exs`'te `dialyzer!/1`):** `precommit`, `preferred_envs: [precommit: :test]` yüzünden `:test` env'inde çalışıyor, ama `dialyxir` bilinçli olarak `only: [:dev]` — `:test`'e genişletmek DENENDİ ve iki sorun çıkardı: (1) `dialyzer` task'ı `:test`'te hiç yüklenmiyor ("task could not be found"), (2) `:test`'in `elixirc_paths`'i `test/support`'u da içerdiği için (ConnCase/DataCase için gerekli), dialyzer o dosyaları da analiz etmeye çalışıp `ExUnit.Callbacks.__noop__/0` gibi macro-üretilen sahte fonksiyonlar için sahte `unknown_function` hataları üretti. Ayrı bir `MIX_ENV=dev` alt-süreci ikisini de çözüyor: temiz bir `:dev` process'inde `dialyzer` task'ı zaten yüklü VE sadece `lib/`'i analiz ediyor (bu projenin gerçek, 0-hatalı temel çizgisi).
- **Gate doğrulaması:** `Backend.DialyzerTypeErrorProbe` adında, kasıtlı yanlış `@spec`'li geçici bir modül eklenip `mix precommit` çalıştırıldı — dialyzer hatayı buldu ve zincir **`test` hiç çalışmadan** anında durdu (`** (Mix) mix dialyzer found issues`), sonra modül kaldırıldı ve suite'in temiz geçtiği yeniden doğrulandı.

**`mix precommit` uçtan uca ölçülen toplam süre (sıcak dev PLT ile, 2 kez ölçüldü, tutarlı):** **~33.6-34.0 saniye** — `compile` → `credo --strict` (~1s) → `deps.audit` → `hex_audit!` → `deps.unlock --unused` → `format` → `dialyzer!` (~4.4s analiz + alt-süreç overhead'i) → `test` (~24s, en pahalı adım). Sıralama bilinçli: en ucuz/hızlı statik kontroller (`credo`, audit'ler, `format`) en önce, ikinci en pahalı adım (`dialyzer`) `test`'ten hemen önce — kullanıcının önerdiği sıralamadan farklı (o `dialyzer`'ı daha erken, audit'leri daha geç öneriyordu), ama gerçek ölçümler audit'lerin de çok hızlı olduğunu gösterdiği için "en ucuzdan en pahalıya" ilkesi bu düzenlemeyi haklı çıkardı.

> **Not (artık güncel değil, tarihsel referans için bırakıldı):** Önceden bu bölümde "credo --strict ve dialyzer CI/precommit akışının parçası değildir" deniyordu — artık İKİSİ DE `precommit`'in parçası (bkz. [Bölüm 7](#7-bilinen-boşluklar--devam-notları) madde 6).

### 5.2 Frontend — Vitest, jsdom, React Testing Library

**`frontend/vite.config.ts`:** `environment: 'jsdom'`, `setupFiles: ['./src/test/setup.ts']`.

**`frontend/package.json` test dependency'leri:** `vitest ^4.1.10`, `@testing-library/react ^16.1.0`, `@testing-library/jest-dom ^6.6.3`, `jsdom ^25.0.1`, `@vitejs/plugin-react ^6.0.3`. Script'ler: `"test": "vitest run"`, `"test:watch": "vitest"`, `"lint": "oxlint"` (ESLint değil).

**Tüm frontend test dosyaları (3 dosya, `.test.tsx` hiç yok):**

| Dosya | Kapsam |
|---|---|
| `frontend/src/services/__tests__/tokenStorage.test.ts` | `tokenStorage.ts` round-trip, bozuk JSON'da null dönme, `clearStoredSession` **ve** `session.ts`'teki `forceLogout()` |
| `frontend/src/stores/__tests__/chatStore.test.ts` | `useChatStore.reset()`, `sendMessage` (trim/no-op), `handleReactionToggled`, `handleFileSelected` (aktif kanal değişirse iptal) — `socket.ts`/`api.ts` `vi.mock` ile mock'lanır |
| `frontend/src/hooks/__tests__/useVoiceChannel.test.ts` (+ yardımcı `webrtcTestUtils.ts`) | `useVoiceChannel.ts`'in `joinGenerationRef` race koruması ("Hızlı Arka Arkaya Tıklama Kalkanı", bkz. [4.1](#41-joingenerationref--hızlı-arka-arkaya-tıklama-kalkanı)) **ve** `handleOffer`'ın glare çözümü, ICE candidate kuyruklaması, `onconnectionstatechange` kurtarma mantığı (bkz. [4.2](#42-perfect-negotiation--uygulanan-varyant)) — detay aşağıda |

#### `tokenStorage.ts` — Bozuk JSON Dayanıklılığı

```ts
// frontend/src/services/tokenStorage.ts:19-26
export function loadStoredUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}
```
`JSON.parse` bir `try/catch` ile sarmalanmıştır — parse hatası exception fırlatmak yerine `null` döner.

```ts
// frontend/src/services/__tests__/tokenStorage.test.ts:40-43
it('loadStoredUser returns null instead of throwing on corrupted JSON', () => {
  localStorage.setItem('voiceprogram_user', '{not valid json');
  expect(loadStoredUser()).toBeNull();
});
```

#### `forceLogout()` — Store Reset Orkestrasyon

```ts
// frontend/src/services/session.ts:27-35
export function forceLogout(): void {
  clearStoredSession();
  useFriendStore.getState().reset();
  useServerStore.getState().reset();
  useChatStore.getState().reset();
  useDMStore.getState().reset();
  useConnectionStore.getState().reset();
  useSessionStore.getState().triggerForcedLogout();
}
```

> ⚠️ **Önemli düzeltme — kullanıcının "6 store" varsayımı gerçekte 5+1'dir ve tam kapsama sahip DEĞİLDİR:** `forceLogout()` şu 5 store'un `reset()`'ini çağırır: `useFriendStore`, `useServerStore`, `useChatStore`, `useDMStore`, `useConnectionStore`. `useSessionStore` için `reset()` değil, ayrı bir `triggerForcedLogout()` çağrılır (bu, `forcedLogoutAt` alanını günceller — App.tsx'in Auth ekranına düşmesini tetikler). **`useSocketStore` zaten gerçek bir Zustand store olmadığı için (bkz. [1.2](#12-frontend--react--vite--typescript--zustand)) resetlenecek bir state'i yoktur.**

Test dosyasında bu doğrudan doğrulanır (`tokenStorage.test.ts:56-98`, `describe('session.forceLogout', ...)`):
```ts
beforeEach(() => {
  localStorage.clear();
  storeToken('my-jwt-token');
  storeUser(testUser);
  useServerStore.setState({ activeServerId: 'server-1' });
  useChatStore.setState({ draft: 'unsent message' });
  useDMStore.setState({ activeRoomId: 'room-1' });
  useFriendStore.setState({ error: 'stale error' });
  useConnectionStore.setState({ isConnected: true, hasConnectedBefore: true });
  useSessionStore.setState({ forcedLogoutAt: 0 });
});

it('resets every user-scoped store back to its initial state', () => {
  forceLogout();
  expect(useServerStore.getState().activeServerId).toBeNull();
  expect(useChatStore.getState().draft).toBe('');
  expect(useDMStore.getState().activeRoomId).toBeNull();
  expect(useFriendStore.getState().error).toBe('');
  expect(useConnectionStore.getState()).toMatchObject({
    isConnected: false,
    hasConnectedBefore: false,
  });
});

it('bumps useSessionStore so App.tsx can fall back to the Auth screen', () => {
  forceLogout();
  expect(useSessionStore.getState().forcedLogoutAt).toBeGreaterThan(0);
});
```

#### `useVoiceChannel.ts` — `joinGenerationRef` Race Koruması, Glare Çözümü, ICE Kurtarma

**jsdom'da hiç bulunmayan WebRTC/Web Audio/Media Capture API'leri (ampirik olarak doğrulandı, varsayılmadı):** `RTCPeerConnection`, `MediaStream`, `RTCSessionDescription`, `RTCIceCandidate`, `navigator.mediaDevices` (tamamı — sadece `getUserMedia` değil, `mediaDevices` objesinin kendisi de yok) ve `AudioContext` — hepsi `typeof` ile `undefined`. jsdom bunları kasıtlı olarak implemente etmiyor (DOM-only bir simülatör). Buna karşılık `requestAnimationFrame`/`cancelAnimationFrame`/`performance.now` jsdom'da **zaten var**, ayrıca mock'lanmasına gerek yok. Bu, `useVoiceChannel`'ı test edecek herhangi bir gelecekteki test dosyası için de geçerli bir bulgu.

`frontend/src/hooks/__tests__/webrtcTestUtils.ts`, bu eksik globalleri sahteleyen yeniden kullanılabilir bir yardımcı modül:
- `FakeMediaStream`/`FakeMediaStreamTrack` — her track'te bir `stop()` spy'ı olan sahte stream.
- `FakeRTCPeerConnection` — `createOffer`/`createAnswer`/`setLocalDescription`/`setRemoteDescription`/`addTrack`/`addIceCandidate`/`restartIce`/`close` hepsi spy, gerçek ağ bağlantısı kurmuyor; `signalingState`/`connectionState` doğrudan atanabilir public alanlar. **Statik `instances` dizisi** tutuyor (her `installWebrtcMocks()` çağrısında temizlenir) — hook `new RTCPeerConnection(...)`'ı kendi içinde çağırdığı için testin normalde erişebileceği bir referans yok; `FakeRTCPeerConnection.instances[0]` ile test, hook'un oluşturduğu GERÇEK instance'ı yakalayıp `signalingState`'i (glare testleri için) veya mock'ların dönüş değerlerini (rollback-red testi için) doğrudan manipüle edebiliyor.
- `FakeRTCSessionDescription`/`FakeRTCIceCandidate` — `handleOffer`/`handleIceCandidate`'in `new RTCSessionDescription(...)`/`new RTCIceCandidate(...)` çağırdığı, jsdom'da bunlar da tanımsız olduğu için gereken minimal value-holder sahteler.
- `installWebrtcMocks()` — `RTCPeerConnection`/`RTCSessionDescription`/`RTCIceCandidate`/`AudioContext`'i `vi.stubGlobal` ile, `navigator.mediaDevices`'i `Object.defineProperty` ile (düz atama güvenilir değil) her testte taze spy'larla kuruyor.
- `deferred<T>()` — bir Promise'i testin içinden `resolve`/`reject` edebilmek için.

`services/socket.ts`, `chatStore.test.ts`'teki desenle `vi.mock` edildi (`joinVoiceChannel`/`sendVoiceOffer`/`sendVoiceAnswer`/`sendIceCandidate`/`sendVoiceStatus`).

**Test-seam olarak eklenen 2 export (davranış DEĞİŞMEDİ, sadece görünürlük):** `useVoiceChannel.ts`'teki `ICE_DISCONNECT_GRACE_MS` ve `GLARE_RECOVERY_DELAY_MS` module-private const'ları artık `export const` — testlerin bu "sihirli sayı"ları kendi kopyalarını tutup zamanla senkronizasyondan düşme riski almadan doğrudan referans alabilmesi için.

**`joinGenerationRef` race koruması — 4 senaryo:**
1. `getUserMedia` roomA için beklerken `join(roomB)` çağrılır — roomA'nın `getUserMedia`'sı sonradan resolve olunca stream'i `stop()` edilir, `activeRoomId` `roomB` olarak kalır.
2. `getUserMedia` hemen döner ama roomA'nın `joinVoiceChannel`'ı (Phoenix join) beklerken `join(roomB)` çağrılır — roomA'nın kanalı sonradan resolve olunca dönen `leave()` çağrılır (kanaldan hemen ayrılınır), stream durdurulur, `activeRoomId` `roomB` kalır.
3. Supersede olmadan normal `join(roomA)` — `activeRoomId` `roomA` olur, `existingPeerIds`'teki her peer için `sendVoiceOffer` çağrıldığı doğrulanır (`callPeer`'in fire-and-forget etkisi, `waitFor` ile beklenir).
4. `leave()` doğrudan çağrıldığında (başka bir `join()` üzerinden değil) hem az önce katılınmış odanın stream'ini durdurduğu HEM DE o an uçuşta olan ayrı bir `join()` denemesini geçersiz kıldığı (`joinGenerationRef`'i bizzat kendisinin de artırdığının dolaylı kanıtı) doğrulanır.

**`handleOffer` glare çözümü, ICE candidate kuyruklaması, `onconnectionstatechange` kurtarma — 8 senaryo** (`handleOffer` export edilmediği için testler `joinVoiceChannel`'a mock içinden geçirilen `onOffer`/`onIceCandidate` callback'lerini yakalayıp doğrudan çağırıyor):
1. **Glare, impolite kazanır:** `signalingState = 'have-local-offer'` iken kendi id'mizden (`'me'`) leksikografik olarak KÜÇÜK bir peer'den (`'aaa-peer'`) gelen offer düşürülür — `setRemoteDescription` hiç çağrılmaz, kendi offer'ımız korunur.
2. **Glare, polite kaybeder ve rollback yapar:** aynı durum ama peer id'si BÜYÜK (`'zzz-peer'`) — `setLocalDescription({type:'rollback'})` önce, `setRemoteDescription` sonra (`mock.invocationCallOrder` ile sıra doğrulanıyor), ardından `createAnswer`+`setLocalDescription(answer)`+`sendVoiceAnswer`.
3. **Rollback reddedilirse kurtarma:** `setLocalDescription`'ın rollback çağrısı `mockImplementationOnce` ile reddedilir — `GLARE_RECOVERY_DELAY_MS` dolmadan `restartIce` çağrılmadığı, doldıktan sonra çağrıldığı `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync()` ile doğrulanır (gerçek zamanlayıcı beklenmiyor).
4. **Regresyon — glare yok:** `signalingState = 'stable'` iken gelen offer'da rollback hiç çağrılmadan doğrudan `setRemoteDescription`+`createAnswer`+`sendVoiceAnswer` akışı çalışır.
5. **ICE candidate kuyruklaması:** peer için henüz bağlantı yokken gelen candidate kuyruğa alınır (`FakeRTCPeerConnection.instances` hâlâ boş); sonra o peer'den bir offer gelince bağlantı kurulur VE kuyruktaki candidate `addIceCandidate` ile flush edilir.
6-8. **`onconnectionstatechange`** (üçü de `vi.useFakeTimers()` kullanıyor): `'disconnected'` → `ICE_DISCONNECT_GRACE_MS` içinde `'connected'`e dönerse `restartIce` HİÇ çağrılmaz; `'disconnected'` grace period'u geçerse `restartIce` çağrılır; `'failed'` gecikme olmadan ANINDA `restartIce` çağırır.

**Doğrulama (mutation testing, her iki turda da yapıldı):**
- Önceki tur: her iki `joinGenerationRef.current !== myGeneration` kontrolü geçici devre dışı bırakılıp 3/4 testin gerçekten kırıldığı doğrulandı.
- Bu tur: `isImpolite = user.id > payload.from` karşılaştırması tersine çevrilip glare'e bağlı 3 testin (impolite-kazanır, polite-kaybeder, rollback-red) hepsinin kırıldığı, diğer 9 testin ETKİLENMEDİĞİ görüldü; ayrıca `isGlare` koşulu `false`'a sabitlenip AYNI 3 testin yine kırıldığı doğrulandı. İkisinde de mutasyon geri alındıktan sonra dosya orijinaliyle bit-bit aynı olduğu (`diff`) teyit edildi.
- Her iki turda da hook'un kendi DAVRANIŞI değişmedi; tek test-seam değişikliği iki const'un `export` edilmesiydi (yukarıda not edildi).

**Code-review turu (bu test dosyaları "başkasının PR'ı" gibi eleştirel okundu) — 6 bulgu, 4'ü düzeltildi, 2'si bilinçli olarak ertelendi:**

| # | Bulgu | Ciddiyet | Durum |
|---|---|---|---|
| 1 | "impolite" testinde `expect(pc.signalingState).toBe('have-local-offer')` boştu — fake hiçbir metotla `signalingState`'i değiştirmediği için hook ne yaparsa yapsın hep doğruydu | Kozmetik | **Düzeltildi** — satır kaldırıldı (fake'e gerçekçi state-machine geçişleri eklemek yerine; bkz. madde 4'ün gerekçesiyle tutarlılık için) |
| 2 | 8 yeni testin hiçbiri `leave()`/unmount çağırmıyordu — `watchSpeaking`'in `requestAnimationFrame` döngüsü ve mic stream testler arası sızıyordu | Orta | **Düzeltildi** — `renderVoiceChannel()`/`cleanupActiveHooks()` eklendi, her iki `describe` bloğunun `afterEach`'i artık her render edilen hook için `leave()` + `unmount()` çağırıyor. `cleanupCallCount` ile geçici olarak enstrümante edilip tam 12 kez (12 `renderVoiceChannel` çağrısına karşılık) ateşlendiği doğrulandı |
| 3 | `FakeRTCPeerConnection.instances`'in `beforeEach`'te sıfırlanması sıralı çalışmaya dayanıyordu, bunu zorlayan hiçbir şey yoktu | Orta | **Kısmen düzeltildi** — her iki `describe` `describe.sequential(...)`'a çevrildi (gerçek, çalışan bir vitest API'si — kaynak koddan doğrulandı, sadece TYPE seviyesinde "deprecated" notu options-object formuna ait, chain-call formuna değil). **Sınırlama:** `.sequential` sadece MİRAS alınan/varsayılan concurrency'yi engelliyor; dosya içinde biri açıkça `it.concurrent(...)` yazarsa o TEK test yine concurrent çalışabilir — vitest'in dosya seviyesinde bunu kesin engelleyen bir API'si yok. Hem `webrtcTestUtils.ts`'te (`instances` alanının yanında) hem test dosyasının başında bunu açıkça uyaran yorumlar eklendi |
| 4 | `signalingState`'in manuel kontrol edildiği, gerçek state-machine geçişlerinin doğrulanmadığı dokümante edilmemişti | Orta | **Düzeltildi** — glare `describe` bloğundan hemen önce, bunun bilinçli bir kapsam sınırı olduğunu (gerçek tarayıcı state-machine testi ayrı bir Playwright/E2E turunun işi) açıklayan bir yorum eklendi |
| 5 | "rollback reddedilirse" testi (ve daha hafif ölçüde "polite rollback"/"ICE candidate kuyruğu") iki fazı/birden fazla assertion'ı tek `it()`'te topluyor | Kozmetik | **Ertelendi** — kullanıcı açıkça "dokunma" dedi; vitest'in assertion-bazlı hata raporlaması teşhisi zaten yeterince açık tutuyor |
| 6 | "polite rollback" testindeki sıra kontrolü (`invocationCallOrder.find(...)`) doğru ama gereğinden karmaşık — `mockClear()` ile basitleştirilebilirdi | Kozmetik | **Ertelendi** — kullanıcı açıkça "dokunma" dedi; mevcut hâli YANLIŞ değil, sadece daha yoğun okunuyor |

**Frontend test suite sonucu (bu oturumda doğrulanmıştır):** `npm run test` → **26 test, 26 geçti** (3 dosya, düzeltmelerden sonra 3 kere art arda çalıştırıldı, flaky değil). `npm run build` (`tsc -b` + `vite build`) → 0 TypeScript hatası.

### 5.3 CI/CD (GitHub Actions)

`.github/workflows/ci.yml` — `main`'e her push'ta ve `main`'e açılan her pull request'te tetiklenir, **iki bağımsız paralel job**:

- **`backend`** — `erlef/setup-beam` ile `backend/Dockerfile`'daki gerçek toolchain'e pinlenmiş (Elixir 1.20.2 / OTP 29.0.3, `mix.exs`'in `elixir: "~> 1.15"` alt sınırından değil), `services:` bloğuyla resmi `postgres:17` image'ından bir servis container'ı (`config/test.exs`'teki `postgres`/`postgres`/`backend_test` bilgileriyle birebir), sonra **yerelde kullanılan `mix precommit` alias'ının aynısı** (`compile --warnings-as-errors` → `credo --strict` → `deps.audit` → `hex.audit` → `deps.unlock --unused` → `format` → `dialyzer` → `test`) — CI'a özel, yerelden farklı ayrı bir adım yok.
- **`frontend`** — `actions/setup-node` yerel dev Node sürümüne pinlenmiş (24.15.0 — repoda `.nvmrc` yok), `npm ci` (lockfile'a sadık, `npm install` değil), `npm run test`, `npm run build`.

**Dialyzer PLT cache stratejisi:** `actions/cache` ile `backend/_build/dev/dialyxir_*.plt*` cache'lenir, key `backend/mix.lock`'un hash'ine bağlıdır (`${{ hashFiles('backend/mix.lock') }}`) — `mix.lock` değişmediği sürece sonraki her koşu, yerelde ölçülen ~53 saniyelik soğuk PLT inşasını atlar. Bilinçli olarak `restore-keys` fallback'i **yok**: farklı bir `mix.lock`'a ait bir PLT farklı bir bağımlılık setini temsil eder, bayat bir PLT'ye düşmek yeni bağımlılıkları sessizce gözden kaçırma riski taşır. İlk koşu (veya her `mix.lock` değişikliğinden sonraki ilk koşu) cache'te bulamaz ve soğuk inşayı normal şekilde yapar, sonra cache'ler — **bu, ilk gerçek CI koşusunda doğrulandı: backend job'ı 7m43s sürdü (çoğunluğu soğuk PLT inşası), her iki job da (`frontend` 25s) hatasız geçti.**

**Branch protection henüz ayarlanmadı** — bu workflow dosyası `backend`/`frontend` job'larını çalıştırır ve başarısız olurlarsa job kendiliğinden kırmızı görünür, ama `main`'e merge'i bu iki job'ın geçmesi şartına **bağlamak** GitHub UI'dan (Settings → Branches → Branch protection rules → "Require status checks to pass before merging") ayrıca, elle yapılması gereken bir adımdır — bu dosya bunu kendi kendine yapılandıramaz.

### 5.4 E2E Testleri (Playwright)

**Konum:** `frontend/e2e/*.spec.ts`, config `frontend/playwright.config.ts`. Çalıştırma: `npm run test:e2e` (frontend kökünden). Şu an tek tarayıcı hedefleniyor — **sadece Chromium** (proje Discord-tarzı bir masaüstü/web uygulaması; WebKit/Firefox şimdilik gereksiz).

**Vitest/RTL'den farkı:** 5.1/5.2'deki testler mock'lanmış/izole birim testleri. E2E testleri gerçek stack'i uçtan uca sürer — gerçek Vite dev sunucusu, gerçek `mix phx.server`, gerçek Postgres (`backend_dev`), gerçek WebSocket (Phoenix Channels) bağlantısı. Hiçbir şey mock'lanmaz.

**Otomatik sunucu ayağa kaldırma — araştırma sonucu:** Playwright'in `webServer` seçeneği **dizi (array) kabul ediyor** (`TestConfigWebServer | TestConfigWebServer[]`, Playwright 1.28+), yani hem backend hem frontend'i otomatik başlatıp health-check'leyebiliyor — iki ayrı manuel süreç gerekmiyor:
- `backend` girdisi: `mix phx.server`'ı `cwd: ../backend` ile başlatır, hazır olduğunu `http://localhost:4000/api/servers`'a HTTP isteği atarak anlar (Playwright'in `url` health-check'i **herhangi bir** HTTP yanıtını — 401 dahil — "sunucu ayakta" sayar, sadece 2xx beklemez).
- `frontend` girdisi: `npm run dev`'i başlatır, `http://localhost:5173`'ü health-check eder.
- `reuseExistingServer: !process.env.CI` — yerelde zaten çalışan bir dev sunucusu varsa (örn. elle `mix phx.server` açıksa) onu kullanır, yeniden başlatmaz; CI'da (henüz eklenmedi, bkz. aşağı) her zaman temiz başlatır.
- **Tek gerçek istisna: Postgres.** Playwright sadece kendi başlattığı Node/BEAM süreçlerini yönetebilir, native bir Windows kurulumunu (bu makinenin Postgres'i gibi) değil — bkz. 5.0. `webServer` bunu health-check edemez/başlatamaz; testten önce Postgres'in ayakta olduğu elle (veya CI'da bir `services:` container'ıyla, bkz. 5.3) sağlanmalı.
- **Doğrulandı:** Süreçler her test koşusunun sonunda düzgün kapanıyor (3 ardışık koşudan sonra `mix`/`beam`/`node`/`vite` süreci veya 4000/5173 portlarında `LISTEN` durumu kalmadı, sadece `TimeWait` — Windows'ta parent-process öldürmenin çocuk süreçleri düzgün temizlemediği bilinen bir risktir, burada sorun çıkarmadı).

**İlk kritik akış — `auth-and-chat.spec.ts`:** register → logout → aynı hesapla login → sunucu oluştur (otomatik `#genel` kanalına düşer) → mesaj gönder → mesajın UI'da göründüğünü doğrula. Tek bir `test()` içinde `test.step(...)` ile 4 adıma bölünmüş (ayrı ayrı raporlanır ama aynı sayfa/oturumu paylaşır — register olmadan login'i test etmenin bir anlamı yok).

**İkinci akış — `voice-channel.spec.ts`: gerçek iki-taraflı WebRTC bağlantısı.**

- **İki ayrı `BrowserContext`, tek context'te iki sekme değil.** İki farklı kullanıcıyı simüle etmek her ikisinin de kendi izole auth oturumuna, kendi sahte mikrofon akışına ve kendi `RTCPeerConnection`'ına ihtiyaç duyar — tek context bu üçünü de paylaştırır, test edilen şey "UI'nin kendi kendine tepkisi" olurdu, iki bağımsız WebRTC ucunun gerçekten müzakere etmesi değil.
- **Sahte medya akışı:** `playwright.config.ts`'in `chromium` projesine `launchOptions.args` ile `--use-fake-ui-for-media-stream` (izin diyaloğunu otomatik onaylar — headless ortamda tıklayacak insan yok) ve `--use-fake-device-for-media-stream` (gerçek donanım olmadan sentetik bir ses akışı sağlar) eklendi — `getUserMedia({ audio: true })` (bkz. `useVoiceChannel.ts`'in `join()`'i) bunlar olmadan ya izin diyaloğunda asılı kalır ya da gerçek mikrofon bulamayıp hata verir.
- **Akış:** kullanıcı 1 & 2 kendi context'lerinde register olur (register zaten oturum açtırıyor — ayrı bir login adımına gerek yok) → kullanıcı 1 sunucu + ses kanalı oluşturup katılır → kullanıcı 1 davet kodu üretir (`InviteController`'ın rate limit'ine takılma riski yok — bkz. 2, limit sunucu başına dakikada 10, her koşu kendi sunucusunu oluşturduğu için kova hep taze) → kullanıcı 2 kodla sunucuya katılır ve aynı ses kanalına girer → her iki tarafta da diğerinin katılımcı listesinde göründüğü doğrulanır → **gerçek `RTCPeerConnection.connectionState`'in `'connected'`'a ulaştığı doğrulanır** → kullanıcı 1 mikrofonunu kapatır, kullanıcı 2 tarafında mute göstergesi doğrulanır → kullanıcı 1 kanaldan ayrılır, kullanıcı 2 tarafında katılımcının listeden kaybolduğu doğrulanır.
- **`window.__e2eVoicePeers` — test-only, DEV-build-only görünürlük kancası (`useVoiceChannel.ts`):** hook'un normal dönüş değeri gerçek `RTCPeerConnection` nesnelerini hiç dışa vermiyor (sadece türetilmiş state — `remoteStreams`, `participants`). Bu olmadan test sadece "UI eninde sonunda bir katılımcı satırı gösterdi"ni doğrulayabilirdi, gerçek bir WebRTC bağlantısının fiilen `'connected'`'a ulaştığını asla kanıtlayamazdı — 4. bölümdeki mock'lanmış `useVoiceChannel` birim testlerinin (vitest, `FakeRTCPeerConnection`) yapısal olarak kapsayamadığı tam da bu: sahte nesne kendi `connectionState`'ini asla kendiliğinden geçişletmiyor, o testler bunu elle set ediyor, yani gerçek bir sinyalleşme/ICE hatasının bağlantıyı asıl `'connected'`'a hiç ulaştırmadan takılı bırakmasını yakalayamazlar. `import.meta.env.DEV` ile korunuyor — production build'de Vite bu bloğu tamamen eler (davranış değişikliği/expojur yok), sadece `peersRef.current` Map referansını `window`'a yayınlıyor, davranışı değiştirmiyor.
- **Zamanlama:** sabit `sleep()` yok — `expect.poll(...).toEqual(['connected'])` (20s timeout) gerçek async ICE müzakeresini bekliyor. Locator tabanlı doğrulamalar (`toBeVisible`/`toBeHidden`) zaten Playwright'in kendi otomatik-yeniden-deneme mekanizmasını kullanıyor.
- **Doğrulama (bu oturumda):** `npx playwright test voice-channel.spec.ts` ardışık **3 kez** çalıştırıldı (headless) — üçü de **1 passed** (5.6s / 9.9s / 8.2s), flaky değil. Backend loglarında gerçek SDP offer/answer (`a=fingerprint:sha-256 ...`) ve `typ host` ICE candidate'ları görüldü — iki taraf da aynı makinede olduğu için host candidate'lar yetiyor, STUN'a bile gerek kalmadan birkaç saniye içinde `'connected'`'a ulaşıldı. **Dürüst not:** bu ortamda ICE negotiation güvenilmez çıkmadı, `'connecting'`/`'checking'` gibi bir duruma razı olmaya gerek kalmadı — ama bu sonuç bu makineye/ağa özgü (iki context aynı host'ta, gerçek bir NAT/firewall yok); farklı bir CI runner'ında (ileride eklenirse) host candidate'ların yeterli olmayabileceği, STUN'a bağımlı kalınabileceği unutulmamalı.
- Bu akışta da 2 gerçek locator belirsizliği bulunup düzeltildi (geçici gevşetme değil): `getByRole('button', { name: 'Kapat' })` "Mikrofonu Kapat" ile, `getByRole('button', { name: 'Katıl' })` "Bir Sunucuya Katıl" ile substring çakışıyordu — ikisi de `exact: true` ile çözüldü.

**Test verisi temizliği — kararı ve gerekçesi: otomatik DB temizliği YOK.**
- Her test kullanıcı adı/email/sunucu adı/mesaj içeriği `Date.now()` ile damgalanıyor — aynı anda iki koşu (veya aynı koşunun tekrarları) asla aynı satırlara çarpmaz, bir teardown adımının sağlayacağı izolasyonun aynısını sağlıyor.
- `backend_dev`, paylaşımlı/production bir veritabanı değil, tek geliştiricinin yerel veritabanı — tekrarlanan e2e koşularından birikecek birkaç `e2e_user_<timestamp>` satırı, tarayıcıdan elle test etmenin zaten bıraktığı türden bir kalıntı, temizlememenin bir maliyeti yok.
- `playwright.config.ts`'te `workers: 1` bilinçli olarak sabitlendi — iki worker'ın `Date.now()` tabanlı "benzersiz" değerlerinin aynı milisaniyeye denk gelip çarpışması ihtimalini (ne kadar düşük olursa olsun) sıfırlıyor.
- Bu karar, veritabanı paylaşımlı hale geldiğinde (örn. e2e ileride CI'a eklenirse, bkz. aşağı) geçerliliğini yitirir — o noktada gerçek izolasyon (her `afterEach`'te `Backend.Repo` truncate'i veya ayrı bir `backend_e2e` veritabanı) gerekir; bu, `e2e/auth-and-chat.spec.ts`'in kendi başlık yorumunda da not edildi.

**Doğrulama (bu oturumda):** `npm run test:e2e` ardışık **3 kez** çalıştırıldı — üçü de **1 passed**, flaky değil. İlk koşuda `backend_dev`'de bekleyen migration'lar bulundu (`mix ecto.migrate` ile çözüldü — bu oturumda önceki turlarda eklenen çok sayıda migration `backend_test`'e uygulanmıştı ama `backend_dev`'e hiç uygulanmamıştı) ve bir locator belirsizliği (`getByRole('button', { name: 'Oluştur' })` hem "Sunucu Oluştur" hem "Oluştur" butonlarına substring eşleşiyordu, `exact: true` ile çözüldü) — ikisi de testin kendisinde/ortamda gerçek, kalıcı düzeltmelerdi, geçici bir gevşetme değil.

**CI'a henüz eklenmedi** — `.github/workflows/ci.yml`'e bir `e2e` job'ı eklemek backend+frontend+Postgres'in CI runner'ında ayağa kaldırılmasını gerektiriyor (yerel `webServer` otomasyonunun CI'daki dengi + bir Postgres `services:` container'ı, bkz. 5.3), bu ayrı bir iş olarak bilinçli olarak ertelendi.

---

## 6. Faz 10 — Yeni Eklenen Özellikler

### 6.1 Mesaj Düzenleme (Message Editing)

**Şema — `is_edited` alanı (hem `messages` hem `dm_messages`):** Migration `20260714120000_add_is_edited_to_messages.exs` her iki tabloya da `is_edited :boolean` ekler.

**`backend/lib/backend/chat/message.ex` ve `backend/lib/backend/direct_messages/dm_message.ex` — `edit_changeset/2` (birebir aynı mantık):**
```elixir
@doc "Changeset for editing an existing message's content — always marks it as edited."
def edit_changeset(message, attrs) do
  message
  |> cast(attrs, [:content])
  |> validate_length(:content, max: 4000)
  |> validate_content_or_file()
  |> put_change(:is_edited, true)
end
```
Sadece `:content` cast edilir — `:user_id`/`:channel_id`/`:dm_room_id` **kasıtlı olarak değiştirilemez**; yetkilendirme tamamen çağıran context fonksiyonuna bırakılır (changeset'e değil).

**Yazar/oda doğrulaması — `Backend.Chat.update_message/2` (`chat.ex:150-181`):**
```elixir
def update_message(message_id, %{user_id: req_user_id, channel_id: req_channel_id} = attrs) do
  case fetch_message(message_id) do
    nil ->
      {:error, :not_found}

    %Message{user_id: user_id, channel_id: channel_id}
    when user_id != req_user_id or channel_id != req_channel_id ->
      {:error, :not_authorized}

    message ->
      message
      |> Message.edit_changeset(attrs)
      |> Repo.update()
      |> case do
        {:ok, updated} ->
          {:ok, updated |> Repo.preload(:user) |> Map.put(:reactions, list_reactions_for_message(message_id))}
        error ->
          error
      end
  end
end
```
`{:error, :not_authorized}` iki birleşik koşuldan biri sağlandığında tetiklenir: (a) istek sahibi mesajın orijinal yazarı değilse, VEYA (b) mesaj artık socket'in bağlı olduğu kanala/DM odasına ait değilse (kanal-scoping — `toggle_reaction/4` ile aynı desen, bir client'ın hiç yetkisi olmayan bir kanaldaki mesajı düzenleyip broadcast tetiklemesini engeller). `Backend.DirectMessages.update_dm_message/2` (`direct_messages.ex:169-209`) **birebir aynı mantığı** `dm_room_id` üzerinden uygular.

**Channel handler'ları — event ismi farkı:**

| Context | `handle_in` event | Broadcast event |
|---|---|---|
| `backend_web/channels/chat_channel.ex:75-93` | `"update_message"` | **`"message_updated"`** |
| `backend_web/channels/dm_channel.ex:77-95` | `"update_message"` | **`"dm_message_updated"`** |

```elixir
def handle_in("update_message", %{"message_id" => message_id, "content" => content}, socket) do
  attrs = %{content: content, user_id: socket.assigns.user_id, channel_id: socket.assigns.channel_id}
  case Chat.update_message(message_id, attrs) do
    {:ok, message} ->
      broadcast!(socket, "message_updated", serialize_message(message))
      {:reply, :ok, socket}
    {:error, :not_found} -> {:reply, {:error, %{reason: "message not found"}}, socket}
    {:error, :not_authorized} -> {:reply, {:error, %{reason: "not authorized"}}, socket}
    {:error, changeset} -> {:reply, {:error, %{errors: format_errors(changeset)}}, socket}
  end
end
```
Broadcast **tüm topic üyelerine** gider (yazan dahil) — "tek doğruluk kaynağı broadcast'tir" convention'ı.

**Frontend — `frontend/src/components/MessageItem.tsx`:** Bu dosya güncel haliyle **null-safe koruma yorumlarını taşır** (kullanıcı tarafından son turda eklendi):
```tsx
const [isEditing, setIsEditing] = useState(false);
// KORUMA: Eğer message.content null ise state'e boş dize ('') veriyoruz
const [editDraft, setEditDraft] = useState(message.content || '');
...
// KORUMA: editDraft'ın null/undefined olma ihtimaline karşı güvenli trim kontrolü
const canSave = (editDraft || '').trim() !== '' || !!message.file_url;

function saveEdit() {
  const trimmed = (editDraft || '').trim();
  if (!trimmed && !message.file_url) return;
  if (trimmed !== (message.content || '')) onEditMessage(trimmed);
  setIsEditing(false);
}
```
`isEditing`/`editDraft` **local component state**'idir, Zustand store'da tutulmaz — bilinçli bir tercih (dosyanın başındaki yorum: "purely ephemeral per-row UI, never shared or persisted, same reasoning as why the reaction picker needs no store state of its own either"). `Escape` düzenlemeyi iptal eder, `Enter` (Shift'siz) kaydeder. Bu component hem `Chat.tsx` (sunucu kanalları) hem `DMChatView.tsx` (DM'ler) tarafından **aynen** paylaşılır.

**Store bağlantısı (her ikisi de aynı desende):**
```ts
// useChatStore.ts
editMessage: (messageId, content) => editMessage(messageId, content),  // services/socket.ts'e delege
handleMessageUpdated: (msg) =>
  set((state) => ({ messages: state.messages.map((m) => (m.id === msg.id ? msg : m)) })),
```
`services/socket.ts`'teki `editMessage`/`editDmMessage` sırasıyla `textChannel?.push('update_message', {...})` / `dmChannel?.push('update_message', {...})` yapar; `useSocketStore.ts`'teki `onMessageUpdated` callback'i broadcast'i ilgili store'un `handleMessageUpdated`'ına yönlendirir.

### 6.2 Kanal Kategorileri (Channel Categories)

**Şema — `backend/lib/backend/chat/channel.ex` (tam dosya):**
```elixir
schema "channels" do
  field :name, :string
  field :type, :string, default: "text"
  field :position, :integer, default: 0
  belongs_to :server, Server
  belongs_to :parent, __MODULE__
  has_many :sub_channels, __MODULE__, foreign_key: :parent_id

  timestamps(type: :utc_datetime)
end
```
`parent_id`, `__MODULE__`'a (yani `Channel`'a) **kendine referans veren (self-referencing)** bir `belongs_to`'dur — bir kategori de, bir metin/ses kanalı da aynı `channels` tablosunda bir satırdır; kategoriler `type: "category"` ile ayırt edilir.

**Migration — `20260714130000_add_parent_id_and_position_to_channels.exs`:**
```elixir
# moduledoc: `parent_id` (self-referential) `nilify_all` kullanır, `delete_all`
# değil: bir kategoriyi silmek, altındaki kanalları "Kategorisiz"e döndürmeli,
# geçmişlerini kategoriyle birlikte silmemeli.
alter table(:channels) do
  add :parent_id, references(:channels, type: :binary_id, on_delete: :nilify_all)
  add :position, :integer, default: 0, null: false
end

create index(:channels, [:parent_id])
```

**Bir seviye derinlik kısıtlaması — hem create hem bulk-update changeset'inde paylaşılan validasyon:**
```elixir
def changeset(channel, attrs) do
  channel
  |> cast(attrs, [:name, :type, :server_id, :parent_id, :position])
  |> validate_required([:name, :type, :server_id])
  |> validate_inclusion(:type, ["text", "voice", "category"])
  |> validate_length(:name, min: 1, max: 50)
  |> validate_no_parent_for_category()
  |> unique_constraint([:server_id, :name])
  |> foreign_key_constraint(:server_id)
  |> foreign_key_constraint(:parent_id)
end

@doc "Changeset for bulk parent/position updates — see Backend.Servers.update_channel_positions/2."
def position_changeset(channel, attrs) do
  channel
  |> cast(attrs, [:parent_id, :position])
  |> validate_no_parent_for_category()
  |> foreign_key_constraint(:parent_id)
end

defp validate_no_parent_for_category(changeset) do
  type = get_field(changeset, :type)
  parent_id = get_field(changeset, :parent_id)
  if type == "category" and not is_nil(parent_id) do
    add_error(changeset, :parent_id, "categories cannot be nested")
  else
    changeset
  end
end
```
> Not: `type`'ın `"text"|"voice"|"category"` ile kısıtlanması **sadece `validate_inclusion` seviyesindedir** — DB'de bir CHECK constraint/enum yoktur.

**Toplu güncelleme — `Backend.Servers.update_channel_positions/2` (`servers.ex:207-256`):**
```elixir
def update_channel_positions(server_id, updates) do
  Repo.transaction(fn ->
    Enum.each(updates, &apply_position_update(server_id, &1))
  end)
  |> case do
    {:ok, _} ->
      channels = Chat.list_channels_for_server(server_id)
      broadcast_to_server(server_id, "channel_positions_updated", %{
        server_id: server_id,
        channels: Enum.map(channels, &channel_position_json/1)
      })
      {:ok, channels}

    {:error, reason} ->
      {:error, reason}
  end
end

defp apply_position_update(server_id, %{id: id} = update) do
  case Repo.get_by(Channel, id: id, server_id: server_id) do
    nil ->
      Repo.rollback(:not_found)

    channel ->
      attrs = Map.take(update, [:parent_id, :position])
      case channel |> Channel.position_changeset(attrs) |> Repo.update() do
        {:ok, _updated} -> :ok
        {:error, changeset} -> Repo.rollback(changeset)
      end
  end
end
```
- `Ecto.Multi` **değil**, düz `Repo.transaction/1` + içeride `Enum.each` + `Repo.rollback/1` kullanılır — herhangi bir güncelleme başarısız olursa (kategori altına kategori koyma girişimi, bulunamayan kanal id'si vb.) **tüm batch geri alınır** (hepsi ya da hiçbiri).
- Server-scoping: `Repo.get_by(Channel, id: id, server_id: server_id)` — başka bir sunucunun kanalını id tahmin ederek taşımaya çalışmak sessizce `:not_found` ile rollback'e düşer.
- Başarı halinde **diff değil, sunucunun tam, güncel kanal listesi** `"channel_positions_updated"` olarak `server:<id>` topic'ine broadcast edilir — her client için diff uzlaştırmaktan daha basit, ve maliyeti normal bir sayfa yenilemesinden farksızdır.

**Controller — `backend/lib/backend_web/controllers/server_controller.ex:73-105`:** `PATCH /api/servers/:server_id/channels/positions`, **sadece sunucu sahibi** (`Servers.owner?/2`) çağırabilir; aksi halde 403.

**Frontend gruplama — `frontend/src/stores/useServerStore.ts:26-54` (pure fonksiyon, store state'i değil):**
```ts
export interface ChannelGroup {
  category: Channel | null;
  channels: Channel[];
}

function byPosition(a: Channel, b: Channel): number {
  return a.position - b.position || a.name.localeCompare(b.name);
}

export function groupChannelsByCategory(channels: Channel[]): ChannelGroup[] {
  const categories = channels.filter((c) => c.type === 'category').sort(byPosition);
  const uncategorized = channels.filter((c) => c.type !== 'category' && !c.parent_id).sort(byPosition);
  const groups: ChannelGroup[] = [{ category: null, channels: uncategorized }];
  for (const category of categories) {
    const subChannels = channels
      .filter((c) => c.type !== 'category' && c.parent_id === category.id)
      .sort(byPosition);
    groups.push({ category, channels: subChannels });
  }
  return groups;
}
```
İlk grup her zaman `category: null` (Kategorisiz); sonra her kategori için bir grup, `position` (eşitlikte isim) ile sıralı.

**Katlanabilir Accordion UI — `frontend/src/hooks/useCollapsedCategories.ts` (36 satır, tam):**
```ts
const STORAGE_KEY = 'zircle_collapsed_categories';

function loadCollapsedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

export function useCollapsedCategories() {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(loadCollapsedIds);
  function toggleCategory(categoryId: string) {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      saveCollapsedIds(next);
      return next;
    });
  }
  return { collapsedIds, toggleCategory };
}
```
`localStorage` anahtarı `zircle_collapsed_categories` altında **tüm sunucular arasında paylaşılır** (kategori ID'leri global olarak unique UUID'ler olduğundan çakışma riski yok). Düz React `useState` — Zustand değil.

`Chat.tsx` render döngüsü (satır ~445-495): her kategori grubu için katlanabilir bir `channel-category-row` (▾ chevron, `toggleCategory` ile bağlı), sunucu sahibiyse kategoriye özel `#+`/`🔊+` ekleme butonları; "Kategorisiz" başlığı **sadece** sunucuda en az bir kategori varsa VE o grupta kanal varsa render edilir.

`CreateChannelModal.tsx`: kategori oluştururken `parentId` her zaman `undefined`'a zorlanır (kategoriler iç içe olamaz), `createServer(...).createChannel(trimmed, type, type === 'category' ? undefined : parentId)` ile `useServerStore`'a delege eder.

### 6.3 Mesaj Arama (Message Search)

> Bu özellik, bu doküman yazılmadan **hemen önceki** oturumda uçtan uca geliştirilmiştir — tüm ayrıntılar birinci elden doğrulanmıştır (kaynak: bu konuşmanın kendisi).

**Backend context fonksiyonları — `Backend.Chat.search_messages/2` (`chat.ex`) ve `Backend.DirectMessages.search_dm_messages/2` (`direct_messages.ex`), birebir simetrik:**

```elixir
@search_limit 50

def search_messages(channel_id, filters \\ %{}) do
  Message
  |> where([m], m.channel_id == ^channel_id)
  |> apply_text_filter(Map.get(filters, "query"))
  |> apply_author_filter(Map.get(filters, "author_id"))
  |> apply_has_file_filter(Map.get(filters, "has_file"))
  |> order_by([m], desc: m.seq)
  |> limit(@search_limit)
  |> preload(:user)
  |> Repo.all()
  |> attach_reactions()
end

defp apply_text_filter(query, text) when text in [nil, ""], do: query
defp apply_text_filter(query, text) do
  pattern = "%" <> escape_like(text) <> "%"
  where(query, [m], ilike(m.content, ^pattern))
end

defp apply_author_filter(query, author_id) when author_id in [nil, ""], do: query
defp apply_author_filter(query, author_id) do
  case Ecto.UUID.cast(author_id) do
    {:ok, _} -> where(query, [m], m.user_id == ^author_id)
    :error -> where(query, [m], false)
  end
end

defp apply_has_file_filter(query, has_file) when has_file in [true, "true"],
  do: where(query, [m], not is_nil(m.file_url))
defp apply_has_file_filter(query, _has_file), do: query

# ILIKE'ın kendi wildcard karakterlerini (%, _) kullanıcı girdisinde escape
# eder — kullanıcının aradığı metinde gerçek bir "%" veya "_" karakteri
# varsa bunlar SQL wildcard'ı gibi değil, düz karakter gibi eşleşsin diye.
defp escape_like(text) do
  text
  |> String.replace("\\", "\\\\")
  |> String.replace("%", "\\%")
  |> String.replace("_", "\\_")
end
```

**Filtreler:** `"query"` (`ILIKE`, wildcard-escape'li — bkz. yukarıdaki `escape_like/1`, SQL/ILIKE injection'a karşı savunma), `"author_id"` (UUID validasyonlu — geçersiz UUID sessizce sıfır sonuç döner, hata fırlatmaz), `"has_file"` (boolean, `true`/`"true"` kabul eder). Sonuç `list_messages/2`'nin aksine **cursor'lı sayfalanmaz** — sabit `@search_limit = 50` ile en yeni eşleşme önce.

**API endpoint'leri — router (`backend/lib/backend_web/router.ex`):**
```elixir
get "/channels/:channel_id/search", ChannelController, :search
get "/dm_rooms/:dm_room_id/search", DmController, :search
```
> Not: DM arama route'u bilinçli olarak `/api/dm_rooms/...` prefix'iyle eklendi — mevcut DM mesaj route'u (`/api/dms/:room_id/messages`) farklı bir prefix (`dms`) kullanır. Bu route talimatlarda açıkça bu şekilde istendiği için `dm_rooms` olarak eklendi; ilerideki bir refactor'da tutarlılık için `dms` prefix'ine taşınması düşünülebilir.

**Controller yetkilendirmesi (ilgili `messages/2` action'larıyla aynı desen):**
```elixir
# channel_controller.ex
def search(conn, %{"channel_id" => channel_id} = params) do
  with %Channel{} = channel <- Chat.get_channel(channel_id),
       true <- Servers.member?(channel.server_id, conn.assigns.current_user.id) do
    messages = Chat.search_messages(channel.id, params)
    json(conn, %{messages: Enum.map(messages, &message_json/1)})
  else
    _ -> conn |> put_status(:not_found) |> json(%{error: "Channel not found"})
  end
end
```
Sunucu/DM üyesi olmayan kullanıcılara **404** (403 değil — kanalın var olup olmadığını sızdırmamak için kasıtlı, `ChannelController.messages/2` ile aynı convention).

**Frontend — Zustand store'lara eklenen alanlar (`useChatStore.ts` ve `useDMStore.ts`, simetrik):**
```ts
searchQuery: string;
searchResults: ChatMessage[];
isSearching: boolean;
isSearchPanelOpen: boolean;
highlightedMessageId: string | null;

searchChannelMessages: (channelId, filters) => Promise<void>;  // useDMStore'da: searchDmMessages(roomId, filters)
closeSearchPanel: () => void;
jumpToMessage: (messageId: string) => Promise<void>;
clearHighlight: () => void;
```

**`jumpToMessage` — geriye dönük sayfa tarayarak mesaja odaklanma algoritması:**
```ts
jumpToMessage: async (messageId) => {
  set({ isSearchPanelOpen: false });
  let attempts = 0;
  while (
    !get().messages.some((m) => m.id === messageId) &&
    get().hasMoreMessages &&
    attempts < MAX_JUMP_PAGE_FETCHES   // = 20
  ) {
    await get().loadOlderMessages();
    attempts += 1;
  }
  if (get().messages.some((m) => m.id === messageId)) {
    set({ highlightedMessageId: messageId });
  }
},
```
Arama sonucu, o an ekranda yüklü olan mesaj penceresinde yoksa (kullanıcı arama sonucunda eski bir mesaja tıkladıysa), var olan `loadOlderMessages()` cursor-sayfalama action'ı **en fazla 20 kez** çağrılarak (güvenlik sınırı — çok eski bir mesajın sonsuz döngüye sokmaması için) mesaj bulunana veya `hasMoreMessages` `false` olana kadar geriye doğru taranır. Bulunursa `highlightedMessageId` set edilir.

**Görsel vurgulama — `MessageItem.tsx`'e eklenen `isHighlighted` prop'u:**
```tsx
<div id={`message-${message.id}`} className={`message${isHighlighted ? ' message-highlighted' : ''}`}>
```
`Chat.tsx`/`DMChatView.tsx`'te bir `useEffect`, `highlightedMessageId` her değiştiğinde:
```ts
useEffect(() => {
  if (!highlightedMessageId) return;
  document.getElementById(`message-${highlightedMessageId}`)?.scrollIntoView({
    behavior: 'smooth',
    block: 'center',
  });
  const timer = window.setTimeout(() => clearHighlight(), 2000);
  return () => window.clearTimeout(timer);
}, [highlightedMessageId, clearHighlight]);
```
Mesaja yumuşak kaydırma yapar ve **2 saniye sonra** `clearHighlight()` ile vurguyu otomatik kaldırır. CSS (`Chat.css`):
```css
.message-highlighted {
  background: rgba(114, 137, 218, 0.15);
  transition: background 0.3s;
}
```

**UI bileşenleri:** `frontend/src/components/SearchBar.tsx` (büyüteç input + 📎 "sadece dosyalı mesajlar" toggle filtresi, header'a `margin-left: auto` ile sağa yaslanmış), `frontend/src/components/SearchResultsPanel.tsx` (sağda açılan sonuç listesi — her satır avatar, yazar, zaman, içerik önizlemesi (2 satırla kırpılmış, `-webkit-line-clamp: 2`), dosya etiketi). İkisi de hem `Chat.tsx` (sunucu kanalı header'ı) hem `DMChatView.tsx` (DM header'ı) tarafından paylaşılır — her ikisi de aynı `chat-header` CSS class'ını kullandığından tek bir ortak component'le drop-in entegre edilebildi.

**Doğrulama (geliştirme sonunda çalıştırıldı, hepsi yeşil):**
```
mix compile --warnings-as-errors   → 0 hata
mix test                           → 55 test, 55 geçti
npm run build (tsc -b + vite build) → 0 TypeScript hatası
npm run test (vitest)              → 14 test, 14 geçti
npm run lint (oxlint)              → 0 uyarı
```

---

## 7. Bilinen Boşluklar / Devam Notları

Bu bölüm, ileride bu projeye devam edecek bir mühendis veya yapay zekanın "neden böyle bırakıldı, bilerek mi unutuldu mu" sorusunu sormasına gerek kalmadan doğrudan bilgilendirilmesi için kod okunarak tespit edilen **gerçek** boşlukları listeler (varsayım değildir):

| # | Boşluk | Konum | Etki |
|---|---|---|---|
| 1 | ~~`useDMStore.reset()`, `forceLogout()` tarafından çağrılmıyor~~ **Çözüldü** | `frontend/src/services/session.ts:27-35` | `forceLogout()` artık `useDMStore.getState().reset()`'i de (diğer store'larla birlikte: friend/server/chat/connection) çağırıyor — zorla çıkışta DM store'un `messages`/`rooms`/`activeRoomId` state'i de temizleniyor, paylaşılan cihaz senaryosunda önceki kullanıcının DM verisinin bir sonraki oturuma sızması artık mümkün değil |
| 2 | ~~`voice_channel.ex`'te duplicate-join koruması yok~~ **Çözüldü** | `backend/lib/backend_web/channels/voice_channel.ex` `join/3` | `join/3` artık `existing_peers`'i hesapladıktan hemen sonra (ama `Presence.track`'ten önce) `socket.assigns.user_id`'nin zaten o oda için track edilip edilmediğini kontrol ediyor; varsa `{:error, %{reason: "already_connected_elsewhere"}}` ile reddediyor. **Seçilen davranış: reddet, eskiyi atma** — eski bağlantıyı zorla koparmak kullanıcının başka bir cihazdaki aktif görüşmesini onun haberi olmadan kesebilirdi, reddetmek daha güvenli bir varsayılan. `Presence.track` çağrısı da bu turda `:after_join`'den `join/3`'ün içine (kontrolün hemen ardına) taşındı — `socket.channel_pid` Phoenix tarafından `join/3` çalışmadan önce zaten `self()`'e ayarlanmış olduğundan bu güvenli, ve check-then-track arasındaki TOCTOU penceresini asenkron `:after_join`'e bırakmaktan daha sıkı kapatıyor. **Reconnect güvenliği doğrulandı:** `Phoenix.Tracker.Shard`, track edilen her pid'i `Process.link/1` ile bağlıyor ve `trap_exit` ile çalışıyor (`deps/phoenix_pubsub/lib/phoenix/tracker/shard.ex`) — bir channel process öldüğünde temizlik bir heartbeat/grace-period beklemeden, link üzerinden **anında** tetikleniyor (bu, çok-node'lu replica-down tespiti için olan `down_period`/`permdown_period`'dan tamamen ayrı bir mekanizma, tek-node deploy'da devrede olan `Process.link`+`trap_exit` yolu). Bir test bunu kanıtlıyor: channel process'i sert şekilde öldür (`Process.exit(pid, :kill)`), `presence_diff`'in "leave" içerdiğini bekle, aynı user_id ile hemen yeniden join dene — başarılı |
| 3 | ~~`check_origin` prod'da `FRONTEND_URL` set edilmezse `false`'a düşer~~ **Çözüldü** | `backend/config/runtime.exs` (prod bloğu) | Artık `FRONTEND_URL` set edilmemişse boot sırasında `raise` ile açık hata fırlatılıyor; WebSocket origin kontrolü yanlış konfigürasyonla sessizce devre dışı kalamıyor |
| 4 | ~~`ssl_opts: [verify: :verify_none]` (prod Postgres)~~ **Çözüldü** — ve bir alt-boşluk daha (wildcard SAN sertifikası) Render'da gerçek bir prod kesintisi olarak ortaya çıkıp ayrıca çözüldü | `backend/config/runtime.exs` (prod bloğu), `backend/lib/backend/application.ex`, `backend/lib/backend/repo.ex` | Varsayılan artık `DATABASE_SSL_VERIFY=verify_peer` (env var set edilmezse de bu) — `cacerts: :public_key.cacerts_get()` (OTP sistem CA bundle'ı) veya `DATABASE_CA_CERT_FILE` ile verilen özel CA dosyasıyla sertifika doğrulanıyor. `verify_none` yalnızca açık env var ile seçilebiliyor ve seçildiğinde `Backend.Application.start/2` boot sırasında `Logger.warning` ile MITM riskini açıkça logluyor. **Ek olarak:** `verify_peer` prod'da devreye girdikten sonra Render'ın managed Postgres'i her auto-deploy'da `{bad_cert, hostname_check_failed}` ile çöktü — Render'ın wildcard SAN sertifikası (`*.frankfurt-postgres.render.com`) Erlang'ın varsayılan hostname eşleşmesini geçemiyordu. `Backend.Repo.init/2`'ye (**`config/runtime.exs`'e değil** — bkz. [Bölüm 3.5](#35-repo-konfigürasyonu)'teki ayrıntılı gerekçe: bir fun değeri runtime.exs'in Config.Provider tarafından persist edilen config'ine giremiyor, girerse bir sonraki boot'ta konteyner hiç ayağa kalkamıyor) `customize_hostname_check: [match_fun: :public_key.pkix_verify_hostname_match_fun(:https)]` eklenerek çözüldü, `backend/test/backend/repo_test.exs` ile doğrulandı |
| 5 | ~~`RequireCloudflarePlug` dev/test'te no-op~~ **Kısmen çözüldü** | `backend/config/dev.exs:66` (yorumda), `backend/test/backend_web/plugs/require_cloudflare_plug_test.exs` | Dev ortamının kendisi hâlâ no-op (bilinçli tercih, değiştirilmedi — yerelde önünde Cloudflare yok). Ama artık plug'ın enforce-mode davranışı (secret set edilmişken doğru/eksik/yanlış/çoklu-değer header senaryoları) `Application.put_env` ile izole `call/2` testleriyle kapsanıyor — önceden hiç kanıtlanmamış bir varsayımdı, artık test edilmiş bir davranış |
| 6 | ~~Credo `--strict` ve Dialyzer, precommit/CI akışının parçası değil~~ **Çözüldü** | `backend/mix.exs` `aliases()` | İkisi de `precommit`'e eklendi (`credo --strict` düz alias string'i olarak; `dialyzer` `hex_audit!/1` ile aynı `MIX_ENV` alt-süreç deseniyle, `dialyzer!/1` — gerekçesi [Bölüm 5.1](#51-backend--exunit-credo-dialyzer)'de). Önce ölçüldü: sıcak PLT ile dialyzer ~5.3s, credo ~1.2s, uçtan uca `mix precommit` ~33.6-34s — kabul edilebilir bulunup eklendi (CI pipeline'ı ayrı bir iş, henüz kurulmadı). Credo'nun önceden verdiği 14 "windows line endings" bulgusu, kök nedeni çözen yeni `.gitattributes` ile ortadan kalktı; kalan 2 gerçek bulgu da düzeltildi — `mix credo --strict` artık 0 bulgu |
| 7 | ~~CVE-etiketli bir dependency-audit kaydı bulunamadı~~ **Çözüldü** | `backend/mix.exs` (`deps()` + `precommit` alias'ı) | `mix_audit` eklendi; `precommit` artık `deps.audit` (`mirego/elixir-security-advisories`) VE `hex.audit` (Hex client'ına gömülü, OSV.dev/EEF verisi) olmak üzere iki bağımsız advisory kaynağını da çalıştırıyor — ikisi de gerçek, ANINDA kıran bir gate (`hex.audit`'in kendi ertelenmiş `System.at_exit` halt'ı yerine ayrı bir `mix` alt-süreci + `Mix.raise/1` kullanılarak; detay [Bölüm 2.5](#25-dependency-sürümleri--cve-notu)'te). Bu iki-araçlı kurulum sayesinde bulunan gerçek CVE (`mint 1.9.2`, EEF-CVE-2026-59249 — sadece `hex.audit` yakaladı, `deps.audit`'in db'sinde o an yoktu) `mint`'i hedefli şekilde (`mix deps.update mint`, başka hiçbir paket etkilenmeden) `1.9.3`'e yükselterek çözüldü ve doğrulandı. **Sonraki bir turda gate yine gerçek bir bulgu yakaladı:** `bandit 1.12.0` için `EEF-CVE-2026-65623` (HIGH, "Quadratic CPU blow-up reassembling fragmented WebSocket messages") — bu kez `deps.audit` tarafından bulundu. `mix deps.update bandit` ile (yine hedefli, `mix.exs`'teki `~> 1.12` kısıtı içinde kalarak) `1.12.4`'e yükseltildi; `plug_crypto` da yan bağımlılık olarak `2.1.1 → 2.2.0`'a güncellendi. `mix precommit` (135 test) sonrasında temiz geçti. Şu an her iki araç da temiz |
| 8 | `/api/dm_rooms/:dm_room_id/search` route'u, mevcut `/api/dms/...` prefix konvansiyonundan sapıyor | `backend/lib/backend_web/router.ex` | Faz 10 arama talimatında bu route açıkça bu şekilde istendi; gelecekte tutarlılık için `/api/dms/:room_id/search`'e taşınması değerlendirilebilir |
| 9 | `Ecto.Multi` projede **hiç kullanılmıyor** | proje geneli | Tüm çoklu-adım DB işlemleri (friendship race condition, channel position bulk update) `Repo.transaction/1` + manuel `Repo.rollback/1` ile yapılıyor — işlevsel olarak eşdeğer ama `Ecto.Multi`'nin sağladığı adım-adım geri izlenebilirlik/adlandırma yok |
| 10 | ~~WebSocket kanal trafiği (`shout`, `update_message`, `toggle_reaction`, WebRTC sinyalleşmesi) hiç rate-limit'lenmiyor~~ **Çözüldü** | `backend/lib/backend_web/channels/channel_rate_limiter.ex`, `chat_channel.ex`, `dm_channel.ex`, `voice_channel.ex` | Artık her ilgili `handle_in`, `Backend.RateLimiter`'ı (Hammer/ETS) `socket.assigns.user_id` + event tipi + channel/room/peer bazlı key'lerle saran `BackendWeb.ChannelRateLimiter.limited?/5`'i çağırıyor; aşım durumunda kanal kapatılmıyor, sadece ilgili event'in etkisi (broadcast/DB yazma/Presence güncellemesi/relay) atlanıyor. Limit tablosu için [Bölüm 2.3](#23-rate-limiting--hammer-ets)'e bakın. Frontend'in `{:error, %{reason: "rate_limited"}}` cevabını henüz ele almaması ayrı, bilinçli olarak bu işin dışında bırakılmış bir takip maddesi (bkz. madde 11) |
| 11 | Frontend, kanal `push()` çağrılarından dönen `{:error, %{reason: "rate_limited"}}` cevabını ele almıyor | `frontend/src/services/socket.ts` | `chat`/`dm`/`voice` kanallarındaki `shout`/`update_message`/`toggle_reaction`/`update_status`/`video_offer`/`video_answer`/`ice_candidate` için yapılan `push()` çağrılarının hiçbirinde bir `.receive("error", ...)` handler'ı yok (yalnızca join response'ları için var) — bir kullanıcı rate limit'e takılırsa şu an sessizce hiçbir şey olmuyor (mesaj UI'da görünmüyor ama kullanıcıya "gönderilemedi" gibi bir geri bildirim de yok). Bilinçli olarak ayrı bırakıldı çünkü store'ların "tek doğruluk kaynağı broadcast'tir" convention'ını nasıl etkileyeceği ayrıca konuşulmalı |
| 12 | Frontend, `voice_channel.ex` `join/3`'ün yeni `{:error, %{reason: "already_connected_elsewhere"}}` cevabını sadece genel bir hata olarak gösteriyor, özel bir mesajla değil | `frontend/src/services/socket.ts` `joinVoiceChannel`, `frontend/src/hooks/useVoiceChannel.ts` | Madde 11'den farklı: burada bir `.receive("error", ...)` handler'ı **zaten var** (`socket.ts:266-268`, `reject(new Error(resp.reason ?? ...))`) ve `useVoiceChannel.ts:636` bunu `setError(err.message)` ile kullanıcıya gösteriyor — yani tamamen sessiz değil. Ama gösterilen mesaj ham `reason` string'i (`"already_connected_elsewhere"`), kullanıcıya anlamlı bir Türkçe mesaj değil (`"channel not found"`/`"not authorized"` için de aynı durum zaten mevcuttu, yeni bir regresyon değil). Madde 11'deki frontend-error-handling turunda birlikte ele alınması öneriliyor |
| 13 | ~~Yapılandırılmış (JSON) log yok, sadece insan-okunur text format~~ **Çözüldü** | `backend/config/runtime.exs` (prod bloğu), `backend/mix.exs` | `logger_json ~> 7.0` eklendi; prod'da `:default_handler`'ın formatter'ı `LoggerJSON.Formatters.Basic`'e çevrildi (`metadata: :all`). Dev/test dokunulmadı (hâlâ insan-okunur). Detay [Bölüm 2.8](#28-gözlemlenebilirlik-yapılandırılmış-log-ve-periyodik-metrikler)'de |
| 14 | ~~Aktif ses kanalı sayısı, bağlı kullanıcı sayısı ve TURN/relay kullanım oranı hakkında hiçbir periyodik/agregat görünürlük yok~~ **Çözüldü** | `backend/lib/backend/telemetry/periodic_reporter.ex`, `backend/lib/backend/telemetry/ice_stats_counter.ex` | Yeni `Backend.Telemetry.PeriodicReporter` GenServer'ı (supervision tree'ye eklendi) 5 dakikada bir (config'den değiştirilebilir) tek bir yapılandırılmış `Logger.info` satırıyla aktif ses kanalı/kullanıcı sayısını (Presence'tan agregat edilmiş) ve relay-vs-toplam oranını (yeni ETS-tabanlı `IceStatsCounter`'dan) basıyor. Detay [Bölüm 2.8](#28-gözlemlenebilirlik-yapılandırılmış-log-ve-periyodik-metrikler)'de |
| 15 | Login/register akışında 401/hata durumlarında buton "Please wait" durumunda sonsuza kadar takılı kalabiliyor, kullanıcıya hata mesajı gösterilmiyor | frontend, Auth akışı | Canlıda gözlemlendi (2026-07-21). Bilinçli olarak şimdilik ertelendi, düzeltilmesi önerilir |
| 16 | E-posta değişikliği (`PATCH /api/account/email`, UserSettingsModal → Hesabım) doğrulama linki olmadan anında uygulanıyor | `backend/lib/backend/accounts/user.ex` `email_changeset/2`, `backend/lib/backend_web/controllers/account_controller.ex` | **Bilinçli karar, boşluk değil.** Gerekçe: (1) gerçek bir mail sağlayıcı hâlâ kurulu değil — `Backend.Mailer` (Swoosh) dev'de sadece `Swoosh.Adapters.Local` + `/dev/mailbox` preview'ı olarak var, prod'a hiç bağlanmamış (`config/runtime.exs`'teki SMTP/SES kurulum notu hâlâ yorum satırında) ve kod tabanında `Backend.Mailer.deliver/1`'e tek bir çağrı bile yok; (2) bu proje şu an gerçek bir kullanıcı tabanını korumuyor (bkz. aşağıdaki Faz 4 notu) — doğrulamasız bir e-posta değişikliğinin asıl riski (birinin sizin hesabınızın e-postasını sessizce kendi adresine çevirip hesabı ele geçirmesi) ancak gerçek/değerli hesaplar var olduğunda anlamlı. Riski azaltan tek katman: değişiklik mevcut şifrenin yeniden girilmesini zorunlu kılıyor (Discord tarzı re-auth), yani çalınmış bir session token'ı tek başına yeterli değil. Gerçek kullanıcı tabanı oluşursa bu madde öncelikli ele alınmalı — o noktada zaten bir mail sağlayıcı kurmak gerekecek, doğrulama e-postası o kurulumun doğal bir uzantısı olur. |

**Not — Faz 4 (KVKK/gizlilik) bilinçli olarak ertelendi:** Bu proje şu an kişisel/portfolyo amaçlı kullanılmaktadır, gerçek kullanıcı verisi işlenmesi planlanmadığı için resmi KVKK uyum süreci (gizlilik politikası, VERBİS kaydı vb.) bilinçli olarak ertelenmiştir. Gerçek kullanıcı tabanı oluşursa bu maddeler öncelikli olarak ele alınmalıdır.

---

*Bu doküman, projedeki gerçek kod dosyaları (backend `lib/`, frontend `src/`, migration'lar, config dosyaları, testler) birebir okunarak hazırlanmıştır. Kod değiştikçe bu dosyanın da güncellenmesi önerilir — özellikle [Bölüm 7](#7-bilinen-boşluklar--devam-notları)'deki maddeler çözüldükçe buradan kaldırılmalı veya "çözüldü" olarak işaretlenmelidir.*

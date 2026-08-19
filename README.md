# Zircle

Discord benzeri bir topluluk ve sohbet uygulaması — sunucular/kanallar, birebir mesajlaşma, arkadaşlık sistemi ve WebRTC tabanlı sesli kanallar.

**Canlı demo:** [zircle.vercel.app](https://zircle.vercel.app)

## Özellikler

- Sunucular (guild'ler), metin/ses kanalları ve kategoriler
- Birebir DM'ler, arkadaşlık istekleri ve çevrimiçi durum takibi
- WebRTC ile sesli kanallar — perfect negotiation deseniyle güvenilir bağlantı kurulumu
- Dosya/resim paylaşımı — sunucu tarafında imza (magic-bytes) doğrulamalı, yerel disk veya S3-uyumlu depolama desteği
- Gerçek zamanlı bildirimler ve okunmamış mesaj takibi (Phoenix Channels üzerinden)
- Kötüye kullanıma karşı çok katmanlı rate limiting (HTTP + WebSocket kanalları)

## Teknoloji Yığını

**Backend:** Elixir, Phoenix, Bandit, Ecto, PostgreSQL

**Frontend:** React 19, TypeScript, Vite, Zustand

**Masaüstü:** Electron

## Proje Yapısı

Bu bir monorepo'dur:

- `backend/` — Phoenix API + WebSocket sunucusu
- `frontend/` — React tabanlı web istemcisi
- `desktop/` — Electron ile paketlenmiş masaüstü istemcisi

## Kurulum

Detaylı yerel kurulum ve deploy talimatları için [DEPLOYMENT.md](./DEPLOYMENT.md) dosyasına bakın.

## License

Bu proje kapalı kaynaktır. Ayrıntılar için [LICENSE](./LICENSE) dosyasına bakın.

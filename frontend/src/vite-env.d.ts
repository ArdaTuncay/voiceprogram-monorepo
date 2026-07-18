/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the backend API/socket, e.g. "https://backend.onrender.com". Unset in dev — falls back to the same-origin Vite proxy. */
  readonly VITE_API_URL?: string;

  /**
   * Production TURN relay (see useVoiceChannel.ts's resolveIceServers()) —
   * STUN alone can't traverse symmetric NAT/restrictive corporate
   * firewalls, only a real TURN server can. Two ways to configure one,
   * checked in this order:
   *
   * 1. VITE_TURN_API_URL — a GET endpoint returning fresh ICE server
   *    credentials as JSON, either a bare array (e.g. Metered.ca's
   *    `/api/v1/turn/credentials` response) or `{ iceServers: [...] }`
   *    (e.g. a backend proxy in front of Xirsys, whose own API needs a
   *    server-side-only secret). Preferred for managed TURN providers,
   *    since their credentials are normally short-lived.
   * 2. VITE_TURN_URL/USERNAME/PASSWORD — a single static TURN server (e.g.
   *    self-hosted coturn) with long-lived credentials. All three must be
   *    set together or none are used.
   *
   * Falls back to Google's public STUN server if neither is configured —
   * today's dev/LAN behavior, and still works between peers with no
   * symmetric NAT/restrictive firewall between them.
   */
  readonly VITE_TURN_API_URL?: string;
  readonly VITE_TURN_URL?: string;
  readonly VITE_TURN_USERNAME?: string;
  readonly VITE_TURN_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

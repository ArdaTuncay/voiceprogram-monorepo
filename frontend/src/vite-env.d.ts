/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the backend API/socket, e.g. "https://backend.onrender.com". Unset in dev — falls back to the same-origin Vite proxy. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

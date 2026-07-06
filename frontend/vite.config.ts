import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    host: true,
    // No `allowedHosts` entry needed for ngrok's random *.ngrok-free.dev
    // subdomains: Vite's Host-header allowlist (its DNS-rebinding guard)
    // only activates when `server.https` is unset, and basicSsl() above
    // always sets it — verified this tunnels correctly with zero config.
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/socket': {
        target: 'http://localhost:4000',
        ws: true,
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
})

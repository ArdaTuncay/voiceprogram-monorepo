import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Yerel ağ ve localhost testi için basicSsl eklentisini kaldırdık
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
  server: {
    host: true, // Aynı ağdaki diğer cihazların (telefon vb.) erişebilmesi için dışarı açar
    hmr: {
      protocol: 'ws',      // wss yerine düz ws protokolüne zorluyoruz
      host: 'localhost',
      port: 5173
    },
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        secure: false, // Yerel bağlantıların kırılmasını engeller
      },
      '/socket': {
        target: 'http://localhost:4000',
        ws: true,
        changeOrigin: true,
        secure: false,
      },
      '/uploads': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
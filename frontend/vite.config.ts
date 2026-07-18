import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Yerel ağ ve localhost testi için basicSsl eklentisini kaldırdık
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Vitest's own default include (**/*.{test,spec}.ts) would otherwise
    // also pick up e2e/*.spec.ts and try to run Playwright's test() API as
    // if it were a vitest test, failing with "Playwright Test did not
    // expect test() to be called here" — e2e/ has its own runner
    // (`npm run test:e2e`, see playwright.config.ts), not this one.
    exclude: ['**/node_modules/**', 'e2e/**'],
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
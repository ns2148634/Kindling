import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/Kindling/',
  plugins: [
    VitePWA({
      // 'prompt' = new SW waits in `waiting`; we show a banner, user clicks to reload.
      // Never auto-reloads mid-session.
      registerType: 'prompt',

      // We import `virtual:pwa-register` in main.js manually.
      injectRegister: null,

      // Enable SW in dev mode for offline/update testing.
      devOptions: { enabled: true },

      manifest: {
        name: '信心王國',
        short_name: 'Kindling',
        description: '每天一點點，王國慢慢亮起來',
        theme_color: '#070a14',
        background_color: '#070a14',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/Kindling/',
        scope: '/Kindling/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },

      workbox: {
        // Precache all build artefacts (hashed JS/CSS/HTML) + static assets.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2}'],

        // Card JSONs: NetworkFirst so new cards appear after a re-deploy;
        // falls back to cache when offline.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/cards\/[^/]+\.json$/.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'kindling-cards-v1',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
});

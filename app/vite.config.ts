import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves a project site from /<repo>/. Override with BASE_PATH
// when deploying elsewhere (a custom domain wants "/").
const base = process.env['BASE_PATH'] ?? '/undeintru/';

export default defineConfig({
  base,
  build: {
    target: 'es2023',
    sourcemap: true,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Unde intru',
        short_name: 'Unde intru',
        description:
          'La ce licee poate intra copilul tău, pe baza mediilor de admitere din anii trecuți.',
        lang: 'ro',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#e9e7e0',
        theme_color: '#e9e7e0',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // The data files are static and versioned by path (data/v1/...), and
        // the typefaces are served from this origin rather than a font CDN, so
        // precaching both keeps the app fully usable — and legible — offline.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,json,woff2}'],
      },
    }),
  ],
});

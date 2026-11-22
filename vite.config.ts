import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'SkpXR — Visor WebXR para SketchUp',
        short_name: 'SkpXR',
        description:
          'Visor WebXR offline para modelos SketchUp (.skp, .glb, .gltf, .dae, .kmz, .obj) con passthrough AR, gestión de capas, elementos y escenas animadas.',
        lang: 'es',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0b111b',
        theme_color: '#0b111b',
        categories: ['productivity', 'utilities', 'design'],
        icons: [
          {
            src: './icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: './icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: './icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: './icons/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
        file_handlers: [
          {
            action: './',
            accept: {
              'application/vnd.sketchup.skp': ['.skp'],
              'model/gltf-binary': ['.glb'],
              'model/gltf+json': ['.gltf'],
              'model/vnd.collada+xml': ['.dae'],
              'application/vnd.google-earth.kmz': ['.kmz'],
              'text/plain': ['.obj'],
            },
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm,skp,json}'],
        maximumFileSizeToCacheInBytes: 15 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          openskp: ['openskp', 'fflate'],
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
  },
});

import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    tanstackRouter({ autoCodeSplitting: true, target: 'react' }),
    react(),
    tailwindcss(),
    VitePWA({
      manifest: {
        background_color: '#fbf7f1',
        description: 'Everything in our household that is due on a date, by category.',
        display: 'standalone',
        lang: 'en',
        name: 'Household Brain',
        short_name: 'Household',
        start_url: '/',
        theme_color: '#f57c00',
      },
      pwaAssets: { config: true },
      registerType: 'prompt',
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        // Firebase Auth's sign-in handler must always come from the network.
        navigateFallbackDenylist: [/^\/__\//u],
      },
    }),
  ],
})

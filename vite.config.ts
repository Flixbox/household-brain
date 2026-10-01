import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      pwaAssets: { config: true },
      manifest: {
        name: 'Household Brain',
        short_name: 'Household',
        description: 'Everything in our household that is due on a date, by category.',
        lang: 'en',
        display: 'standalone',
        start_url: '/',
        theme_color: '#f57c00',
        background_color: '#fbf7f1',
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        // Firebase Auth's sign-in handler must always come from the network.
        navigateFallbackDenylist: [/^\/__\//],
      },
    }),
  ],
})

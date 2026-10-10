import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig, loadEnv } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => {
  if (mode === 'production' && loadEnv(mode, process.cwd()).VITE_USE_EMULATORS === 'true') {
    throw new Error('VITE_USE_EMULATORS=true in a production build: check apps/web/.env.local and apps/web/.env.production.local')
  }
  return {
    plugins: [
      tanstackRouter({ autoCodeSplitting: true, target: 'react' }),
      react(),
      // React Compiler memoises components and hooks at build time (#69), so no hand-written
      // `useMemo`/`useCallback` is needed for speed. It compiles the packages too: Vite builds them as source.
      babel({ presets: [reactCompilerPreset()] }),
      tailwindcss(),
      VitePWA({
        manifest: {
          background_color: '#fbf7f1',
          description: 'Everything in our household that is due on a date, by category.',
          display: 'standalone',
          // The app's identity, so it no longer depends on start_url (#29).
          id: '/',
          lang: 'en',
          name: 'Household Brain',
          // For the richer install dialog (#29): one wide (desktop) and one narrow (phone) screenshot,
          // taken from the e2e build with made-up demo entries, never the household's own.
          screenshots: [
            { form_factor: 'wide', label: 'Entries by category', sizes: '1280x800', src: '/screenshots/wide.png', type: 'image/png' },
            { form_factor: 'narrow', label: 'Entries by category', sizes: '412x915', src: '/screenshots/narrow.png', type: 'image/png' },
          ],
          short_name: 'Household',
          start_url: '/',
          theme_color: '#f57c00',
        },
        pwaAssets: { config: true },
        registerType: 'prompt',
        workbox: {
          // Only the install dialog shows the screenshots: not worth storing offline.
          globIgnores: ['screenshots/**'],
          // No `webmanifest`: the plugin adds its manifest itself, and a second entry with another
          // revision made Workbox refuse the whole precache list, so no new version installed (#136).
          globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
          // Firebase Auth's sign-in handler must always come from the network.
          navigateFallbackDenylist: [/^\/__\//u],
        },
      }),
    ],
  }
})

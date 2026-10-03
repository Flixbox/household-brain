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
  }
})

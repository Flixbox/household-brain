import tailwindcss from '@tailwindcss/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  if (mode === 'production' && loadEnv(mode, process.cwd()).VITE_USE_EMULATORS === 'true') {
    throw new Error('VITE_USE_EMULATORS=true in a production build: check apps/web/.env.local and apps/web/.env.production.local')
  }
  return {
    plugins: [
      react(),
      // React Compiler memoises components and hooks at build time (#69), so no hand-written
      // `useMemo`/`useCallback` is needed for speed. It compiles the packages too: Vite builds them as source.
      babel({ presets: [reactCompilerPreset()] }),
      tailwindcss(),
    ],
  }
})

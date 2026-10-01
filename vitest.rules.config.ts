import { defineConfig } from 'vitest/config'

// Security-rules tests: they need the Firestore emulator, so they run through `pnpm test:emulated`.
export default defineConfig({
  test: {
    fileParallelism: false,
    include: ['tests/rules/**/*.test.ts'],
  },
})

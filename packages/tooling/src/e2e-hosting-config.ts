/**
 * Writes `firebase.e2e.json` for the end-to-end tests (#150): `firebase.json` exactly as production
 * serves the app (headers, Content Security Policy, rewrites, caching), but from the e2e build, and
 * with the local Auth and Firestore emulators allowed in `connect-src`, which the e2e build talks to.
 * The Hosting emulator serves it, so the tests see the server and headers the live app has.
 *
 *   bun packages/tooling/src/e2e-hosting-config.ts
 */

interface Header { key: string, value: string }
interface FirebaseConfig {
  emulators: Record<string, { port?: number }>
  hosting: { headers: { headers: Header[], source: string }[], public: string }
}

/** The e2e copy of the hosting config: same rules, the e2e build, the emulators reachable. */
export const e2eHostingConfig = (config: FirebaseConfig): FirebaseConfig => {
  const emulators = ['auth', 'firestore'].map(name => `http://127.0.0.1:${config.emulators[name]?.port}`).join(' ')
  const withEmulators = (header: Header) =>
    header.key === 'Content-Security-Policy' ? { ...header, value: header.value.replace('connect-src ', `connect-src ${emulators} `) } : header
  return {
    ...config,
    hosting: {
      ...config.hosting,
      headers: config.hosting.headers.map(rule => ({ ...rule, headers: rule.headers.map(withEmulators) })),
      public: 'apps/web/dist-e2e',
    },
  }
}

if (import.meta.main) {
  const config: FirebaseConfig = await Bun.file('firebase.json').json()
  await Bun.write('firebase.e2e.json', `${JSON.stringify(e2eHostingConfig(config), null, 2)}\n`)
}

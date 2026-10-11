/**
 * Writes `firebase.e2e.json` for the end-to-end tests (#150): `firebase.json` exactly as production
 * serves the app (headers, Content Security Policy, rewrites, caching), but from the e2e build, and
 * with the local emulators allowed where the e2e build reaches them: Auth and Firestore in
 * `connect-src`, and Auth's sign-in frame in `frame-src`. The Hosting emulator serves it, so the tests
 * see the server and headers the live app has.
 *
 *   bun packages/tooling/src/e2e-hosting-config.ts
 */

interface Header { key: string, value: string }
interface FirebaseConfig {
  emulators: Record<string, { port?: number }>
  hosting: { headers: { headers: Header[], source: string }[], public: string }
}

// The repository's own firebase.json is trusted to have the shape it is read as.
const configFrom: (text: string) => FirebaseConfig = JSON.parse

const emulatorOrigin = (config: FirebaseConfig, name: string) => {
  const port = config.emulators[name]?.port
  if (!port) {
    throw new Error(`firebase.json sets no port for the ${name} emulator`)
  }
  return `http://127.0.0.1:${port}`
}

/** Adds `origins` to a CSP directive, failing when the policy has no such directive to extend. */
const allow = (policy: string, directive: string, origins: string) => {
  if (!policy.includes(`${directive} `)) {
    throw new Error(`The Content-Security-Policy has no ${directive} to add the emulators to`)
  }
  return policy.replace(`${directive} `, `${directive} ${origins} `)
}

/** The e2e copy of the hosting config: same rules, the e2e build, the emulators reachable. */
export const e2eHostingConfig = (config: FirebaseConfig): FirebaseConfig => {
  const auth = emulatorOrigin(config, 'auth')
  const firestore = emulatorOrigin(config, 'firestore')
  const withEmulators = (header: Header) =>
    header.key === 'Content-Security-Policy'
      ? { ...header, value: allow(allow(header.value, 'connect-src', `${auth} ${firestore}`), 'frame-src', auth) }
      : header
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
  await Bun.write('firebase.e2e.json', `${JSON.stringify(e2eHostingConfig(configFrom(await Bun.file('firebase.json').text())), null, 2)}\n`)
}

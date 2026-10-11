import { expect, test } from 'bun:test'
import { e2eHostingConfig } from './e2e-hosting-config'

const production = {
  emulators: { auth: { port: 9099 }, firestore: { port: 8080 }, hosting: { port: 4173 } },
  hosting: {
    headers: [
      { headers: [{ key: 'Cache-Control', value: 'no-cache' }, { key: 'Content-Security-Policy', value: "default-src 'self'; connect-src 'self' https://firestore.googleapis.com; img-src 'self'" }], source: '**' },
      { headers: [{ key: 'Cache-Control', value: 'immutable' }], source: '/assets/**' },
    ],
    public: 'apps/web/dist',
  },
}

test('serves the e2e build with production rules, and lets it reach the emulators', () => {
  const e2e = e2eHostingConfig(production)
  expect(e2e.hosting.public).toBe('apps/web/dist-e2e')
  expect(e2e.hosting.headers[0]?.headers).toEqual([
    { key: 'Cache-Control', value: 'no-cache' },
    { key: 'Content-Security-Policy', value: "default-src 'self'; connect-src http://127.0.0.1:9099 http://127.0.0.1:8080 'self' https://firestore.googleapis.com; img-src 'self'" },
  ])
  expect(e2e.hosting.headers[1]).toEqual(production.hosting.headers[1])
  expect(e2e.emulators).toEqual(production.emulators)
})

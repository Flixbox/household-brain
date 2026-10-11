export {}

// The values the build inlines into the app (`BUN_PUBLIC_*`, from apps/web/.env.<mode>).
declare module 'bun' {
  interface Env {
    readonly BUN_PUBLIC_FIREBASE_API_KEY: string
    readonly BUN_PUBLIC_FIREBASE_AUTH_DOMAIN: string
    readonly BUN_PUBLIC_FIREBASE_PROJECT_ID: string
    readonly BUN_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: string
    readonly BUN_PUBLIC_FIREBASE_APP_ID: string
    readonly BUN_PUBLIC_GOOGLE_CLIENT_ID: string
    readonly BUN_PUBLIC_USE_EMULATORS?: string
  }
}

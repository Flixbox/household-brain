/** An install-dialog screenshot, in the build's public folder. */
export interface PwaScreenshot {
  form_factor: 'narrow' | 'wide'
  label: string
  sizes: string
  src: string
  type: string
}

/** What an app tells the PWA build about itself (`pwa.config.ts` in the app's folder). */
export interface PwaConfig {
  backgroundColor: string
  description: string
  /** The app's icon, relative to the app's folder; every icon size is generated from it. */
  icon: string
  lang: string
  /** The icon with its art filling the whole square, for Android's masked icon shapes. */
  maskableIcon: string
  name: string
  /** Page addresses (regular expressions) the service worker leaves to the network, e.g. a sign-in handler. */
  networkOnly: string[]
  screenshots: PwaScreenshot[]
  shortName: string
  themeColor: string
}

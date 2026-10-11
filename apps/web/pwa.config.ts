import type { PwaConfig } from '@household-brain/pwa/lib/config'

/** The installable app: read by `pwa-build` after every build. */
const config: PwaConfig = {
  backgroundColor: '#fbf7f1',
  icon: 'icons/icon.svg',
  lang: 'en',
  maskableIcon: 'icons/icon-maskable.svg',
  name: 'Household Brain',
  // Firebase Auth's sign-in handler must always come from the network.
  networkOnly: ['^/__/'],
  // For the richer install dialog (#29), taken from the e2e build with made-up demo entries, never
  // the household's own.
  screenshots: [
    { form_factor: 'wide', label: 'Entries by category', sizes: '1280x800', src: '/screenshots/wide.png', type: 'image/png' },
    { form_factor: 'narrow', label: 'Entries by category', sizes: '412x915', src: '/screenshots/narrow.png', type: 'image/png' },
  ],
  shortName: 'Household',
  themeColor: '#f57c00',
}

export default config

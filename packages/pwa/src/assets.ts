import { join } from 'node:path'
import { favicons } from 'favicons'
import type { PwaConfig } from '@household-brain/pwa/lib/config'

/**
 * Generates the icons and the web app manifest from the app's icon (`favicons`) into the build, and
 * links them from its index.html.
 */
export const writeAssets = async (dir: string, config: PwaConfig) => {
  const { files, html, images } = await favicons(config.icon, {
    appDescription: config.description,
    appName: config.name,
    appShortName: config.shortName,
    // Not `favicons`' see-through bar, which would put the page under the iPhone's status bar.
    appleStatusBarStyle: 'default',
    background: config.backgroundColor,
    display: 'standalone',
    icons: { android: true, appleIcon: ['apple-touch-icon-180x180.png'], appleStartup: false, favicons: true, windows: false, yandex: false },
    lang: config.lang,
    manifestMaskable: config.maskableIcon,
    path: '/',
    scope: '/',
    start_url: '/',
    theme_color: config.themeColor,
  })
  await Promise.all(images.map(image => Bun.write(join(dir, image.name), image.contents)))
  await Promise.all(files.map(file => Bun.write(join(dir, file.name), file.name.endsWith('.webmanifest') ? withAppIdentity(file.contents, config) : file.contents)))
  const page = join(dir, 'index.html')
  const linked = new HTMLRewriter().on('head', { element: head => { head.append(html.join('\n'), { html: true }) } })
  await Bun.write(page, await linked.transform(new Response(Bun.file(page))).text())
}

/** The manifest fields `favicons` doesn't write: the app's identity and the install-dialog screenshots. */
const withAppIdentity = (manifest: string, config: PwaConfig) =>
  JSON.stringify({ ...JSON.parse(manifest), id: '/', screenshots: config.screenshots }, null, 2)

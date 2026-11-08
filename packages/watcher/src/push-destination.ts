/**
 * Where a `git push` goes, for the check on its credential helper (owner-push.ts, #467): only a push to
 * GitHub over HTTPS asks that helper. Git itself resolves the remote's URLs, so `pushurl` and URL
 * rewrites count. A destination this can't tell (the shell fills it in, no such remote, a transport it
 * doesn't know) counts as GitHub: a wrong refusal is cheap, and a push as the owner isn't.
 */
import { isDynamic } from './shell-commands'

/** `git push` options that take the next word as their value. */
const valueOptions = ['--exec', '--push-option', '--receive-pack', '--repo']

/** Whether this option takes the next word: a long one, perhaps abbreviated, or `-o` at the end of a cluster of short ones. */
const takesValue = (word: string) => (word.startsWith('--') ? valueOptions.some(option => option.startsWith(word)) : /^-[^-o]*o$/u.test(word))

/** The index of the `<repository>` word; the end of the arguments when there is none. */
const repositoryAt = (args: readonly string[]) => {
  let at = 0
  while (args[at]?.startsWith('-') === true && args[at] !== '--') {
    at += takesValue(args[at] ?? '') ? 2 : 1
  }
  return args[at] === '--' ? at + 1 : at
}

/** The value of a `--repo` among these options, or '' without one. */
const repoOption = (options: readonly string[]) => {
  const at = options.findLastIndex(word => /^--repo?(?:=|$)/u.test(word))
  const word = options[at] ?? ''
  if (at === -1) {
    return ''
  }
  return word.includes('=') ? word.slice(word.indexOf('=') + 1) : (options[at + 1] ?? '')
}

/** The output lines of a git command in this directory; none when it fails. */
const gitLines = (dir: string, ...args: readonly string[]) => {
  const { exitCode, stdout } = Bun.spawnSync(['git', '-C', dir, ...args])
  return exitCode === 0 ? stdout.toString().split('\n').filter(line => line !== '') : []
}

/** The remote a push without a `<repository>` goes to, in git's order. */
const defaultRemote = (dir: string) => {
  const branch = gitLines(dir, 'symbolic-ref', '-q', '--short', 'HEAD')[0] ?? ''
  const keys = [`branch.${branch}.pushRemote`, 'remote.pushDefault', `branch.${branch}.remote`]
  return keys.flatMap(key => gitLines(dir, 'config', '--get', key))[0] ?? 'origin'
}

/** Whether git would read this word as a URL or a path, not as the name of a remote; a redirection the shell reader doesn't know (`{fd}>file`) is neither. */
const isLocation = (word: string) => !/[<>]/u.test(word) && (/[/:]/u.test(word) || word === '.' || word === '..')

/** Whether a `pushInsteadOf` rule applies to this location. */
const hasPushRewrite = (dir: string, word: string) =>
  gitLines(dir, 'config', '--get-regexp', String.raw`^url\..*\.pushinsteadof$`).some(line => word.startsWith(line.slice(line.indexOf(' ') + 1)))

/** The URLs of a location named on the command line; none when a push-only rewrite applies, as `ls-remote` doesn't apply those. */
const locationUrls = (dir: string, word: string) => (isLocation(word) && !hasPushRewrite(dir, word) ? gitLines(dir, 'ls-remote', '--get-url', word) : [])

/** Every URL this push would go to; none when that is unclear. */
const pushUrls = (dir: string, args: readonly string[]) => {
  const at = repositoryAt(args)
  if (args.slice(0, at + 1).some(word => isDynamic(word))) {
    return []
  }
  const word = args[at] ?? repoOption(args.slice(0, at))
  const remote = word === '' ? defaultRemote(dir) : word
  const urls = gitLines(dir, 'remote', 'get-url', '--push', '--all', remote)
  return urls.length > 0 ? urls : locationUrls(dir, remote)
}

/** GitHub's host or one of its subdomains, with DNS's optional trailing dot. */
const isGithubHost = (hostname: string) => {
  const host = hostname.replace(/\.$/u, '')
  return host === 'github.com' || host.endsWith('.github.com')
}

const remoteSchemes = new Set(['file', 'git', 'git+ssh', 'ssh', 'ssh+git'])

/** Whether this URL clearly doesn't go to GitHub over HTTP(S): another scheme or host, an scp-like address, or a path. */
const goesElsewhere = (url: string) => {
  if (url.includes('://')) {
    const scheme = url.slice(0, url.indexOf('://')).toLowerCase()
    return remoteSchemes.has(scheme) || (['http', 'https'].includes(scheme) && URL.canParse(url) && !isGithubHost(new URL(url).hostname))
  }
  return !url.includes('::')
}

/** Whether this push may ask GitHub's HTTPS helpers: it goes to GitHub over HTTPS, or nothing shows it doesn't. */
export const mayUseGithubHelpers = (dir: string, args: readonly string[]) => {
  const urls = pushUrls(dir, args)
  return urls.length === 0 || !urls.every(url => goesElsewhere(url))
}

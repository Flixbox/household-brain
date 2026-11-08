/** A redirection: its operator, and its target when attached (`>out`, `2>/dev/null`, `&>log`). */
export const redirection = /^\d*(?:&>>?|>>?|<{1,3}|>&|<&|>\|)(?<target>.*)$/su

/** A command's arguments without its redirections (`>out`, `2>&1`, `< in`), which the command never sees. */
export const withoutRedirections = (words: readonly string[]) =>
  words.filter((word, at) => !redirection.test(word) && redirection.exec(words[at - 1] ?? '')?.groups?.target !== '')

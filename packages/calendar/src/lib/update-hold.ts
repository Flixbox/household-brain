/**
 * While the page carries this attribute, the shell doesn't switch to a new version of the app when
 * the app leaves the screen (`ReloadPrompt`). An attribute, so the shell needs no import from here.
 */
const HOLD_ATTRIBUTE = 'data-hold-updates'

/** The value for an element's `data-hold-updates` while `held` (null leaves the attribute out). */
export const holdUpdatesValue = (held: boolean) => (held ? '' : null)

let holds = 0

/**
 * Holds updates until `work` settles, e.g. while a Google window is open on top of the app: on a
 * phone that window hides the app, and a reload would lose its answer.
 */
export async function holdUpdatesWhile<Result>(work: Promise<Result>): Promise<Result> {
  const root = globalThis.document?.documentElement
  holds += 1
  root?.setAttribute(HOLD_ATTRIBUTE, '')
  try {
    return await work
  } finally {
    holds -= 1
    if (holds === 0) {
      root?.removeAttribute(HOLD_ATTRIBUTE)
    }
  }
}

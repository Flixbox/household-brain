/**
 * The handler for a failure that is dropped on purpose: `promise.catch(ignoreFailure)`. Each use says
 * next to it why nothing is lost; a failure someone should see goes to `reportError` instead.
 */
export const ignoreFailure = (): void => {
  // Nothing to do, on purpose.
}

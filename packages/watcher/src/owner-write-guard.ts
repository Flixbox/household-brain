/**
 * The guard against GitHub writes under the owner's own `gh` login (#368). Not written yet: this
 * first version finds nothing, so its tests show that such a write gets through today.
 */
export const ownerWrite = (command: string): string | null => (command.includes('\0') ? command : null)

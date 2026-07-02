/**
 * Jarvis command normalization.
 *
 * The CEO may type commands with or without spaces ("유튜브 켜줘" vs "유튜브켜줘",
 * "FC OS" vs "FCOS"). This helper produces the several normalized forms the
 * intent classifier matches against, so alias matching is space-insensitive
 * without having to enumerate every no-space variant.
 */
export interface NormalizedCommand {
  /** The raw string as typed. */
  original: string
  /** Trimmed of leading/trailing whitespace. */
  trimmed: string
  /** Whitespace collapsed to single spaces (original case preserved). */
  spaced: string
  /** Whitespace-normalized + lowercased. */
  lowered: string
  /** Lowercased with ALL whitespace removed. */
  noSpace: string
}

export function normalizeCommand(raw: string): NormalizedCommand {
  const trimmed = raw.trim()
  const spaced = trimmed.replace(/\s+/g, ' ')
  const lowered = spaced.toLowerCase()
  const noSpace = lowered.replace(/\s+/g, '')
  return { original: raw, trimmed, spaced, lowered, noSpace }
}

/**
 * True when any alias matches the command, comparing space-insensitively:
 * an alias matches if it appears in the whitespace-normalized lowercase form,
 * OR its no-space form appears in the command's no-space form.
 */
export function matchesAny(command: NormalizedCommand, aliases: string[]): boolean {
  return aliases.some((alias) => {
    const lowered = alias.toLowerCase()
    if (command.lowered.includes(lowered)) return true
    const aliasNoSpace = lowered.replace(/\s+/g, '')
    return aliasNoSpace.length > 0 && command.noSpace.includes(aliasNoSpace)
  })
}

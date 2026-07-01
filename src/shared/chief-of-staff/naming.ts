/**
 * Derive a short project name from a CEO request. Pure string heuristics — no
 * AI, no side effects. The Kernel owns the actual project record; this only
 * proposes a human-friendly name for it.
 */
export function deriveProjectName(request: string): string {
  const cleaned = request
    .replace(
      /^(please\s+)?(start|build|create|make|develop|design|set\s?up|add|fix|improve|research|launch|i\s+want|i'?d\s+like|can\s+you)\b/gi,
      ''
    )
    .replace(/^(a|an|the|me|our)\b/gi, '')
    .trim()
  const words = cleaned.split(/\s+/).filter(Boolean).slice(0, 4)
  if (words.length === 0) return 'New Project'
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

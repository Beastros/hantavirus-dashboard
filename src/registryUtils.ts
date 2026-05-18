/** Rows shown in case counts / table — drops vague AI headline aggregates. */
export function registryRows(cases: unknown[]): Record<string, unknown>[] {
  if (!Array.isArray(cases)) return []
  return cases.filter((raw): raw is Record<string, unknown> => {
    if (!raw || typeof raw !== 'object') return false
    const c = raw as Record<string, unknown>
    if (c.source !== 'ai-extracted') return true
    const note = String(c.notes ?? '').toLowerCase()
    if (/\d+\s+deaths?\s+reported/.test(note)) return false
    if (!c.nationality && c.age == null && !c.sex && c.location === 'cruise ship') return false
    return true
  })
}

export function countByOutcome(
  cases: unknown[],
  outcomes: string[],
): number {
  return registryRows(cases).filter((c) => outcomes.includes(String(c.outcome ?? ''))).length
}

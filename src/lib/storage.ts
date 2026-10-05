/** Small per-user conveniences (theme, layout). Storage can be missing or refuse: the interface must work without it. */
export function readStored<T>(key: string, fallback: T, valid: (value: unknown) => value is T): T {
  try {
    const raw = localStorage.getItem(`fb:${key}`)
    if (raw === null) return fallback
    const value: unknown = JSON.parse(raw)
    return valid(value) ? value : fallback
  } catch {
    return fallback
  }
}

export function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(`fb:${key}`, JSON.stringify(value))
  } catch {
    // no storage: the setting lasts until the window closes
  }
}

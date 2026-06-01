/**
 * Safe localStorage wrappers with error handling.
 *
 * All localStorage access in the dashboard goes through these functions.
 * Errors (quota exceeded, private browsing, etc.) are caught and handled
 * gracefully — the app continues operating without persistence.
 *
 * Requirements: 5.5
 */

/**
 * Read a value from localStorage, returning `fallback` if the key is missing
 * or if any error occurs (parsing, access denied, etc.).
 */
export function safeGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Write a value to localStorage.
 * Returns `true` on success, `false` on quota error or any other failure.
 */
export function safeSet(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove a key from localStorage. Silently ignores errors.
 */
export function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore — nothing to do if removal fails
  }
}

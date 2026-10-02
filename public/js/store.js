/** Small persisted UI state (choices, collapsed sections) that should survive reloads. */
const PREFIX = 'pantry:';

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // storage full or disabled: the app still works, it just forgets
  }
}

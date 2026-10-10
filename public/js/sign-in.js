/**
 * "Sign in with ChatGPT" for open-source apps must return to http://127.0.0.1:<port>/auth/callback.
 * On the server's own machine that lands straight back here. On any other device (a phone on
 * the same Wi-Fi) that address can't load, so the user copies it and pastes it into this app.
 */
export function isOnServerMachine() {
  return (location.hostname === '127.0.0.1' || location.hostname === 'localhost' || location.hostname === '[::1]');
}

export function signInWithGoogle() {
  location.href = '/auth/google/start';
}

export function startUrl({ consent = false } = {}) {
  return `/auth/chatgpt/start${consent ? '?consent=1' : ''}`;
}

/**
 * Same-machine flow: go through 127.0.0.1 (not "localhost") so the sign-in cookie and the
 * callback share a host.
 */
export function startOnServerMachine(options) {
  const base = location.hostname === '127.0.0.1' ? '' : `http://127.0.0.1:${location.port || 80}`;
  location.href = base + startUrl(options);
}

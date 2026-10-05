/** A hash-only redirect does not rerun the shared app's initial session check. */
export function reloadSignedInApp(location) {
  location.hash = 'stock';
  location.reload();
}

export const PENDING_SIGN_IN = 'pantry.pending-sign-in';
const COMPLETED_SIGN_IN = 'pantry.completed-sign-in';

export function createHandoffReceiver({ preferences, request, finish, now = Date.now }) {
  let exchanging = false;
  return async (url) => {
    const callback = new URL(url);
    if (callback.protocol !== 'pantryscoop:' || callback.hostname !== 'sign-in' || exchanging) return;
    exchanging = true;
    try {
      const flow = callback.searchParams.get('flow');
      // Android retains a cold-start intent across WebView reloads. Do not reconsume that URL.
      const completed = await preferences.get({ key: COMPLETED_SIGN_IN });
      if (flow && completed.value === flow) return;
      const { value } = await preferences.get({ key: PENDING_SIGN_IN });
      if (!value) throw new Error('Start sign-in in this Android app first.');
      const pending = JSON.parse(value);
      if (flow !== pending.flow || pending.expiresAt <= now()) {
        throw new Error('This sign-in expired or belongs to another app. Start again here.');
      }
      const response = await request('/api/auth/mobile/exchange', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ flow: pending.flow, verifier: pending.verifier, code: callback.searchParams.get('code') }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not finish sign-in.');
      await preferences.set({ key: COMPLETED_SIGN_IN, value: pending.flow });
      await preferences.remove({ key: PENDING_SIGN_IN });
      await finish();
    } finally { exchanging = false; }
  };
}

export async function signInWithNativeGoogle({ request, google, finish }) {
  const base64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const post = async (path, data) => {
    const response = await request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not finish Google sign-in.');
    return result;
  };
  const started = await post('/api/auth/mobile/start', { provider: 'google', challenge });
  const { idToken } = await google.signIn({ serverClientId: started.serverClientId, nonce: started.nonce });
  await post('/api/auth/mobile/google', { flow: started.flow, verifier, idToken });
  await finish();
}

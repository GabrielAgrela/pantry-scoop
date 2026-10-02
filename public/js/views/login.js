import { api } from '../api.js';
import { h } from '../dom.js';
import { isOnServerMachine, startOnServerMachine, startUrl } from '../sign-in.js';

/**
 * Sign-in screen. With `consent`, it re-runs sign-in asking ChatGPT to show the permission
 * screen again, for users who signed in without allowing plan usage.
 */
export function createLoginView(root, { onSignedIn, consent = false, mode = 'local' }) {
  const pasteInput = h('input', { type: 'text', inputmode: 'url', autocomplete: 'off', autocapitalize: 'off', spellcheck: false, placeholder: 'http://127.0.0.1:…/auth/callback?code=…', 'aria-label': 'Address from the ChatGPT tab' });
  const finish = h('button', { type: 'submit', class: 'primary' }, 'Finish signing in');
  const problem = h('p', { class: 'problem', role: 'alert', hidden: true });
  // On a phone/other device the paste box is always shown: the user may come back to a fresh
  // copy of this page after approving in ChatGPT.
  const pastePanel = h('form', { class: 'stack', onsubmit: async (event) => {
    event.preventDefault();
    problem.hidden = true;
    finish.disabled = true;
    finish.textContent = 'Checking…';
    try {
      await api.completeSignIn(pasteInput.value);
      onSignedIn();
    } catch (error) {
      problem.textContent = error.message;
      problem.hidden = false;
    } finally {
      finish.disabled = false;
      finish.textContent = 'Finish signing in';
    }
  } },
    h('ol', { class: 'steps' },
      h('li', {}, h('a', { href: startUrl({ consent }), target: '_blank', rel: 'opener' }, 'Open ChatGPT sign-in'), ' and approve Pantry Scoop.'),
      h('li', {}, 'Copy the address of the page that fails to load (127.0.0.1…).'),
      h('li', {}, 'Paste it here.'),
    ),
    pasteInput,
    problem,
    h('button', { type: 'button', onclick: async () => {
      try {
        pasteInput.value = await navigator.clipboard.readText();
      } catch {
        pasteInput.focus();
      }
    }, hidden: !navigator.clipboard?.readText }, '📋 Paste from clipboard'),
    finish,
  );

  const intro = consent
    ? 'Allow Pantry Scoop to use your ChatGPT plan.'
    : 'Scan your pantry. Get recipes that fit it.';

  // A registered website client (or the server's own machine) gets the normal one-tap sign-in.
  if (mode === 'registered' || isOnServerMachine()) {
    const start = () => (mode === 'registered' ? (location.href = startUrl({ consent })) : startOnServerMachine({ consent }));
    root.append(
      h('div', { class: 'card stack login' },
        h('h2', {}, consent ? 'Use your ChatGPT plan' : 'Welcome to Pantry Scoop'),
        h('p', {}, intro),
        h('button', { class: 'primary chatgpt', onclick: start }, 'Continue with ChatGPT'),
        h('p', { class: 'muted' }, 'Uses your ChatGPT Plus or Pro plan.'),
        consent ? h('a', { href: '/' }, 'Not now') : '',
      ),
    );
    return;
  }

  // Other devices: ChatGPT can only send the sign-in back to the computer running Pantry Scoop,
  // so phones join an account from there with a QR code.
  root.append(
    h('div', { class: 'card stack login' },
      h('h2', {}, 'Welcome to Pantry Scoop'),
      h('p', {}, intro),
      h('div', { class: 'card stack how' },
        h('strong', {}, 'To sign in on this phone'),
        h('ol', { class: 'steps' },
          h('li', {}, 'Sign in on the computer running Pantry Scoop.'),
          h('li', {}, 'There, tap your picture → 📱 Sign in on your phone and scan the code.'),
        ),
      ),
      h('details', { class: 'fallback' }, h('summary', {}, 'Other way'), pastePanel),
    ),
  );
}

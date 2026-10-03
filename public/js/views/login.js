import { api } from '../api.js';
import { h } from '../dom.js';
import { isOnServerMachine, startOnServerMachine, startUrl } from '../sign-in.js';
import { icon } from '../ui.js';

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
    }, hidden: !navigator.clipboard?.readText }, icon('pantry'), 'Paste from clipboard'),
    finish,
  );

  const login = h('div', { class: 'login stack' });
  root.append(
    h('div', { class: 'login-hero' },
      h('div', { class: 'login-copy' },
        h('h1', {}, consent ? 'Connect your ChatGPT plan' : 'Your kitchen, organized.'),
        h('p', { class: 'login-description' }, consent ? 'Allow plan usage for photo scans and recipe ideas.' : 'Track your ingredients and find recipes that use what you have.'), login),
      h('div', { class: 'login-photo' }, h('img', { src: '/assets/pantry-editorial.webp', alt: 'Fresh ingredients on a sunny kitchen counter', fetchpriority: 'high' }))),
  );

  // A registered website client (or the server's own machine) gets the normal one-tap sign-in.
  if (mode === 'registered' || isOnServerMachine()) {
    const start = () => (mode === 'registered' ? (location.href = startUrl({ consent })) : startOnServerMachine({ consent }));
    login.append(
        h('button', { class: 'primary chatgpt', onclick: start }, 'Continue with ChatGPT', icon('arrow')),
        h('p', { class: 'muted' }, 'Photo scans and recipe ideas use your ChatGPT Plus or Pro plan.'),
        consent ? h('a', { href: '/' }, 'Not now') : '',
    );
    return;
  }

  // Other devices: ChatGPT can only send the sign-in back to the computer running Pantry Scoop,
  // so phones join an account from there with a QR code.
  login.append(
      h('div', { class: 'card stack how' },
        h('strong', {}, consent ? 'Connect your ChatGPT plan' : 'Bring your pantry to this device'),
        h('ol', { class: 'steps' },
          h('li', {}, 'Open Pantry Scoop on its host computer and sign in with ChatGPT.'),
          h('li', {}, 'Choose “Sign in on your phone” in your account menu, then scan the QR code.'),
        ),
      ),
      h('details', { class: 'fallback' }, h('summary', {}, 'Connect using a sign-in address'), pastePanel),
  );
}

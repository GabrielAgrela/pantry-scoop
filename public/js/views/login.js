import { api } from '../api.js';
import { h, showError, withBusy } from '../dom.js';
import { platform } from '../platform.js';
import { isOnServerMachine, startOnServerMachine, startUrl } from '../sign-in.js';
import { emoji, icon, pantryFriend } from '../ui.js';

/**
 * Sign-in screen. With `consent`, it re-runs sign-in asking ChatGPT to show the permission
 * screen again, for users who signed in without allowing plan usage.
 */
export function createLoginView(root, { onSignedIn, consent = false, mode = 'local', google = false, providerOnly }) {
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
        h('div', { class: 'login-eyebrow' }, emoji('🌷'), 'A little everyday delicious'),
        h('h1', {}, consent ? 'Connect your ChatGPT plan' : ['Your kitchen,', h('em', {}, 'a little happier.')]),
        h('p', { class: 'login-description' }, consent ? 'Allow plan usage for photo scans and recipe ideas.' : 'Keep your pantry together. Find something lovely to cook with what you already have.'), login,
        h('div', { class: 'login-notes' }, h('span', {}, emoji('🧺'), 'Less food waste'), h('span', {}, emoji('🍓'), 'More good food'))),
      h('div', { class: 'login-illustration', 'aria-hidden': 'true' }, h('div', { class: 'illustration-halo' }), pantryFriend('login-friend'),
        h('span', { class: 'food-sticker sticker-berry', 'aria-hidden': 'true' }, '🍓'),
        h('span', { class: 'food-sticker sticker-lemon', 'aria-hidden': 'true' }, '🍋'),
        h('span', { class: 'food-sticker sticker-bread' }, '🥐'),
        h('span', { class: 'illustration-spark spark-one' }, '✦'), h('span', { class: 'illustration-spark spark-two' }, '✧'),
        h('span', { class: 'illustration-note' }, 'a happy little pantry'))),
  );

  if (platform.native) {
    const button = (provider, label, consent) => {
      const el = h('button', { class: 'primary', onclick: () => withBusy(el, 'Opening sign-in…', () => platform.signIn({ provider, consent })) }, label);
      return el;
    };
    if (google && !consent) login.append(button('google', 'Continue with Google'));
    login.append(button('chatgpt', 'Continue with ChatGPT', consent),
      h('p', { class: 'muted' }, google && !consent
        ? 'Google signs in here. ChatGPT opens a secure browser to connect your plan.'
        : 'Connect your ChatGPT plan in a secure browser, then return to Pantry Scoop.'),
      h('button', { onclick: () => platform.signIn({ provider: 'pair' }).catch(showError) }, 'Use a phone sign-in link'));
    return;
  }


  // Google returns to this site's public address, so it is one tap on every device.
  if (google && !consent) {
    login.append(
      h('a', { class: 'button primary google', href: '/auth/google/start' }, googleMark(), 'Continue with Google'),
      h('p', { class: 'muted' }, 'No ChatGPT plan needed: scans and recipes can run on DeepSeek.'),
      h('div', { class: 'login-or', 'aria-hidden': 'true' }, 'or'),
    );
  }
  if (providerOnly === 'google') return;

  // A registered website client (or the server's own machine) gets the normal one-tap sign-in.
  if (mode === 'registered' || isOnServerMachine()) {
    const start = () => (mode === 'registered' ? (location.href = startUrl({ consent })) : startOnServerMachine({ consent }));
    login.append(
        h('button', { class: `${google && !consent ? '' : 'primary '}chatgpt`, onclick: start }, 'Continue with ChatGPT', icon('arrow')),
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

/** Google's "G" mark, as Google's sign-in branding asks for. */
function googleMark() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('class', 'google-mark');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML =
    '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>' +
    '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>' +
    '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>' +
    '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>';
  return svg;
}

import { api } from './api.js';
import { h, MANAGE_USAGE_URL, openDialog, showError, toast } from './dom.js';

const manageUsageLink = (label = 'Manage usage') =>
  h('a', { href: MANAGE_USAGE_URL, target: '_blank', rel: 'noopener' }, label);

/** Header account menu: who is signed in, ChatGPT plan status, model choice, sign out. */
export function renderAccount(root, account, { mode, onSignedOut, onEnablePlan }) {
  const { user, planUsageEnabled } = account;
  const model = h('select', { 'aria-label': 'AI model', onchange: async () => {
    try {
      await api.setModel(model.value);
      toast('Model updated');
    } catch (error) {
      showError(error);
    }
  } }, h('option', { value: '' }, 'Automatic'));
  if (planUsageEnabled) loadModels(model, user.model);

  const signOut = h('button', { onclick: async () => {
    const result = await api.signOut().catch(() => ({ revoked: false }));
    if (!result.revoked) toast('Signed out. If you want to fully disconnect, remove Pantry Scoop in ChatGPT settings.');
    onSignedOut();
  } }, 'Sign out');

  const menu = h('details', { class: 'account-menu' },
      h('summary', { 'aria-label': 'Account' },
        user.picture ? h('img', { src: user.picture, alt: '', class: 'avatar', referrerpolicy: 'no-referrer' }) : h('span', { class: 'avatar' }, initials(user)),
      ),
      h('div', { class: 'card stack menu' },
        h('strong', {}, user.name || user.email),
        user.name ? h('span', { class: 'muted' }, user.email) : '',
        planUsageEnabled
          ? h('div', { class: 'plan' }, h('span', { class: 'chip ok' }, 'Using ChatGPT plan'), manageUsageLink())
          : enablePlanPrompt(onEnablePlan),
        planUsageEnabled ? h('label', {}, 'AI model', model) : '',
        // Only needed when ChatGPT can't send phones back here (open-source loopback flow).
        mode === 'local' ? h('button', { onclick: showPhoneQr }, '📱 Sign in on your phone') : '',
        signOut,
        h('button', { class: 'danger link', onclick: async () => {
          if (!confirm('Delete your account and everything in it? This can’t be undone.')) return;
          try {
            await api.deleteAccount();
            onSignedOut();
          } catch (error) {
            showError(error);
          }
        } }, 'Delete account'),
      ),
    );
  // Close after choosing something, and when tapping anywhere else.
  menu.addEventListener('click', (event) => {
    if (event.target.closest('.menu button')) menu.open = false;
  });
  document.addEventListener('click', (event) => {
    if (menu.open && !menu.contains(event.target)) menu.open = false;
  });
  root.replaceChildren(menu);
}

/** Shown when the user signed in but didn't allow plan usage. */
function enablePlanPrompt(onEnable) {
  return h('div', { class: 'stack' },
    h('span', {}, 'Allow ChatGPT plan use to scan and get recipes.'),
    h('button', { class: 'primary chatgpt', onclick: onEnable }, 'Continue with ChatGPT'),
  );
}

/** One-time confirmation after the first sign-in with plan usage (per OpenAI's UX guidelines). */
export function showPlanWelcome() {
  const { close } = openDialog('welcome',
    h('h3', {}, 'You’re using your ChatGPT plan'),
    h('p', {}, manageUsageLink('Manage usage'), ' in ChatGPT settings.'),
    h('button', { class: 'primary', onclick: () => {
      close();
      api.dismissPlanWelcome().catch(() => {});
    } }, 'Got it'),
  );
}

/** QR code the phone scans with its camera to sign in as this account. */
async function showPhoneQr() {
  let link;
  try {
    link = await api.createDeviceLink();
  } catch (error) {
    showError(error);
    return;
  }
  const { close } = openDialog('qr',
    h('h3', {}, 'Scan with your phone'),
    h('img', { src: link.qrDataUrl, alt: 'Sign-in QR code', width: 240, height: 240 }),
    h('p', { class: 'muted' }, 'Same Wi-Fi · works once · 10 min'),
    h('button', { class: 'primary', onclick: () => close() }, 'Done'),
  );
}

async function loadModels(select, current) {
  try {
    const { models } = await api.listModels();
    select.append(...models.map((m) => h('option', { value: m.slug, selected: m.slug === current }, m.displayName)));
  } catch {
    // The menu still works without the list; "Automatic" remains available.
  }
}

function initials(user) {
  return (user.name || user.email || '?').trim().slice(0, 1).toUpperCase();
}

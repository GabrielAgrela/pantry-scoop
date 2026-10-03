import { renderAccount, showPlanWelcome } from './account.js';
import { api, SIGNED_OUT_EVENT } from './api.js';
import { createLoginView } from './views/login.js';
import { createProfileView } from './views/profile.js';
import { createRecipesView } from './views/recipes.js';
import { createStockView } from './views/stock.js';
import { h } from './dom.js';

const loginRoot = document.getElementById('view-login');
const accountRoot = document.getElementById('account');
const tabbar = document.querySelector('.tabbar');
const loading = document.getElementById('app-loading');
let views;
let mode = 'local';
let signedIn = false;

function activate(name) {
  for (const section of document.querySelectorAll('[data-view]')) section.hidden = section.dataset.view !== name;
  for (const tab of document.querySelectorAll('[data-tab]')) {
    if (tab.dataset.tab === name) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  history.replaceState(null, '', `#${name}`);
  document.title = `${{ stock: 'My pantry', recipes: 'Recipes', profile: 'My kitchen' }[name]} · Pantry Scoop`;
  document.body.dataset.page = name;
  window.scrollTo(0, 0);
  views[name].show();
}

function showLogin({ consent = false } = {}) {
  views?.recipes.stop();
  loading.hidden = true;
  signedIn = false;
  document.body.dataset.page = 'login';
  document.title = 'Pantry Scoop — Your everyday kitchen companion';
  for (const section of document.querySelectorAll('[data-view]')) section.hidden = true;
  tabbar.hidden = true;
  accountRoot.replaceChildren();
  loginRoot.replaceChildren();
  createLoginView(loginRoot, { consent, mode, onSignedIn: () => location.reload() });
  loginRoot.hidden = false;
}

function showApp(account) {
  loading.hidden = true;
  signedIn = true;
  loginRoot.hidden = true;
  tabbar.hidden = false;
  renderAccount(accountRoot, account, {
    mode,
    onSignedOut: () => showLogin(),
    onEnablePlan: () => showLogin({ consent: true }),
  });
  views ??= {
    stock: createStockView(document.getElementById('view-stock')),
    recipes: createRecipesView(document.getElementById('view-recipes')),
    profile: createProfileView(document.getElementById('view-profile')),
  };
  const initial = location.hash.slice(1);
  activate(Object.hasOwn(views, initial) ? initial : 'stock');
  if (document.body.dataset.page !== 'recipes') views.recipes.resume();
  if (account.showPlanWelcome) showPlanWelcome();
}

for (const tab of document.querySelectorAll('[data-tab]')) {
  tab.addEventListener('click', () => { location.hash = tab.dataset.tab; });
}
window.addEventListener(SIGNED_OUT_EVENT, () => showLogin());
// A QR link opened in a tab that already shows the app only changes the hash: start over.
window.addEventListener('hashchange', () => {
  if (location.hash.startsWith('#link=')) location.reload();
  else if (signedIn) {
    const name = location.hash.slice(1);
    activate(Object.hasOwn(views, name) ? name : 'stock');
  }
});

/** Opened from the QR code shown on a signed-in computer: #link=<one-time token>. */
async function consumeDeviceLink() {
  const token = new URLSearchParams(location.hash.slice(1)).get('link');
  if (!token) return;
  history.replaceState(null, '', location.pathname);
  try {
    await api.signInWithDeviceLink(token);
  } catch (error) {
    alert(error.message);
  }
}

try {
  ({ mode } = await api.getAuthConfig());
  await consumeDeviceLink();
  showApp(await api.getAccount());
} catch (error) {
  if (error.code !== 'auth-required') {
    loading.hidden = true;
    loginRoot.replaceChildren(h('div', { class: 'empty-state' }, h('h1', {}, 'Your kitchen is taking a moment.'), h('p', { class: 'problem', role: 'alert' }, error.message), h('button', { class: 'primary', onclick: () => location.reload() }, 'Try again')));
    loginRoot.hidden = false;
  }
}

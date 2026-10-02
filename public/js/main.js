import { renderAccount, showPlanWelcome } from './account.js';
import { api, SIGNED_OUT_EVENT } from './api.js';
import { createLoginView } from './views/login.js';
import { createProfileView } from './views/profile.js';
import { createRecipesView } from './views/recipes.js';
import { createStockView } from './views/stock.js';

const loginRoot = document.getElementById('view-login');
const accountRoot = document.getElementById('account');
const tabbar = document.querySelector('.tabbar');
let views;
let mode = 'local';

function activate(name) {
  for (const section of document.querySelectorAll('[data-view]')) section.hidden = section.dataset.view !== name;
  for (const tab of document.querySelectorAll('[data-tab]')) {
    if (tab.dataset.tab === name) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  history.replaceState(null, '', `#${name}`);
  views[name].show();
}

function showLogin({ consent = false } = {}) {
  for (const section of document.querySelectorAll('[data-view]')) section.hidden = true;
  tabbar.hidden = true;
  accountRoot.replaceChildren();
  loginRoot.replaceChildren();
  createLoginView(loginRoot, { consent, mode, onSignedIn: () => location.reload() });
  loginRoot.hidden = false;
}

function showApp(account) {
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
  activate(initial in views ? initial : 'stock');
  if (account.showPlanWelcome) showPlanWelcome();
}

for (const tab of document.querySelectorAll('[data-tab]')) {
  tab.addEventListener('click', () => activate(tab.dataset.tab));
}
window.addEventListener(SIGNED_OUT_EVENT, () => showLogin());
// A QR link opened in a tab that already shows the app only changes the hash: start over.
window.addEventListener('hashchange', () => {
  if (location.hash.startsWith('#link=')) location.reload();
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
    loginRoot.replaceChildren(document.createTextNode(`Could not load: ${error.message}`));
    loginRoot.hidden = false;
  }
}

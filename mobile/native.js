import { CapacitorHttp, registerPlugin } from '@capacitor/core';
import { createNativeRequest } from './transport.js';
import { createHandoffReceiver, PENDING_SIGN_IN as PENDING, reloadSignedInApp, signInWithNativeGoogle } from './auth.js';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Camera, MediaTypeSelection } from '@capacitor/camera';
import { Preferences } from '@capacitor/preferences';
import { installPlatform } from '/js/platform.js';
import { api } from '/js/api.js';
import { h, openDialog, showError } from '/js/dom.js';

const SERVER = PANTRY_SERVER_URL;
const SCAN = 'pantry.pending-photo-selection';
const GoogleSignIn = registerPlugin('PantryGoogleSignIn');
const base64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const nativeRequest = createNativeRequest(SERVER, CapacitorHttp);
const receiveSignIn = createHandoffReceiver({ preferences: Preferences, request: nativeRequest, finish: () => reloadSignedInApp(location) });

async function signIn({ provider, consent = false }) {
  if (provider === 'pair') { pairDialog(); return; }
  if (provider === 'google') {
    try { await signInWithNativeGoogle({ request: nativeRequest, google: GoogleSignIn, finish: () => reloadSignedInApp(location) }); }
    catch (error) { if (error.code !== 'cancelled') throw error; }
    return;
  }
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const response = await nativeRequest('/api/auth/mobile/start', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ challenge, provider, consent }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not start sign-in.');
  await Preferences.set({ key: PENDING, value: JSON.stringify({ flow: data.flow, verifier, expiresAt: data.expiresAt }) });
  await Browser.open({ url: SERVER + data.browserPath });
}

function pairDialog() {
  const input = h('input', { type: 'url', placeholder: 'Paste your phone sign-in link', 'aria-label': 'Phone sign-in link' });
  const problem = h('p', { class: 'problem', role: 'alert', hidden: true });
  const submit = h('button', { type: 'submit', class: 'primary' }, 'Connect my pantry');
  const { close } = openDialog('phone-pair', h('h3', {}, 'Connect your pantry'),
    h('p', {}, 'On a signed-in device, choose “Sign in on your phone” and copy its link here.'),
    h('form', { class: 'stack', onsubmit: async (event) => {
      event.preventDefault();
      submit.disabled = true;
      problem.hidden = true;
      try {
        const link = new URL(input.value.trim());
        const token = new URLSearchParams(link.hash.slice(1)).get('link');
        if (link.origin !== SERVER || link.pathname !== '/' || !token) throw new Error('Use a phone sign-in link from this Pantry Scoop server.');
        await api.signInWithDeviceLink(token);
        location.reload();
      } catch (error) { problem.textContent = error.message; problem.hidden = false; submit.disabled = false; }
    } }, input, problem, submit), h('button', { onclick: close }, 'Cancel'));
}

async function mediaFiles(items) {
  return Promise.all(items.map(async (item) => {
    if (!item.webPath) throw new Error('The photo picker did not return a readable photo.');
    const response = await fetch(item.webPath);
    if (!response.ok) throw new Error('Could not read the selected photo.');
    return response.blob();
  }));
}

async function pickPhotos(source, limit, jobId) {
  if (limit < 1) throw new Error('This scan already has six photos.');
  await Preferences.set({ key: SCAN, value: JSON.stringify({ jobId }) });
  let items;
  try {
    items = source === 'camera'
      ? [await Camera.takePhoto({ quality: 85, targetWidth: 1600, targetHeight: 1600, saveToGallery: false })]
      : (await Camera.chooseFromGallery({ mediaType: MediaTypeSelection.Photo, allowMultipleSelection: limit > 1, limit, targetWidth: 1600, targetHeight: 1600 })).results;
  } catch (error) {
    await Preferences.remove({ key: SCAN });
    if (['OS-PLUG-CAMR-0006', 'OS-PLUG-CAMR-0020'].includes(error.code)) return [];
    throw error;
  }
  await Preferences.remove({ key: SCAN });
  return mediaFiles(items);
}

installPlatform({ native: true, request: nativeRequest, signIn, pickPhotos, signOut: () => GoogleSignIn.clearCredentialState() });

let ready = false;
let restored;
async function restorePhotos() {
  if (!ready || !restored) return;
  const result = restored;
  restored = undefined;
  const { value } = await Preferences.get({ key: SCAN });
  await Preferences.remove({ key: SCAN });
  if (!result.success) { showError(new Error(result.error?.message || 'Photo selection did not finish.')); return; }
  const files = await mediaFiles(result.methodName === 'takePhoto' ? [result.data] : result.data.results);
  window.dispatchEvent(new CustomEvent('pantry:restored-photos', { detail: { files, jobId: value ? JSON.parse(value).jobId : undefined } }));
}
await App.addListener('appRestoredResult', (result) => {
  if (result.pluginId !== 'Camera' || !['takePhoto', 'chooseFromGallery'].includes(result.methodName)) return;
  restored = result;
  restorePhotos().catch(showError);
});
await App.addListener('appUrlOpen', ({ url }) => { receiveSignIn(url).catch(showError); });
await App.addListener('backButton', async () => {
  const dialog = [...document.querySelectorAll('dialog[open]')].at(-1);
  if (dialog) { dialog.dispatchEvent(new Event('cancel', { cancelable: true })); return; }
  const menu = document.querySelector('.account-menu[open]');
  if (menu) { menu.querySelector('summary').click(); return; }
  if (document.body.dataset.page !== 'stock' && document.body.dataset.page !== 'login') { location.hash = 'stock'; return; }
  await App.minimizeApp();
});

// External links stay in the system browser; remote pages never receive the native bridge.
document.addEventListener('click', (event) => {
  const link = event.target.closest?.('a[href]');
  if (!link || !/^https?:/.test(link.href)) return;
  const url = new URL(link.href);
  if (url.origin === location.origin) return;
  event.preventDefault();
  Browser.open({ url: url.href }).catch(showError);
});

const launched = await App.getLaunchUrl();
if (launched?.url) await receiveSignIn(launched.url).catch(showError);
await import('/js/main.js');
ready = true;
await restorePhotos().catch(showError);

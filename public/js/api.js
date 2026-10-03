/** Error from the API, carrying the server's machine-readable `code` (e.g. "usage-limit"). */
export class ApiError extends Error {
  constructor(message, { status, code, manageUsageUrl } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.manageUsageUrl = manageUsageUrl;
  }
}

/** Fired when any call finds the session gone, so the app can show the sign-in screen. */
export const SIGNED_OUT_EVENT = 'pantry:signed-out';
export const PANTRY_CHANGED_EVENT = 'pantry:stock-changed';

/** Single place that knows the HTTP API's shape. */
async function request(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const notifyStockChange = () => {
    if (response.ok && method !== 'GET' && (url.startsWith('/api/ingredients') || /^\/api\/scan\/\d+\/confirm$/.test(url))) window.dispatchEvent(new CustomEvent(PANTRY_CHANGED_EVENT));
  };
  if (response.status === 204) { notifyStockChange(); return undefined; }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new ApiError(data.error ?? `Request failed (${response.status})`, { status: response.status, ...data });
    // A failed sign-in attempt is reported where it happened, not as "your session ended".
    if (error.code === 'auth-required' && !url.startsWith('/api/auth/')) {
      window.dispatchEvent(new CustomEvent(SIGNED_OUT_EVENT, { detail: error }));
    }
    throw error;
  }
  notifyStockChange();
  return data;
}

export const api = {
  getAuthConfig: () => request('GET', '/api/auth/config'),
  getAccount: () => request('GET', '/api/account'),
  listModels: () => request('GET', '/api/account/models'),
  setModel: (model) => request('PUT', '/api/account/model', { model }),
  dismissPlanWelcome: () => request('POST', '/api/account/plan-welcome/dismiss'),
  completeSignIn: (callbackUrl) => request('POST', '/api/auth/complete', { callbackUrl }),
  createDeviceLink: () => request('POST', '/api/account/device-links'),
  signInWithDeviceLink: (token) => request('POST', '/api/auth/device-link', { token }),
  signOut: () => request('POST', '/api/auth/sign-out'),
  deleteAccount: () => request('DELETE', '/api/account'),

  listIngredients: () => request('GET', '/api/ingredients'),
  addIngredient: (ingredient) => request('POST', '/api/ingredients', ingredient),
  updateIngredient: (id, changes) => request('PATCH', `/api/ingredients/${id}`, changes),
  deleteIngredient: (id) => request('DELETE', `/api/ingredients/${id}`),
  scan: (images) => request('POST', '/api/scan', { images }),
  confirmScan: (id, ingredients) => request('POST', `/api/scan/${id}/confirm`, { ingredients }),
  appendScan: (id, images) => request('POST', `/api/scan/${id}/photos`, { images }),
  listJobs: (kind, limit = 5) => request('GET', `/api/jobs?kind=${kind}&limit=${limit}`),
  getJob: (id) => request('GET', `/api/jobs/${id}`),

  suggestRecipes: (options) => request('POST', '/api/recipes/suggestions', options),
  listSavedRecipes: () => request('GET', '/api/recipes/saved'),
  saveRecipe: (recipe) => request('POST', '/api/recipes/saved', { recipe }),
  deleteSavedRecipe: (id) => request('DELETE', `/api/recipes/saved/${id}`),

  getProfile: () => request('GET', '/api/profile'),
  updateProfile: (profile) => request('PUT', '/api/profile', profile),
  resetProfile: () => request('POST', '/api/profile/reset'),
};

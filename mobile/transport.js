/** The native HTTP plugin keeps HttpOnly session cookies in Android's cookie store. */
export function createNativeRequest(server, http) {
  return async (path, options = {}) => {
    if (!path.startsWith('/api/')) throw new Error('Native requests must use the Pantry Scoop API.');
    const response = await http.request({
      url: server + path,
      method: options.method || 'GET',
      // This is a native request to the configured server. Browser CSRF checks stay unchanged.
      headers: { ...options.headers, Origin: server },
      ...(options.body === undefined ? {} : { data: JSON.parse(options.body) }),
      connectTimeout: 15000, readTimeout: 30000, disableRedirects: true,
      responseType: 'json',
    });
    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      json: async () => typeof response.data === 'string' ? JSON.parse(response.data) : response.data,
    };
  };
}

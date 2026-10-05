/** Browser implementation; Android installs its adapter before importing the same application. */
export const platform = {
  native: false,
  request: (url, options) => fetch(url, options),
  signIn: undefined,
  pickPhotos: undefined,
  signOut: async () => {},
};

export function installPlatform(adapter) {
  Object.assign(platform, adapter);
}

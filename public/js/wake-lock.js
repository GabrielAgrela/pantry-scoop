const quietly = (work) => { try { Promise.resolve(work()).catch(() => {}); } catch { /* unsupported: the screen just sleeps as usual */ } };

/**
 * Keeps the screen awake (an open recipe, so it doesn't go dark mid-step) until the returned
 * function is called. The browser drops a wake lock whenever the page is hidden, so it is taken again
 * each time the page becomes visible. Unsupported or refused: nothing happens, and nothing is shown.
 */
export function keepScreenAwake({ wakeLock = globalThis.navigator?.wakeLock, doc = globalThis.document } = {}) {
  let held = true;
  if (typeof wakeLock?.request !== 'function' || !doc) return () => {};
  let lock, asking = false;
  const acquire = () => {
    if (!held || asking || (lock && !lock.released) || doc.visibilityState !== 'visible') return;
    asking = true;
    Promise.resolve().then(() => wakeLock.request('screen')).then((granted) => {
      // Closed while the browser was deciding: let go straight away.
      if (held) lock = granted;
      else quietly(() => granted.release());
    }).catch(() => {}).finally(() => { asking = false; });
  };
  doc.addEventListener('visibilitychange', acquire);
  acquire();
  return () => {
    if (!held) return;
    held = false;
    doc.removeEventListener('visibilitychange', acquire);
    const granted = lock;
    lock = undefined;
    if (granted && !granted.released) quietly(() => granted.release());
  };
}

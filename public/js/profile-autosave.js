/** Serialize partial updates so a slow response cannot overwrite a newer edit. */
export function createProfileAutosave(save, onStatus, delay = 450) {
  let pending = {}, timer, running = false;
  const hasPending = () => Object.keys(pending).length > 0;
  async function flush() {
    clearTimeout(timer);
    if (running || !hasPending()) return;
    running = true;
    onStatus('saving');
    while (hasPending()) {
      const changes = pending;
      pending = {};
      try {
        await save(changes);
      } catch (error) {
        clearTimeout(timer);
        pending = { ...changes, ...pending };
        running = false;
        onStatus('error', error);
        return;
      }
    }
    clearTimeout(timer);
    running = false;
    onStatus('saved');
  }
  return {
    change(changes, wait = delay) {
      pending = { ...pending, ...changes };
      clearTimeout(timer);
      onStatus('pending');
      if (wait === 0) void flush();
      else timer = setTimeout(flush, wait);
    },
    flush,
  };
}

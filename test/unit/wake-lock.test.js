import assert from 'node:assert/strict';
import { it } from 'node:test';
import { keepScreenAwake } from '../../public/js/wake-lock.js';

const tick = () => new Promise(resolve => setImmediate(resolve));

/** A page whose visibility can change, and a Screen Wake Lock API that records its locks. */
function page({ refuse = false } = {}) {
  const listeners = new Set();
  const locks = [];
  const doc = {
    visibilityState: 'visible',
    addEventListener: (name, callback) => { if (name === 'visibilitychange') listeners.add(callback); },
    removeEventListener: (name, callback) => { if (name === 'visibilitychange') listeners.delete(callback); },
  };
  const wakeLock = {
    request: async (type) => {
      assert.equal(type, 'screen');
      if (refuse) throw new Error('NotAllowedError');
      const lock = { released: false, release: async () => { lock.released = true; } };
      locks.push(lock);
      return lock;
    },
  };
  const setVisible = (visible) => {
    doc.visibilityState = visible ? 'visible' : 'hidden';
    // The browser drops screen locks when the page is hidden.
    if (!visible) locks.forEach(lock => { lock.released = true; });
    listeners.forEach(callback => callback());
  };
  const held = () => locks.filter(lock => !lock.released).length;
  return { doc, wakeLock, locks, listeners, setVisible, held };
}

it('holds a screen lock while the recipe is open and lets go when it closes', async () => {
  const p = page();
  const release = keepScreenAwake({ wakeLock: p.wakeLock, doc: p.doc });
  await tick();
  assert.equal(p.held(), 1);
  release();
  assert.equal(p.held(), 0);
  assert.equal(p.listeners.size, 0);
  release();
});

it('takes the lock again when the page becomes visible with the recipe still open', async () => {
  const p = page();
  const release = keepScreenAwake({ wakeLock: p.wakeLock, doc: p.doc });
  await tick();
  p.setVisible(false);
  await tick();
  assert.equal(p.held(), 0);
  assert.equal(p.locks.length, 1, 'no request while hidden');
  p.setVisible(true);
  await tick();
  assert.equal(p.held(), 1);
  assert.equal(p.locks.length, 2);
  release();
  p.setVisible(false); p.setVisible(true);
  await tick();
  assert.equal(p.locks.length, 2, 'nothing after closing');
});

it('waits for the page to be visible, and releases a lock granted after closing', async () => {
  const p = page();
  p.doc.visibilityState = 'hidden';
  const release = keepScreenAwake({ wakeLock: p.wakeLock, doc: p.doc });
  await tick();
  assert.equal(p.locks.length, 0);
  p.setVisible(true);
  release();
  await tick();
  assert.equal(p.locks.length, 1);
  assert.equal(p.held(), 0);
});

it('does nothing, quietly, when the lock is unsupported or refused', async () => {
  const unsupported = page();
  keepScreenAwake({ wakeLock: undefined, doc: unsupported.doc })();
  const refused = page({ refuse: true });
  const release = keepScreenAwake({ wakeLock: refused.wakeLock, doc: refused.doc });
  await tick();
  assert.equal(refused.locks.length, 0);
  refused.setVisible(true);
  await tick();
  release();
});

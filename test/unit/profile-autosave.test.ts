import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
type Changes = Record<string, unknown>;
const { createProfileAutosave } = (await import(new URL('../../public/js/profile-autosave.js', import.meta.url).href)) as {
  createProfileAutosave: (save: (changes: Changes) => Promise<unknown>, status: (state: string, error?: Error) => void) => {
    change: (changes: Changes, delay?: number) => void;
    flush: () => Promise<void>;
  };
};

describe('kitchen preference autosaving', () => {
  it('serializes requests and keeps edits made while an earlier save is in flight', async () => {
    const requests: Changes[] = [];
    let finishFirst!: () => void;
    const first = new Promise<void>(resolve => { finishFirst = resolve; });
    const statuses: string[] = [];
    const saver = createProfileAutosave(async changes => {
      requests.push(changes);
      if (requests.length === 1) await first;
    }, status => statuses.push(status));
    saver.change({ servings: 3 });
    const saving = saver.flush();
    saver.change({ servings: 4 });
    saver.change({ units: 'Spoons → Metric' });
    assert.deepEqual(requests, [{ servings: 3 }]);
    finishFirst();
    await saving;
    assert.deepEqual(requests, [{ servings: 3 }, { servings: 4, units: 'Spoons → Metric' }]);
    assert.equal(statuses.at(-1), 'saved');
  });
  it('retains failed edits for retry without replacing a newer value', async () => {
    const requests: Changes[] = [];
    let failFirst!: () => void;
    const first = new Promise<void>((_resolve, reject) => { failFirst = () => reject(new Error('Offline')); });
    const statuses: string[] = [];
    const saver = createProfileAutosave(async changes => {
      requests.push(changes);
      if (requests.length === 1) await first;
    }, status => statuses.push(status));
    saver.change({ servings: 3, language: 'English' });
    const saving = saver.flush();
    saver.change({ servings: 5 });
    failFirst();
    await saving;
    assert.equal(statuses.at(-1), 'error');
    await saver.flush();
    assert.deepEqual(requests[1], { servings: 5, language: 'English' });
    assert.equal(statuses.at(-1), 'saved');
  });
});

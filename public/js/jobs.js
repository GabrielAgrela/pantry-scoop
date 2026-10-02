import { api } from './api.js';

const POLL_MS = 1500;

/** Latest job of a kind (scan/recipes), or undefined. */
export async function latestJob(kind) {
  const { jobs } = await api.listJobs(kind, 1);
  return jobs[0];
}

/**
 * Polls a job until it finishes, calling onUpdate with each state. Returns a stop function.
 * Polling continues across views; jobs run on the server either way.
 */
export function watchJob(job, onUpdate) {
  let stopped = false;
  let timer;
  const tick = async () => {
    if (stopped) return;
    try {
      const { job: current } = await api.getJob(job.id);
      onUpdate(current);
      if (current.status === 'running') timer = setTimeout(tick, POLL_MS);
    } catch {
      timer = setTimeout(tick, POLL_MS * 2); // network blip: keep trying
    }
  };
  onUpdate(job);
  if (job.status === 'running') timer = setTimeout(tick, POLL_MS);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

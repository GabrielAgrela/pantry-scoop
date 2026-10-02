import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { JobService } from '../../src/application/job-service.ts';
import { UsageLimitError } from '../../src/domain/errors.ts';
import { openDatabase } from '../../src/infrastructure/db/database.ts';
import { SqliteJobRepository } from '../../src/infrastructure/db/sqlite-job-repository.ts';
import { accountRepos, identity } from '../fakes/fixtures.ts';

const tick = () => new Promise((resolve) => setImmediate(resolve));

function setup() {
  const db = openDatabase(':memory:');
  const userId = accountRepos(db).users.create(identity()).id;
  return { db, userId, repo: new SqliteJobRepository(db, userId) };
}

describe('JobService', () => {
  it('records success and failure without blocking the caller', async () => {
    const { repo } = setup();
    const unexpected: unknown[] = [];
    const jobs = new JobService(repo, (error) => unexpected.push(error));

    const ok = jobs.start('recipes', { count: 1 }, async () => ({ recipes: [] }));
    const limited = jobs.start('scan', { photos: 1 }, async () => {
      throw new UsageLimitError('limit');
    });
    const crashed = jobs.start('scan', { photos: 1 }, async () => {
      throw new TypeError('bug');
    });
    assert.equal(ok.status, 'running');
    await tick();

    assert.deepEqual(jobs.find(ok.id)?.result, { recipes: [] });
    assert.deepEqual(jobs.find(limited.id)?.error, { message: 'limit', code: 'usage-limit' });
    assert.deepEqual(jobs.find(crashed.id)?.error, { message: 'Something went wrong. Try again.', code: 'internal' });
    assert.equal(unexpected.length, 1, 'only unexpected errors are reported');
    assert.deepEqual(jobs.recent('scan').map((j) => j.id), [crashed.id, limited.id]);
  });

  it('marks jobs left running by a previous process as interrupted', () => {
    const { db, repo } = setup();
    const job = repo.create('scan', { photos: 1 });
    SqliteJobRepository.failInterrupted(db);
    assert.equal(repo.find(job.id)?.status, 'failed');
    assert.match(repo.find(job.id)?.error?.message ?? '', /Interrupted/);
  });

  it('keeps only the most recent jobs', () => {
    const { repo } = setup();
    for (let i = 0; i < 35; i++) repo.create('recipes', { i });
    assert.equal(repo.recent(undefined, 100).length, 30);
  });
});

import { hostname } from 'node:os';
import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { jobLocks, type Db } from '@transaxis/database';

export interface Job {
  name: string;
  everyMs: number;
  run(now: Date): Promise<void>;
}

/**
 * In-process scheduler. Each run first takes a lease row in `job_locks`, so when several API processes
 * share a database (dev server and share mode, or replicas) only one of them runs a given job.
 */
export class JobRunner {
  private timers: NodeJS.Timeout[] = [];
  private running = new Set<string>();
  readonly owner = `${hostname()}:${process.pid}`;

  constructor(
    private readonly db: Db,
    private readonly log: Logger,
    private readonly jobs: Job[],
  ) {}

  start(): void {
    for (const [i, job] of this.jobs.entries()) {
      // Stagger first runs so jobs don't all hit the database at once on boot.
      const first = setTimeout(() => void this.tick(job), 2_000 + i * 750);
      this.timers.push(first, setInterval(() => void this.tick(job), job.everyMs));
    }
    this.log.info({ jobs: this.jobs.map((j) => j.name), owner: this.owner }, 'background jobs started');
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  /** Runs a job once if its lease can be taken. Exposed for tests. */
  async tick(job: Job, now = new Date()): Promise<boolean> {
    if (this.running.has(job.name)) return false;
    this.running.add(job.name);
    try {
      if (!(await this.lease(job, now))) return false;
      await job.run(now);
      return true;
    } catch (err) {
      this.log.error({ err, job: job.name }, 'background job failed');
      return false;
    } finally {
      this.running.delete(job.name);
    }
  }

  private async lease(job: Job, now: Date): Promise<boolean> {
    const until = new Date(now.getTime() + Math.max(job.everyMs * 3, 30_000));
    // Take over an expired lease, or extend our own.
    const [res] = await this.db.execute(
      sql`UPDATE ${jobLocks} SET locked_until = ${until}, locked_by = ${this.owner} WHERE name = ${job.name} AND (locked_until < ${now} OR locked_by = ${this.owner})`,
    );
    if ((res as { affectedRows: number }).affectedRows > 0) return true;
    const [ins] = await this.db.execute(sql`INSERT IGNORE INTO ${jobLocks} (name, locked_until, locked_by) VALUES (${job.name}, ${until}, ${this.owner})`);
    return (ins as { affectedRows: number }).affectedRows > 0;
  }
}

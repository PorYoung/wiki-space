import PgBoss from 'pg-boss';
import type { Job, JobEnqueueOptions, JobQueue, QueueName } from '@ewiki/shared';

/** pg-boss 适配器（ADR-10：与 Drizzle 事务原子入队的升级点 = fromDrizzle 适配器） */
export class PgJobQueue implements JobQueue {
  constructor(private readonly boss: PgBoss) {}

  async enqueue(
    queue: QueueName,
    data: unknown,
    opts?: JobEnqueueOptions,
  ): Promise<{ jobId: string; deduped: boolean }> {
    // 幂等键 → pg-boss 自定义 job id；同 id 在保留期内重复发送返回 null（SDD 4.3 O1）
    const jobId = await this.boss.send(
      queue,
      data as object,
      opts?.idempotencyKey ? { id: opts.idempotencyKey } : {},
    );
    return { jobId: jobId ?? '', deduped: jobId === null };
  }

  async work(queue: QueueName, handler: (job: Job) => Promise<void>): Promise<void> {
    // v10 handler 收到一批任务；批量内逐个执行，抛错由 pg-boss 按退避策略重试（SDD 6.5）
    await this.boss.work(queue, { batchSize: 5 }, async (jobs) => {
      for (const job of jobs) {
        await handler({ id: job.id, queue, data: job.data });
      }
    });
  }

  async scheduleCron(queue: QueueName, cron: string): Promise<void> {
    await this.boss.schedule(queue, cron, undefined, { tz: 'Asia/Shanghai' });
  }
}

import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

export async function completeJob(context, operation, records) {
  const initial = await operation;
  for (let i = 0; i < 2400; i++) {
    const job = await context.jobs.get(initial.id);
    if (!['queued', 'running'].includes(job.state)) {
      records.push(context.jobs.summary(job)); console.log(JSON.stringify(records.at(-1)));
      assert.equal(job.state, 'succeeded', job.error);
      return { job, value: JSON.parse(await fs.readFile(path.join(job.dir, 'result.json'))) };
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('样本任务未按期限结束');
}

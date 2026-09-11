import PgBoss from 'pg-boss';

const boss = new PgBoss({ connectionString: 'postgres://ewiki:ewiki@localhost:5432/ewiki' });
boss.on('error', (e) => console.error('boss error:', e));

try {
  await boss.start();
  const q = await boss.getQueue('sync');
  console.log('sync queue =', JSON.stringify(q));
  const jobId = await boss.send(
    'sync',
    { sourceId: '00000000-0000-0000-0000-000000000000', trigger: 'manual' },
    { singletonKey: 'repro-sync', singletonMinutes: 1 },
  );
  console.log('send ok =', jobId);
} catch (err) {
  console.error('SEND FAILED:', (err as Error).message);
} finally {
  await boss.stop?.();
  process.exit(0);
}

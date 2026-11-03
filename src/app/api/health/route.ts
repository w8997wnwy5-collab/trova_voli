import { connection } from 'next/server';
import { getProviders } from '@/lib/providers/registry';
import { databaseHealthy } from '@/lib/server/db';

/** Liveness and configuration overview. Never exposes secrets. */
export async function GET() {
  await connection();
  const { active, inactive } = getProviders();
  const db = await databaseHealthy();
  return Response.json(
    {
      status: 'ok',
      providers: [
        ...active.map((p) => ({ id: p.id, name: p.name, enabled: true, dataQuality: p.capabilities.dataQuality })),
        ...inactive.map((p) => ({ id: p.id, name: p.name, enabled: false, reason: p.reason })),
      ],
      database: db === null ? 'not-configured' : db ? 'ok' : 'unreachable',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

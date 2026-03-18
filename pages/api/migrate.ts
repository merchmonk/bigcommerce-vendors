import type { NextApiRequest, NextApiResponse } from 'next';
import { runMigrations } from '../../lib/db';

/**
 * Run DB migrations on the server (Lambda). Protected by MIGRATE_SECRET.
 * After deploy, call once: curl -X POST -H "x-migrate-token: YOUR_SECRET" https://your-app.cloudfront.net/api/migrate
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.MIGRATE_SECRET;
  if (!secret) {
    return res.status(503).json({
      error: 'Migrations not configured',
      hint: 'Set MIGRATE_SECRET in the app environment to enable server-side migrations.',
    });
  }

  const token = req.headers['x-migrate-token'];
  if (token !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const seed = req.query.seed === '1' || req.query.seed === 'true';
    await runMigrations({ seed });
    return res.status(200).json({ ok: true, message: 'Migrations completed' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Migration failed';
    console.error('Migration error:', err);
    return res.status(500).json({ error: message });
  }
}

import type { NextApiRequest, NextApiResponse } from 'next';
import { handleRuns } from '@/lib/jobs/handlers';

// Only GETs and the body-less cancel are routed here; there is no client route that creates a raw run.
export const config = { api: { bodyParser: { sizeLimit: '8kb' } } };

/** GET runs, runs/{id}, service-info, storage-setup; POST runs/{id}:cancel. Everything else is 404 before auth. Logic: lib/jobs/handlers.ts (always the real dependencies here). */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  return handleRuns(req, res);
}

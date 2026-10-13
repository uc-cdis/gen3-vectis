import type { NextApiRequest, NextApiResponse } from 'next';
import { handleSubmit } from '@/lib/jobs/handlers';

export const config = { api: { bodyParser: { sizeLimit: '64kb' } } };

/** POST /api/jobs/submit { job, params }: compiled on the server from the catalog, then run. Needs /Jobs/submit. Logic: lib/jobs/handlers.ts (always the real dependencies here). */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  return handleSubmit(req, res);
}

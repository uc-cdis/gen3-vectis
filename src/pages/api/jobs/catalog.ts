import type { NextApiRequest, NextApiResponse } from 'next';
import { handleCatalog } from '@/lib/jobs/handlers';

/** GET /api/jobs/catalog: job definitions from the configured source, pinned to one version. Read-only; same gate as /Jobs. Logic: lib/jobs/handlers.ts (always the real dependencies here). */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  return handleCatalog(req, res);
}

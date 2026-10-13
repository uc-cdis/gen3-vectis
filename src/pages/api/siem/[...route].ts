import type { NextApiRequest, NextApiResponse } from 'next';
import { matchRoute } from '@/lib/vectis-kit/api/routes';
import {
  MAX_RESPONSE_BYTES, UPSTREAM_TIMEOUT_MS, authorize, publicError, upstreamBase, upstreamHeaders, validSegments, writeAllowed,
} from '@/lib/siem/bff';
import { callUpstream } from '@/lib/upstream';

export const config = { api: { bodyParser: { sizeLimit: '256kb' } } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store');
  const method = req.method ?? '';
  const segments = validSegments(req.query.route);
  const route = segments ? matchRoute(method, segments) : null;
  if (!segments || !route) return res.status(404).json({ error: 'Not found.' });

  if (!writeAllowed(req, method)) return res.status(403).json({ error: 'Cross-site request refused.' });
  const hasBody = method !== 'GET' && method !== 'DELETE';
  if (hasBody && !String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    return res.status(415).json({ error: 'JSON required.' });
  }

  const access = await authorize(req.headers.cookie);
  if (!access.ok) return res.status(access.status).json({ error: access.error });

  const out = await callUpstream(`${upstreamBase()}/siem/${segments.map(encodeURIComponent).join('/')}`, {
    method,
    headers: upstreamHeaders(access, hasBody),
    body: hasBody ? JSON.stringify(req.body ?? {}) : undefined,
  }, { timeoutMs: UPSTREAM_TIMEOUT_MS, maxBytes: MAX_RESPONSE_BYTES });
  switch (out.kind) {
    case 'ok': return res.status(out.status).json(out.payload);
    case 'rejected': { const e = publicError(out.status, out.payload); return res.status(e.status).json(e.body); }
    case 'too-large': return res.status(502).json({ error: 'The security service returned too much data.' });
    case 'unreadable': return res.status(502).json({ error: 'The security service returned an unreadable response.' });
    case 'timeout': return res.status(504).json({ error: 'The security service took too long to respond.' });
    case 'unreachable': return res.status(502).json({ error: 'The security service could not be reached.' });
  }
}

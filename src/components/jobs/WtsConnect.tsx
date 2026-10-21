import React, { useEffect, useState } from 'react';
import { Alert, Anchor } from '@mantine/core';
import { useJobsApi } from '@/lib/jobs/api/hooks';

const CONNECTED = '/wts/oauth2/connected';
const AUTHORIZE = '/wts/oauth2/authorization_url?redirect=/Jobs';
const ASKED = 'vectis.wts.asked';
const goTo = (url: string) => window.location.assign(url);

/**
 * Jobs that run as you (the notebook and as-user profiles) get your token from the workspace token service, which can only hand out
 * a token once you have approved it, one time, in the browser. This asks the service whether that has happened and, if not, sends you to
 * the approval screen once per browser session (so declining does not loop) and keeps a link on the page afterwards.
 * Anything other than a clear "not connected" answer (no token service, a network error) shows nothing: jobs that do not need it still work.
 */
const WtsConnect = ({ redirect = goTo }: { redirect?: (url: string) => void }) => {
  const live = useJobsApi().mode === 'live';
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    fetch(CONNECTED, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then((r) => {
        if (cancelled || r.ok || (r.status !== 401 && r.status !== 403)) return;
        setMissing(true);
        try {
          if (window.sessionStorage.getItem(ASKED)) return;
          window.sessionStorage.setItem(ASKED, '1');
        } catch { return; } // storage blocked: show the link, never redirect
        redirect(AUTHORIZE);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [live, redirect]);

  if (!missing) return null;
  return (
    <Alert color="yellow" title="Approve the token service to run jobs as you" mb="md" data-testid="wts-connect">
      Jobs that run as you, such as notebooks, need your one-time approval of the workspace token service.{' '}
      <Anchor href={AUTHORIZE}>Approve now</Anchor>. You will be sent back to this page.
    </Alert>
  );
};
export default WtsConnect;

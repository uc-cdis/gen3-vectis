import { registerDownloadButtonAction } from '@gen3/frontend';
import { pythonLiteral } from '@/lib/vectis-kit/spec-actions/snippets';

/**
 * Registered button action: "copy-filter-python"
 *
 * Serialises the current Explorer filter + data_type into a ready-to-paste
 * self-contained Python snippet that downloads the same cohort from Guppy inside a workspace notebook.
 */
const copyFilterAsPythonAction = async (
  params: Record<string, unknown>,
  done?: () => void,
): Promise<void> => {
  const dataType = (params.type as string) ?? 'audit_event';
  const filter = params.filter ?? {};
  const fields = Array.isArray(params.fields) ? params.fields : [];

  const code = [
    `# Cohort from the Vectis Explorer: paste into a Vectis workspace notebook.`,
    `# Inside a workspace, Gen3Auth() uses the workspace's own credentials; nothing is embedded here.`,
    `import pandas as pd`,
    `import requests`,
    `from gen3.auth import Gen3Auth`,
    ``,
    `auth = Gen3Auth()`,
    `payload = {`,
    `    "type": ${JSON.stringify(dataType)},`,
    `    "fields": ${pythonLiteral(fields, 1)},`,
    `    "filter": ${pythonLiteral(filter, 1)},`,
    `}`,
    `resp = requests.post(f"{auth.endpoint}/guppy/download", json=payload, auth=auth)`,
    `resp.raise_for_status()`,
    `df = pd.DataFrame(resp.json())`,
    `df.head()`,
  ].join('\n');

  try {
    await navigator.clipboard.writeText(code);
  } catch {
    // Fallback: prompt so the user can copy manually
    window.prompt('Copy the filter snippet below:', code);
  }

  if (done) done();
};

export const registerCustomButtonActions = (): void => {
  registerDownloadButtonAction('copy-filter-python', {
    action: copyFilterAsPythonAction,
    args: {},
  });
};

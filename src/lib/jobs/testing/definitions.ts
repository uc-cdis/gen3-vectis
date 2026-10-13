/**
 * Inline job definitions for unit tests. Definitions are never shipped with the portal (the catalog lives in a separate
 * repository and is loaded at run time), so tests carry the few they need here instead of reading files.
 * Test-only: nothing outside *.test.* files may import this module.
 */

/** Native Dagu file: three parallel branches and a join, one user parameter. Uses the `command` executor (off by default). */
export const DAG_FANOUT = `name: fanout
description: Three parallel branches that join into one final step.
type: graph
params:
  - label: demo
steps:
  - id: branch_a
    run: echo "branch a for \${params.label}"
  - id: branch_b
    run: echo "branch b for \${params.label}"
  - id: branch_c
    run: echo "branch c for \${params.label}"
  - id: join
    depends: [branch_a, branch_b, branch_c]
    run: echo "joined \${params.label}"
`;

/** Catalog entry for DAG_FANOUT (our metadata; `definition` points at the native file). */
export const ENTRY_FANOUT = `schema_version: 1
kind: dag
engine: dagu
id: dag-fanout
name: Fan-out and join
description: Three parallel branches that join into one final step.
tags: [example, dag]
definition: dags/fanout.yaml
owner: platform
params:
  - name: label
    label: Label
    description: Short label printed by each branch
    type: string
    default: demo
    pattern: "^[A-Za-z0-9_.-]{1,32}$"
    max_length: 32
`;

/** Native Dagu file: two sequential shell steps. */
export const DAG_HELLO = `name: hello
description: Smallest possible DAG, two steps in sequence.
type: graph
steps:
  - id: greet
    run: echo "Hello from Vectis Jobs"
  - id: finish
    depends: [greet]
    run: echo "done"
`;

export const ENTRY_HELLO = `schema_version: 1
kind: dag
engine: dagu
id: dag-hello
name: Hello workflow
description: "Smallest possible DAG: two steps in sequence."
tags: [example, dag]
definition: dags/hello.yaml
owner: platform
`;

/** Native Dagu file using only the http and jq executors and one Dagu secret. */
export const DAG_SOC = `name: soc-enrich-indicator
description: Enrich an indicator, shape the result and notify a webhook.
type: graph
params:
  - indicator: 198.51.100.7
secrets:
  - name: SOC_WEBHOOK_URL
    provider: env
    key: VECTIS_JOB_SOC_WEBHOOK_URL
steps:
  - id: enrich
    action: http.request
    with:
      method: GET
      url: https://intel.example.org/api/v1/indicator
      query:
        value: \${params.indicator}
      timeout: 30
      silent: true   # body only (otherwise the status line and headers are written to stdout too)
  - id: shape
    depends: [enrich]
    action: jq.filter
    with:
      input: \${enrich.stdout}
      filter: '{indicator: .indicator, score: .score, tags: .tags}'
    output: SUMMARY
  - id: notify
    depends: [shape]
    action: http.request
    with:
      method: POST
      url: \${SOC_WEBHOOK_URL}
      headers:
        Content-Type: application/json
      body: \${SUMMARY}
      timeout: 30
      silent: true
`;

export const ENTRY_SOC = `schema_version: 1
kind: dag
engine: dagu
id: dag-soc-enrich
name: "SOC: enrich an indicator"
description: Look up an indicator, shape the answer with jq and notify a webhook. Native executors only (http, jq).
tags: [soc, dag]
definition: dags/soc-enrich-indicator.yaml
owner: security-engineering
params:
  - name: indicator
    label: Indicator
    description: IP address or domain
    type: string
    required: true
    pattern: "^[A-Za-z0-9_.:-]{1,128}$"
    max_length: 128
`;

# Jobs: runner-agnostic portal feature

A catalog YAML job is compiled on the server into a neutral `LaunchSpec` and run by ONE `Runner`
chosen by `JOBS_RUNNER`. The browser and the YAML never know which. Nothing is stored in the portal; all locations are env config.

**Definitions are never shipped with the portal.** The catalog lives in a separate GitHub repository (a `jobs/` directory, see "Catalog repository") and is read at run time through the GitHub `CatalogSource`; jobs execute on a real TES or Dagu server. This repository contains no job or DAG YAML (unit tests carry small inline definitions in `testing/definitions.ts`).

## Architecture
```
browser -> /api/jobs/* (thin handlers: route allowlist, query validation, same-origin, /Jobs gates, fail closed)
        -> getRunner()  (select.ts registry)  -> Runner { submit, list, get, cancel, info, storageSetup? }
        -> tesRunner  (tes/tesRunner.ts):   GA4GH TES / gen3-workflow with the USER's own bearer         (JOBS_RUNNER=tes, default)
        -> daguRunner (dagu/daguRunner.ts): a separate Dagu server over its REST API, ONE service identity  (JOBS_RUNNER=dagu; see "Dagu runner")
```
- `model.ts`: neutral `Run` (states `queued starting running succeeded failed cancelled unknown`, `backend_state` = runner's own word shown as secondary text), `isActive`, `normalizeRun` (browser re-validates what the server sends). The UI renders ONLY `Run`.
- `launch.ts` + `jobdef/compile.ts`: `compileJob()` is the single compiler (all param/secret/URL/lint checks) and returns a `LaunchSpec`. `tes/adapter.ts`: `toTesTask(spec)` (byte-identical to the old task, pinned by a test) and `fromTesTask(task) -> Run`.
- `runner.ts`: the `Runner` interface; `RunnerError` carries a safe public message + HTTP status.
- UI: `src/components/jobs` + `api/` (`JobsApi`); fixtures build runs through the same `fromTesTask`.

| Method / path | Gate | Returns |
|---|---|---|
| GET `/api/jobs/runs?detail&state&name_prefix&tag_key&tag_value&page_size&page_token` | /Jobs | `{runs: Run[], next_page_token}` |
| GET `/api/jobs/runs/{id}?detail=summary\|full` | /Jobs | `Run` |
| POST `/api/jobs/runs/{id}:cancel` | /Jobs/submit | `{}` |
| POST `/api/jobs/submit` `{job, params}` | /Jobs/submit | `{id, warnings[]}` |
| GET `/api/jobs/catalog` | /Jobs | `Catalog` |
| GET `/api/jobs/service-info` | /Jobs | `{name?, version?}` |
| GET `/api/jobs/storage-setup` | /Jobs | `StorageSetup` (404 if the runner has none) |

Everything else (raw run creation, `storage/user-bucket`, `/s3`, `/ui`, the old `/api/tes/*`) is 404 before auth. Errors are `{error, details?}`.
`state` filter on TES: a neutral state that covers several TES states (`running`, `failed`) is filtered on the fetched page, not upstream.

## Environment variables
| Variable | Meaning |
|---|---|
| `JOBS_RUNNER` | Runner id: `tes` (default when unset/empty) or `dagu`. Anything else = 500 "unknown runner" on every Jobs route (fail closed, no fallback). |
| `TES_SERVICE_URL` | (tes) required. TES base incl. root, e.g. `https://host/ga4gh/tes/v1`. https only unless `NODE_ENV` is exactly `development` or `test`. |
| `TES_STORAGE_URL` | (tes) base for `/storage/setup`, needed for `{{user_bucket}}` |
| `JOBS_ALLOWED_IMAGE_PREFIXES` (or `TES_ALLOWED_IMAGE_PREFIXES`) | container image policy, shared by TES executors and Dagu docker steps (`images.ts`). The neutral `JOBS_*` name wins; the `TES_*` name is still read, so existing deployments are unchanged. Production: required. Entry ending `/` = prefix; else exact repository (`name` or `name:tag`). Unset in production = containers DENIED |
| `JOBS_REQUIRE_IMAGE_DIGEST` / `TES_REQUIRE_IMAGE_DIGEST` | `true` requires `@sha256:<64 hex>` on every image |
| `JOBS_ALLOW_ANY_IMAGE` / `TES_ALLOW_ANY_IMAGE` | DANGEROUS; in production ignored unless `..._I_UNDERSTAND_ANY_IMAGE_IS_UNSAFE=yes` (same prefix as the variable used) |
| `TES_ALLOWED_URL_HOSTS` | recommended: exact hosts or `*.suffix`; when set it is the ONLY accepted set for `http_url` params and non-s3 urls (applies to every runner) |
| `TES_CATALOG_REPO` / `_PATH` (`jobs`) / `_REF` (`main`) / `_GITHUB_TOKEN` | GitHub catalog. Token: k8s Secret env, server-side only, sent only to api.github.com. (Names keep the `TES_` prefix for deploy compatibility; they are runner-independent.) |

Arborist keys (`config/gen3/authz.json`): `/Jobs` -> read, `/Jobs/submit` -> submit/cancel; holding ANY permission on the mapped resource grants the gate. The resource paths are placeholders. `vectis.submitted_by` = verified email, then username, then name.

## Job definition (YAML, runner-neutral; no `runner` field)
One file = one job. Schema in `jobdef/schema.ts`; max 64KB; unknown keys, anchors, merge keys, duplicates, multiple docs rejected. Fields: `schema_version, id, name, description, tags, image, command[] (argv), env, params[], inputs[], outputs[], resources, executors_after[], secrets[], timeout_seconds (hint), owner`. `{{param}}` only in argv, env values, input/output urls; `{{user_bucket}}` only in urls.

## Slotting in another runner
Add ONE file implementing `Runner` (e.g. `src/lib/jobs/argoRunner.ts`) and ONE line in `select.ts` `RUNNERS`. Nothing in the UI, routes, YAML or compiler changes.
Contract:
- `submit(spec: LaunchSpec, ctx)`, `list(query, ctx)`, `get(id, ctx, {detail})`, `cancel(id, ctx)`, `info(ctx)`; optional `storageSetup(ctx)`. Return neutral `Run`/`LaunchSpec` types only; map the remote's states into the 7 neutral states and keep its word in `backend_state`; sanitise and cap everything from the remote (see `tes/normalize.ts`); throw `RunnerError(status, safeMessage)`; never echo upstream detail.
- `ctx.user` is the verified identity, `ctx.token` the user's bearer. An adapter must act with the USER's credentials, or the remote server must enforce per-user ownership itself. NEVER cloud IAM held by the portal, and never AWS credentials in the browser. Stamp `vectis.submitted_by = ctx.user` and drop other client-looking `vectis.*` tags.
- Apply your own image policy (the TES one is `prepareTask`/`imageAllowed`); the compiler already enforced the portable limits and credential lint.

What the YAML maps to on a runner:
| YAML | Mapping |
|---|---|
| `image`, `command`, `executors_after` | steps (TES executors; a workflow engine: ordered containers/DAG nodes) |
| `inputs`/`outputs` (`url`, `path`) | staged by the runner/backend (TES inputs/outputs; workflow engines: artifacts or a staging step). Only `s3://` is portable |
| `resources` | cpu/ram/disk/preemptible requests, as far as the remote supports them |
| `env` | plain values passed through; `secret://name` is passed UNRESOLVED and resolved by the remote, if it can |
| `timeout_seconds` | hint; enforce remotely if possible (TES v1.1 has no field) |
| `{{user_bucket}}` | TES/gen3-workflow only (`/storage/setup`). A runner without `storageSetup` makes such jobs fail with "the active jobs runner does not provide" a personal bucket |

Routes (neither needs portal IAM or a portal-side backend). (b) now exists: see "Dagu runner" below.
- (a) AWS Batch (or any other executor): it is simply what the TES server uses to run tasks. Point `TES_SERVICE_URL` at that TES server; no portal change.
- (b) DAG/workflow engines: write an adapter for an existing server. Examples: Dagu/Blackdagger (YAML DAG servers with an HTTP API), Argo Workflows (REST), a GA4GH WES server. Dagu/Blackdagger are GPL-3.0: only ever talk to them over HTTP as a separate server; never embed, link or copy their code.
  Design rule (implemented for Dagu): the catalog entry passes the engine's NATIVE definition file through (`kind: dag`, `engine: dagu`, `definition: <path>`) and the adapter submits it and reads status/graph from the server. We do not invent a translation language. Adapters target a documented minimal API surface (list, start, status, stop), are not pinned to an engine version, and are validated by a contract test against a running instance.

## Threat model
- Shell/option injection: argv array; placeholder after a shell or `-c`/`-e` flag (or as argv[0]) rejected at parse time; whole-element values starting with `-` refused unless `allow_leading_dash`.
- Params are type/enum/range/length/pattern checked before one-pass substitution; control chars refused; undeclared placeholders are errors; url params strict.
- Credentials (AWS keys, PEM, JWT, GitHub/Slack tokens) rejected in defs, compiled specs and raw tasks; env is printable ASCII or `secret://name`, never resolved here. A param can never produce a `secret://` reference (checked per value and on the compiled output, so `{{a}}{{b}}` cannot assemble one). Lint is hygiene, not a boundary.
- Param patterns: <=2 unbounded quantifiers, no quantified groups, input <=256 chars (ReDoS heuristic, no RE2).
- URL checks are a DENYLIST (no IPs, single-label, `.internal/.local/.svc/...`, numeric labels, trailing dots) and INCOMPLETE; set `TES_ALLOWED_URL_HOSTS` and enforce egress controls on the workers.
- Resource caps in the validator (cpu<=16, ram<=128GB, disk<=500GB) are sanity limits; quotas/timeouts MUST be enforced by the backend.
- Handlers: exact allowlist, strict run ids, whitelisted query, same-origin writes, no redirects upstream, 25s timeout, 20MB cap, 64KB log cap with `truncated`, executor env never returned, no upstream detail leaked, catalog token never returned, `backend_parameters` refused, image allowlist fails closed in production.

## NOT verified
- Nothing was run against a real gen3-workflow, GitHub or Arborist; tests mock `fetch` and auth. TES paths, `:cancel`, `/storage/setup` field names and the `{id}` create response come from docs.
- That gen3-workflow accepts our tasks (`type: FILE`, `preemptible`, tag limits) and how it treats `secret://`.
- That the Arborist resources exist. The `{{user_bucket}}` check is only a safe-charset check. Cache is per pod.
- The Dagu runner HAS been run against a real server (see "Dagu runner" > Not verified for what that does not cover). The TES runner still has not.
- `yaml` and `ajv` are NEW RUNTIME dependencies of the portal (jobs catalog/definition parsing and validation; `ajv` was moved from dev to `dependencies`, `yaml` added). Earlier notes calling the jobs feature dependency-free were wrong. Run `npm ci` once to confirm the lockfile.

# Dagu runner (`JOBS_RUNNER=dagu`)

[Dagu](https://github.com/dagucloud/dagu) is a self-hosted workflow engine: DAGs written in YAML, one binary, web UI + REST API. The portal uses it as a **separate server only**: `dagu/daguRunner.ts` calls its documented HTTP API. No Dagu code, UI or schema is copied, vendored, linked or embedded (Dagu is GPL-3.0-or-later; talking to a separate program over HTTP is the supported way to use it without taking on its obligations; its own LICENSING.md says embedding its Go package is different). Blackdagger is a fork and is not targeted; the adapter follows Dagu's published OpenAPI (`api/v1/api.yaml`, server prefix `/api/v1`).

**Tested with: Dagu 2.19.1** (released 2026-10-12), image `ghcr.io/dagucloud/dagu:2.19.1`, digest `sha256:3ee7c8f13c92c063890bbad1a4d300c91511cb363268b05bd112bc9d3af78c7e`, 2026-10-12, in two auth modes (basic; builtin with an API key of role `developer`). The adapter is **not pinned**: it uses the small API surface below, reads only fields it validates, and ignores everything else. After any Dagu upgrade run `npm run test:dagu` (see "Contract test").

## API surface used (and nothing else)
| Call | Used for |
|---|---|
| `POST /dag-runs` `{spec, name, params, dagRunId, labels}` | create + start a run from an **inline** spec; no DAG file is stored on the server |
| `GET /dag-runs?labels=&status=&limit=&cursor=` | list (labels filter = ownership, `nextCursor` = paging) |
| `GET /dag-runs/{name}/{id}` | status + nodes (`depends`, executor type, per-node status/error/times) |
| `GET /dag-runs/{name}/{id}/steps/{step}/log?stream=&head=` | step stdout/stderr (`{content}`) |
| `POST /dag-runs/{name}/{id}/stop` | cancel |
| `GET /health` | version for service-info (no credentials needed by Dagu) |

Auth modes in Dagu 2.19.1 (docs.dagu.sh, Authentication): `none`, `basic` (one account), `builtin` (users, roles, API keys; default), plus OIDC/proxy on builtin. There is no separate "token" mode: a **Bearer API key** (builtin) or **Basic** credentials are what an API client sends. Roles: admin, manager, developer, operator, viewer. **Verified: `operator` gets 403 on `POST /dag-runs` (inline spec); `developer` works.** So the portal's service credential needs `developer`, which can also create/edit/delete DAGs on that server: keep the Dagu server private to the portal (below).

## Deploying
Dagu runs as its own Deployment/Service (image above; port 8080; a volume at `/var/lib/dagu`; `DAGU_AUTH_MODE=builtin`, an admin created with `DAGU_AUTH_BUILTIN_INITIAL_ADMIN_*` from a Secret, then one **API key with role `developer`**, attribution `service_account`, surface `rest_api`; `DAGU_TERMINAL_ENABLED=false`). Reach it from the portal pod only (NetworkPolicy), never from users or the internet; give its pods no cloud credentials beyond what the workflows need. Dagu has no switch to restrict executors, so the portal enforces `DAGU_ALLOWED_EXECUTORS` at catalog load and again at submit; the real boundary for what a step can touch is the Dagu pod/worker (filesystem, network egress, environment), so treat the pod as the sandbox. SMTP for `mail.send` goes in Dagu's own base config (a catalog file may not carry `smtp:`).

Portal-side environment (Secret values from a k8s Secret, the rest from the chart's `env:` / ConfigMap; none is ever logged or returned):
| Variable | Meaning |
|---|---|
| `JOBS_RUNNER=dagu` | select the runner |
| `DAGU_URL` | Dagu root, e.g. `https://dagu.example.org` (a trailing `/api/v1` is removed; a reverse-proxy base path is kept). No credentials, query or fragment. **https required in production** (`isProduction()`: anything but `NODE_ENV` `development`/`test`). |
| `JOBS_OWNER_HMAC_KEY` (Secret) | **required** (all environments) when `JOBS_RUNNER=dagu`: at least 32 bytes of random. Keys the ownership label (HMAC-SHA256 of the verified user). Missing or short = every Dagu route answers 503 with a clear message and nothing is sent to Dagu. **Changing or losing the key orphans existing runs** (their labels no longer match any user): rotate only when old runs may be abandoned. Generate with `openssl rand -hex 32`. |
| `DAGU_ALLOWED_SECRET_KEYS` | which server environment variables a definition's `secrets:` (provider `env`) may read: exact names or `PREFIX*`, comma list. Unset = the single prefix `VECTIS_JOB_`. `DAGU_*`, `AWS_*`, `GITHUB_*`, `JOBS_*`, `TES_*`, `NODE_*`, `LD_*`, `PATH`, `HOME` ... are never allowed whatever the list says. |
| `DAGU_ALLOW_CLUSTER_HTTP=yes` | production only: permits plain `http` **only** for a cluster-local host (`*.svc`, `*.svc.cluster.local`, at least `name.namespace.svc`). Any other value, or any other host, stays refused. |
| `DAGU_HTTP_HOSTS` | production only, and only together with `DAGU_ALLOW_CLUSTER_HTTP=yes`: comma list of private host names (a docker/compose service name such as `dagu`, or `dagu.svc.local`) that may be reached over plain `http`. Matched **exactly**; IP addresses and wildcards are never accepted. Keep Dagu on a private network and allow only the portal to reach it. |
| `DAGU_TOKEN` (Secret) | Bearer API key (builtin auth). Exactly one of this or the Basic pair; both set, or half a pair, = not configured (503). |
| `DAGU_BASIC_USER`, `DAGU_BASIC_PASSWORD` (Secret) | HTTP Basic (basic auth mode) |
| `DAGU_ALLOWED_EXECUTORS` | comma list of executor families a catalog definition may use. Unset/blank = `docker,http,mail,jq`. `command` (alias `shell`; `run:`, `command:`, `script:`, `exec`) and everything else (`ssh`, `file`, `s3`, `postgres`, ...) only when listed. Unknown spellings are ignored (never widen). |
| `JOBS_ALLOWED_IMAGE_PREFIXES` etc. | the image policy above, applied to every docker step |
| `TES_ALLOWED_URL_HOSTS` | also restricts the literal hosts of `http.request` urls |
| `TES_CATALOG_REPO`, ... | the catalog (runner-independent) |

A Helm chart maps these 1:1 (`env:` entries; the three credential variables as `valueFrom.secretKeyRef`). Setting `JOBS_RUNNER=dagu` and not `DAGU_URL` = every Jobs route answers 503 "not configured". A container (TES-style) job submitted to the Dagu runner is refused with 400, and a workflow job to the TES runner likewise.

## Catalog repository
The catalog is a directory in a GitHub repository, named by `TES_CATALOG_REPO` (`owner/name`), `TES_CATALOG_PATH` (default `jobs`), `TES_CATALOG_REF` (default `main`) and, for a private repository, `TES_CATALOG_GITHUB_TOKEN` (server-side only, sent only to api.github.com). The loader resolves the ref to one commit SHA, lists the directory at that SHA and reads every file at the same SHA, so a half-merged change is never served. Layout:
```
jobs/
  <job>.yaml            one catalog entry per job: a container job (TES) or a workflow entry (`kind: dag`)
  dags/<name>.yaml      native Dagu files, referenced by an entry's `definition:` path (same commit)
```
A workflow entry is OUR metadata; `definition` is a path relative to the catalog directory and the native file is passed to Dagu byte for byte. Example (one entry, its native file below the `---`):
```yaml
# jobs/dag-fanout.yaml
schema_version: 1
kind: dag
engine: dagu
id: dag-fanout
name: Fan-out and join
definition: dags/fanout.yaml
params:                  # typed; each name must also be declared in the native params:
  - { name: label, label: Label, type: string, default: demo, pattern: "^[A-Za-z0-9_.-]{1,32}$", max_length: 32 }
---
# jobs/dags/fanout.yaml  (native Dagu)
name: fanout
type: graph
params: [{ label: demo }]
steps:
  - { id: a, run: 'echo "a for ${params.label}"' }
  - { id: join, depends: [a], run: 'echo "joined ${params.label}"' }
```
Entries that fail the lint or schema are reported in the catalog response (`errors`), not served. The `command` executor used above is off by default (see `DAGU_ALLOWED_EXECUTORS`).

## Executors in Dagu 2.19.1
From `schemas/dag.schema.json` (`actionName`) and the docs. Dagu has **no Slack executor** (notify with `http.request` or `mail.send`) and its native secret providers are `env`, `file`, Vault, Kubernetes, AWS, GCP, Azure, Alibaba plus a workspace secret registry.
| Family (name for `DAGU_ALLOWED_EXECUTORS`) | Dagu actions / how a step is written | Default |
|---|---|---|
| `docker` (alias `container`) | `docker.run`/`container.run`; a DAG- or step-level `container:` (then `run:` steps run inside it). Literal image that passes the image policy; no volumes/network/exec | allowed |
| `http` | `http.request` (https, public host or one operator `${SECRET}`; no `files`, `output`, `debug`, `skip_tls_verify`, `form`) | allowed |
| `jq` | `jq.filter` (user params only through `args`/`data`, never in the filter or `input`) | allowed |
| `mail` | `mail.send` (to/from/subject/message only; recipients may not come from a user parameter; no attachments) | allowed |
| `command` (alias `shell`, `exec`) | `run:` / `command:` / `script:` / `exec:` on the Dagu host | **off** |
| `ssh`, `sftp` | `ssh.run`, `sftp.upload/download` | off |
| `file`, `archive`, `artifact`, `xlsx`, `git` | local file/archive/artifact/spreadsheet/git actions on the Dagu host | off |
| `s3`, `postgres`, `sqlite`, `redis` | object storage and database actions | off |
| `kubernetes` (`k8s`) | `kubernetes.run` | off |
| `js`, `template`, `data`, `outputs`, `state`, `wait`, `log`, `noop`, `decision`, `router` | in-engine helpers | off (list them if wanted; they are comparatively harmless) |
| `dag` | `dag.run`, `dag.enqueue`, `parallel`, `call` (other DAG files) | off; blocked anyway: no `call`/`parallel` keys |
| `harness`, `chat`, `browser`, `computer`, `human` | AI/agent/browser/manual-approval actions | off (and the keys/`type: agent` are blocked) |
| `remote` | GitHub/`source:`/custom actions (code fetched at run time) | off |

Review hardening (second security review): a url's host is literal and pinned, after it only `/`, `?` or `#` may follow and a parameter may appear only after that (so `https://good.example.org${p}` with `p=@evil.net` is refused), `..` segments and any variable other than a declared parameter inside a url are refused, and the template with parameters replaced must still be a valid public https url; every `${NAME}` / `$NAME` outside shell text must name something declared in `params`, `env`, `consts`, `secrets` or a step `output:` (or `context.*`, `steps.<id>.outputs.*`, `<step>.stdout|stderr|output*`, `DAG_RUN_WORK_DIR`, `DAG_RUN_ARTIFACTS_DIR`, the only special variables verified to exist), so the Dagu server's own environment cannot be read; jq programs cannot use `$ENV`/`env`; depth is capped (YAML block nesting 20, 20000 nodes, indentation 120) and exceeding any limit is an error, never a partly scanned file; `labels`/`tags` must be a list or map of ASCII `[a-z0-9._-]` labels (checked after NFKC and lower-casing) and nothing may start with `vectis.`; the definition may not contain NEL, LS, PS, BOM, bidi, zero-width, soft-hyphen or C1/C0 control characters; **Dagu receives a document re-serialised from the parsed, linted object, not the original bytes** (verified accepted by Dagu 2.19.1, and the round trip is checked before sending); image references must match the Docker reference grammar (no `..`); a parameter may not be the first word of a shell command or an http header name; `output:` names pass the env-name deny list; `shell:`/`shell_args:` only on a `command` step, only `sh`/`bash` (`/bin/sh`, `/bin/bash`) and `-e -u -eu -x`.

The lint is deny-by-default: only the top-level keys `name, description, type (graph|chain), labels, tags, params, env, consts, secrets, steps, timeout_sec, max_active_steps, container, group` and a short list of step keys pass; `schedule`, `webhook`, `preconditions`, `handler_on`, `working_dir`, `stdout`/`stderr`/`stdin`, `dotenv`, `step_types`, `actions`, `tools`, `ssh`, `smtp`, `s3`, `redis`, `kubernetes`, `harness(es)`, `queue`, `worker_selector`, `call`, `parallel`, `approval` are refused. Command substitution (backticks, `$( )`) is refused everywhere except inside a shell step's command; env names like `PATH`, `LD_*`, `PYTHON*`, `DAGU_*` cannot be set; `secrets:` allows only the `env` provider (no `file`, vault tokens or `options`); literal credentials (shared patterns, plus any field named like `token/password/secret/api_key/authorization` that is not a `${reference}`) are refused; `params:` may not use an external `schema` (Dagu would read a file or fetch a url) or `eval` (runs a command); a step may not carry both `with` and `config`; legacy `type: docker` steps get the same image check as `docker.run`; YAML anchors, merge keys and multiple documents are refused.

## Status mapping (Dagu -> neutral; the raw word stays in `backend_state`)
| Dagu run `status` | neutral | Dagu node `status` | neutral step state |
|---|---|---|---|
| 0 not_started, 5 queued | queued | 0 not_started | queued |
| 1 running | running | 1 running, 9 retrying | running |
| 2 failed | failed | 2 failed | failed |
| 3 aborted | cancelled | 3 aborted, 5 skipped | cancelled ("did not run to completion for a reason that is not its own failure", e.g. upstream failed) |
| 4 succeeded | succeeded | 4 success | succeeded |
| 6 partially_succeeded, 8 rejected | failed (not everything succeeded) | 6, 8 | failed |
| 7 waiting (manual action) | running | 7 | running |
| anything else / non-integer | unknown | anything else | unknown |

Steps come from `nodes` (name, `depends` -> neutral `depends_on`, executor type or docker image as `image`, argv of a command step, per-step error text, exit code parsed from `exit status N`, times; Dagu reports `""` for times that have not happened and those become null). Step logs are bounded: by default the stdout/stderr of FAILED, running and retrying steps only (at most 8 steps, `head=2000` lines, 2MB response cap, sanitised, 64KB cap, `truncated` set); other started steps have `logs_loaded: false` and the UI offers "Load logs", which calls `GET /api/jobs/runs/{id}?detail=full&step=<name>` (up to 8 `step` values, strict names) to fetch exactly those. One `get` has a single 20s deadline covering the run read and every log fetch. Run params are parsed from Dagu's `params` text and shown. The run id is `<dag name>.<dagu run id>` (both strict `[A-Za-z0-9_-]`); `latest` (Dagu's alias for the newest run) is never accepted.

## Ownership (why the portal does it)
Dagu runs everything as ONE identity (the service API key), and its own users/roles are not the portal's users. Without more, any portal user who could list runs would see everyone's. So:
- Every run is created with the label **`vectis.owner=<HMAC-SHA256 of the verified user under JOBS_OWNER_HMAC_KEY>`** (an e-mail cannot be a Dagu label value, a lossy "safe name" could collide between two users, and an UNKEYED hash could be computed by anyone who can create a run in Dagu to plant one in a victim's list; the HMAC cannot be computed without the portal's key) and `vectis.submitted_by=<lossy lower-case display form>`. Only the runner sets them, from `ctx.user`. A client can send only a catalog job id and params; a catalog file cannot declare `vectis.*` labels (lint) and the runner builds labels from an allowlist (`vectis.job`, `vectis.catalog_sha`, `vectis.catalog_repo`) then adds the two it owns.
- **list** asks Dagu to filter by the caller's label and then re-checks every run it gets back (it works even if Dagu ignores the filter). **get/cancel** read the run first and answer **404** unless it carries exactly one owner label equal to the caller's; "not yours" and "does not exist" are indistinguishable. Runs without the label (created by anyone else) are invisible. The answer must also be for the run that was asked about (name and id match), and crafted ids (`latest`, `..`, extra segments, other case) are refused before any call.
- Dagu's own UI/API users are outside this model: they can see everything and can create runs with any label. **The primary control is that Dagu is unreachable by end users (NetworkPolicy / private service, no ingress) and its credential exists only in the portal's Secret**; the HMAC is defence in depth.
- The identity is the user's e-mail, else username. The display NAME is never used with the Dagu runner (`identityOrder`); a user with neither gets 401.
- The user's bearer is never forwarded to Dagu and Dagu's credential never leaves `daguRunner.ts`.

## Submit is idempotent and creates nothing durable
`POST /dag-runs` with an inline spec and a portal-chosen `dagRunId` (128 random bits). Verified on 2.19.1: a repeated id is refused with 409, so a retry cannot start a second run; if the answer to the POST is lost the runner looks the run up by that id and, if it exists and is the caller's, reports success. No DAG file is created on the server (the create-DAG / enqueue / retry / edit / delete endpoints are never called), so there is nothing for other Dagu users to start or edit later.

## Injection rule for workflow parameters
Dagu substitutes `${params.x}` into a step's command text before a shell parses it, so a value is code unless it is inert. Every value passes the declared type check and then (`dagu/params.ts`): **string** = `[A-Za-z0-9._:/@+=,%-]` only, no leading `-` (unless `allow_leading_dash`), whatever the declared pattern allows; **s3_url / http_url** = normal URL validation plus a shell-inert charset (no quote, backtick, `$`, `;`, `|`, `&`, `<`, `>`, `( ) { } [ ]`, `\`, `!`, `*`, whitespace or control character; percent-encode `&` as `%26`); **integer / number / boolean** are re-serialised from the parsed value; **enum** values must be listed by the author and the listed values themselves must be inert (checked at catalog load). The runner re-checks every value against the url charset without knowing its type, and the lint keeps parameters out of the places where they would not be data (image, mail recipient, file path, jq program, url host, env names).

## Contract test (real Dagu)
```
DAGU_CONTRACT_URL=http://127.0.0.1:8080 DAGU_TOKEN=<api key> npm run test:dagu     # or DAGU_BASIC_USER + DAGU_BASIC_PASSWORD
```
`dagu/contract.test.ts` is skipped unless `DAGU_CONTRACT_URL` and credentials are set. It targets ANY Dagu server you point it at, but it starts and cancels real runs and executes shell steps, so it throws unless the host is `127.0.0.1`/`localhost`, or `DAGU_CONTRACT_ALLOW_REMOTE=1` is also set (use a disposable server only). The server must allow the `command`, `http` and `jq` executors. It drives the real adapter (`createDaguRunner`), the real catalog loader and compiler, and inline definitions from `testing/definitions.ts`; it generates its own `JOBS_OWNER_HMAC_KEY`. If it fails after a Dagu upgrade, fix the adapter.

## Threat model additions (Dagu)
- A workflow is code that runs on the Dagu host. First barrier: catalog review. Second: the lint at load and again at submit (executor allowlist, deny-by-default keys, image policy, url rules, no credentials, no substitution). Third: the Dagu pod/worker's isolation and the service role. None of them alone is a boundary; the lint is a screen.
- A user can influence only parameter values, and only inert ones.
- Untrusted Dagu answers: every field is type-checked, strings sanitised and capped (64 nodes, 64 labels, 64KB logs, 20MB response, 25s timeout), no redirects, Dagu's error text is never echoed (statuses map to fixed messages; absolute server paths are redacted from step errors), a 401/403 from Dagu is shown as 502 (it is the portal's credential, not the user's session).
- No raw run-creation route exists in the portal; the destructive Dagu endpoints are not called.

## Not verified (Dagu)
- Only Dagu 2.19.1 on arm64 Linux in Docker, with `command`, `http`, `jq` executors actually run. `docker`, `mail`, `ssh` and the other executors were not run (the docker executor needs a container runtime in the Dagu pod; the lint rules for them are unit-tested only). `mail.send` and the `file`/`vault`/Kubernetes secret providers were not exercised.
- Distributed workers (coordinator/worker mode), queues, sub-DAGs, retries and `max_active_runs` were not exercised; the runner always starts runs directly.
- The webhook secret was verified with the `env` provider against a local HTTP stand-in; the real placeholder hosts (`intel.example.org`) are not reachable.
- OIDC/proxy auth, workspaces, and the Dagu base config were not used.
- Dagu label values are lower-cased and limited to `[a-z0-9_./-]`; if a future Dagu changes that, the owner hash (lower-case hex) still works but the display form may change.
- How a Helm chart for Dagu should be written (storage class, resources, NetworkPolicy) is outside this repo.
- The default Playwright and unit tests use a fixture/fake. The full path page -> `/api/jobs/*` -> `DaguRunner` -> real Dagu was exercised once by a since-removed local launcher with a fixed dev identity; the Gen3 login + Arborist gate (`authorizeJobs`) was never exercised against a real login.

## Development
`/dev/jobs` renders the Jobs page against synthetic fixtures (`api/fixtureApi.ts`, inline definitions in `api/fixtureDefs.ts`), with no login. It is loaded through a guarded `require` so a production build drops it and `getServerSideProps` returns 404 there. There is no local-directory catalog and no local runner launcher: to see real runs, point a portal at a real catalog repository and a real TES or Dagu server.

`lib/jobs/handlers.ts` holds the handler logic. Each handler takes an optional `deps: JobsDeps` (authorize, getRunner, runnerId, catalogSource, writeAllowed) that defaults to the real ones; the Next routes in `pages/api/jobs/*` never pass it. It is a test seam (`handlers.deps.test.ts`), the same pattern as `authorize()` in `lib/siem/bff.ts`; there is no auth bypass, flag or env switch in the routes.

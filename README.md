# ReproSafe

Local, verified synthetic reproducers for private Python data-processing bugs.

Start with **START-HERE.md** for the click-by-click walkthrough. On Windows, double-click **Start-ReproSafe.cmd**. Use **Stop-ReproSafe.cmd** to clear the session and stop the local server, or **Restart-ReproSafe.cmd** to replace the current process while retaining its port where possible. A restart clears memory-only keys and cases.

## Stack

React + TypeScript, Vite, plain CSS, Lucide icons, Express, the official Wasmer Node SDK, Google's documented Gemini REST API, and the official Anthropic SDK. CSV parsing uses csv-parse; patches use diff; exports use fflate. Node 24+ is required. Versions are pinned in package-lock.json.

Gemini is the default provider. Open Settings, choose Google Gemini API, enter a Google AI Studio / Generative Language API key, load models, choose one, and save. Anthropic remains an independent optional connection. Keys stay in server memory by default. Optional environment settings are `AI_PROVIDER`, `GEMINI_API_KEY` (or `GOOGLE_API_KEY`), `GEMINI_MODEL`, `ANTHROPIC_API_KEY`, and `ANTHROPIC_MODEL`.

## Run

```powershell
npm ci
npm run build
npm run check:runtime
npm start
```

Default address: http://127.0.0.1:4317. The server tries another local port if occupied. Use `npm run dev` while editing. Rebuild and restart after changing production code.

## Flow

1. A strict input schema accepts one Python module and a small JSON fixture.
2. A separate worker creates a fresh Wasmer sandbox with disabled guest networking, no inherited model key, and only three virtual input files.
3. Trusted host-side acceptance checks classify structured output. Python exception messages and stdout are discarded, not forwarded.
4. Two deterministic candidate strategies replace values. Each is really executed. A candidate must preserve the named failure and pass the bounded release scan.
5. The server constructs a separate provider-native model payload. Human mode binds approval to preview identity, SHA-256, provider, model, and destination. Automatic mode requires explicit consent for that run before sending the verified replacement and source. Gemini uses header-based key authentication, bounded JSON output, no redirects, and no automatic retries. Changing provider, model, or key invalidates earlier previews.
6. Auto may validate a generated patch in isolated Wasmer sandboxes. Validation checks the original fixture, synthetic fixture, and two independent regression cases. No patch executes on the host. Applying saves a new local fixed.py only after four passes and a release scan; it never overwrites the original, modifies GitHub, or writes to Supabase.
7. ZIP export contains only synthetic input, reviewed source, a standalone verifier, and bounded metadata. A patch is included only after four passes and a release scan.

The model does not generate the synthetic records in this version. The sample-fix route is clearly labeled and does not pretend to be AI.

## Connected Sources And Auto

See [CONNECTED-SOURCES.md](CONNECTED-SOURCES.md) for the new workflow and [demo/retail/README.md](demo/retail/README.md) for GitHub/Supabase setup with a licensed public transaction excerpt.

GitHub uses a fine-grained read-only token (optional for public repositories). Supabase uses a publishable/anon key and an optional authenticated user JWT. Secret/service-role keys are rejected. Credentials remain in host memory, never browser storage or guest inputs. This prototype does not implement provider OAuth account linking. Connections and case bindings last only for the current server/page session.

Auto can refresh selected connected inputs, then reproduce, replace, prepare an optional model request, validate and save a new local fix. Human review is the default. It pauses before model transmission and local application. Automatic mode requires explicit scope consent and makes at most one model request, with no automatic retry. Prepare-only and exact-source bundled-demo modes need no model. Applying is not a git commit, PR, deployment, or database update.

## Files

| Location | Responsibility |
| --- | --- |
| src/App.tsx | Workspace, editors, candidate results, review dialog, patch diff, settings |
| src/styles.css + src/workflow.css | Responsive, restrained light interface |
| server/index.ts | Loopback API, sessions, provider settings, review approval, cancellation |
| server/connectors.ts + src/Sources.tsx | Bounded read-only provider calls and file/table pickers |
| server/workflow.ts | Shared manual/Auto stages, approval checkpoints, verified local application |
| server/model-provider.ts | Official provider endpoints, paginated model discovery, bound request previews, response parsing |
| server/runner.ts | Disposable worker supervision and deadlines |
| server/sandbox-worker.mjs | Real Wasmer execution and bounded guest results |
| server/runtime-package.ts | SHA-256-verified cached Python loading without registry refreshes |
| server/network-errors.ts | Safe diagnostics without credential or raw error-message disclosure |
| server/contracts.ts | Input schemas and host-side acceptance oracles |
| server/candidates.ts | Replacement strategies, release scan, exact outgoing payload |
| server/export.ts | Synthetic reproducer ZIP and verifier |
| shared/examples.ts | Two explicitly synthetic demonstrations and sample fixes |
| tests/ | Unit and live local integration checks |

## Verification

```powershell
npm test
npm run build
npm run check:runtime
```

With Python already downloaded, `node scripts/check-runtime-offline.ts` verifies execution with all host fetches blocked. The authenticated, local `POST /api/network/check` diagnostic tests Google and Wasmer reachability without API keys or case data. A Google 403 in that unauthenticated diagnostic indicates an HTTP response, not a validated key. `EACCES` indicates process access denial, which can differ from the browser's network permissions.

With the local server running and no other case execution active:

```powershell
npm run test:integration
node scripts/verify-export.ts
```

Set `REPROSAFE_TEST_URL` if the server selected another port. Integration tests generate only sample fixtures. Test artifacts are written to `test-results`, excluded from source control and distribution. The second command really executes exported verifier files inside Wasmer.

Live Gemini and Claude generation require the user's key, account access, and explicit approval. Provider unit tests use simulated Google HTTP responses to exercise pagination, filters, exact approved bodies, cancellation, refusals, truncation, and sanitized errors without spending quota. Catalog listing does not prove generation quota or structured-output compatibility. Browser visual/interaction QA is not part of the automated test suite.

## Security Scope

This is a polished local hackathon prototype, not an audited production security boundary. Supported contracts are invoice customer isolation and quoted CSV import. A matching failure category is not proof of an identical causal trace. Field replacements preserve some structure; they are not differential privacy or guaranteed anonymization.

Exact-value scanning covers original strings of at least four characters and several credential patterns, including GitHub and Supabase tokens. Source can contain other private information: use human review for confidential code. Automatic mode does not strengthen the scan or guarantee privacy. Names shorter than four characters, numeric values, encodings, and semantic inference are not comprehensively screened. The complete request body is available before release; API authentication and normal transport headers are separate.

The app deliberately has no host filesystem mount, browser storage of case data, telemetry, remote fonts, cloud deployment, or direct repo mutation. Public runtime packages are cached under `.wasmer`. Input remains in process/guest memory; no secure-erasure or protection against OS paging is claimed. The 384 MB worker JavaScript heap setting is not a hard WebAssembly/OS memory ceiling. Do not expose this app publicly or accept arbitrary hostile workloads on a sensitive machine.

An optional browser WebMCP status tool exposes only run status and check outcomes, never source, input, credentials, or release authority. Ordinary application use does not depend on WebMCP support.

## Development Next Steps

Add a new contract by implementing strict schemas, an independent acceptance oracle, relationship-preserving candidate generators, regression cases, and export verification. Do not make a generic anonymization claim by merely adding a model prompt. A hosted team product additionally requires authentication, isolation, resource quotas, retention controls, and independent security review.

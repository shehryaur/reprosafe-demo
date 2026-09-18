# ReproSafe

ReproSafe is a local prototype for turning private Python data-processing bugs into verified synthetic reproducers. It helps a user isolate a failure, replace sensitive values with tested synthetic data, optionally prepare an AI-assisted patch, and export a minimal repro package without sending raw private inputs by default.

Start with `START-HERE.md` for the walkthrough. On Windows, use `Start-ReproSafe.cmd`, `Stop-ReproSafe.cmd`, or `Restart-ReproSafe.cmd`.

## What It Does

1. Accepts one Python module and a small JSON fixture through a strict schema.
2. Runs the case inside an isolated Wasmer worker with no inherited model key and no guest networking.
3. Classifies the failure with trusted host-side checks.
4. Generates deterministic synthetic replacement candidates and actually executes each one.
5. Builds a provider-native AI request only after review, binding approval to provider, model, payload identity, and destination.
6. Optionally validates generated patches in fresh sandboxes against original, synthetic, and regression cases.
7. Exports a ZIP containing only reviewed synthetic input, source, verifier code, and bounded metadata.

## Stack

| Layer | Choice |
| --- | --- |
| Frontend | React, TypeScript, Vite, plain CSS |
| Server | Express on loopback |
| Sandbox | Wasmer Node SDK |
| AI providers | Google Gemini REST API, Anthropic SDK |
| Data parsing | csv-parse |
| Patch handling | diff |
| Export | fflate |
| Runtime | Node 24+ |

Versions are pinned in `package-lock.json`.

## Run

```powershell
npm ci
npm run build
npm run check:runtime
npm start
```

Default address:

```text
http://127.0.0.1:4317
```

The server chooses another local port if needed. Use `npm run dev` while editing.

## Provider Setup

Gemini is the default provider. Open Settings, choose Google Gemini API, enter a Google AI Studio / Generative Language API key, load models, choose one, and save.

Optional environment settings:

```text
AI_PROVIDER=gemini
GEMINI_API_KEY=your_key
GOOGLE_API_KEY=your_key
GEMINI_MODEL=your_model
ANTHROPIC_API_KEY=your_key
ANTHROPIC_MODEL=your_model
```

Keys stay in server memory by default. Changing provider, model, or key invalidates earlier previews.

## Connected Sources

See `CONNECTED-SOURCES.md` and `demo/retail/README.md` for the GitHub/Supabase workflow.

- GitHub uses an optional fine-grained read-only token.
- Supabase uses a publishable/anon key and optional authenticated user JWT.
- Secret/service-role keys are rejected.
- Credentials remain in host memory.
- This prototype does not implement provider OAuth account linking.

## Key Files

| Location | Responsibility |
| --- | --- |
| `src/App.tsx` | Workspace, editors, results, settings, review UI |
| `server/index.ts` | Loopback API, sessions, provider settings, approval flow |
| `server/connectors.ts` | Bounded read-only provider calls |
| `server/workflow.ts` | Manual and Auto workflow stages |
| `server/model-provider.ts` | Provider endpoints, model discovery, request previews |
| `server/runner.ts` | Worker supervision and deadlines |
| `server/sandbox-worker.mjs` | Wasmer execution and bounded guest results |
| `server/contracts.ts` | Schemas and acceptance checks |
| `server/candidates.ts` | Synthetic replacement strategies and release scan |
| `server/export.ts` | Reproducer ZIP and verifier |
| `tests/` | Unit and integration checks |

## Verification

```powershell
npm test
npm run build
npm run check:runtime
```

With the local server running:

```powershell
npm run test:integration
node scripts/verify-export.ts
```

Set `REPROSAFE_TEST_URL` if the server selected another port.

## Security Scope

ReproSafe is a local hackathon prototype, not an audited production security boundary. It reduces accidental data release through strict schemas, sandboxed execution, candidate verification, and review gates, but it does not provide differential privacy or a comprehensive anonymization guarantee.

Use human review for confidential code and sensitive data. Do not expose the app publicly or run arbitrary hostile workloads on a sensitive machine.

## Next Steps

To add a new contract, implement:

- strict input schemas
- an independent acceptance oracle
- relationship-preserving candidate generators
- regression cases
- export verification

Avoid generic anonymization claims unless the contract has been independently verified.

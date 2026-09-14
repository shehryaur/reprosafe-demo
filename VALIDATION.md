# Validation Record

Verified locally on September 13, 2026, using Node 24.15.0, Wasmer SDK 0.13.0, and Python package 3.13.18 on Windows.

## Passed

- Production TypeScript check and Vite build.
- Production page and built assets respond successfully, content security policy is present, and the live runtime check reports ready.
- Windows launcher start, stop, and restart complete successfully.
- Twenty-eight unit tests for strict schemas, acceptance oracles, replacement policies, field scanning, provider-bound payload hashing, export restrictions, Gemini request/response handling, network error classification, corrupt-cache rejection, bounded connector reads, token rejection, Auto consent and validated application. Gemini HTTP responses are simulated; no API quota is spent.
- Cached, SHA-256-verified Python executes inside Wasmer with zero host fetch calls while host fetch is deliberately blocked and guest networking is disabled.
- After restarting the server with granted network access, its unauthenticated probes receive HTTP responses from Google and Wasmer. This tests reachability, not the user's API key.
- Sixteen live integration checks against the loopback API and real Wasmer workers.
- Both original examples reproduce their named failures.
- Ordinary masking loses the original failure; relationship-preserving replacement retains it in both demonstrations.
- Both corrected modules pass the original fixture, synthetic fixture, and two regression cases.
- An empty-output patch fails all four invoice acceptance checks.
- Both ZIPs exclude the tested original string markers and contain runnable verifier files.
- Four independent executions of those ZIP contents: each original fails and each fixed module passes inside Wasmer.
- A populated sentinel API key and real host-only file remain unavailable to the guest in the tested probe.
- Guest connection to the host listener is blocked in the tested probe.
- Infinite-loop timeout, worker cancellation, and suppression of guest stdout/exception messages.
- Missing session tokens and foreign origins are rejected by the local API.
- Live public GitHub directory listing in the browser and a public Python-file read through the new backend. Private credentialed GitHub access was not tested.
- Six connected-workflow integration checks with the 60-row public retail fixture: Auto approval, real execution, four patch tests, hash-bound local application, automatic mode, and invalidation after patch editing.
- A 10-record bundled-fix Auto run completed in 61,752 ms on this machine. This is one observation, not a performance guarantee.
- Mocked-model Auto integration runs real Wasmer tests: no model call before human approval, rejection of changed model, exact reviewed payload, four passes, and a pause before local application. No actual Google call.
- Seven browser checks with Playwright: live GitHub picker, Supabase privileged-token rejection, Auto consent, real public-data Auto execution, human local application, and no horizontal page/dialog overflow at 390px and 768px. Desktop screenshots at 1440px were inspected as well. Browser page-error collection was empty.
- Actual Presidio Anonymizer 2.2.364 baseline versus ReproSafe structural replacement on six targeted ten-record batches of one CSV bug family: 0/6 versus 6/6 retained the named failure. Raw timing/worker resource measurements and limitations are in benchmark-results/results.json and COMPARISON.md.
- Dependency audit returned zero reported vulnerabilities at the time of the check. This is not an external security audit or a guarantee of vulnerability-free dependencies.

## Not Verified or Not Claimed

- No live Gemini or Claude generation was requested by these tests. It requires the user's API credentials, model access, and explicit payload approval. Actual account-specific model access remains unverified until a key is provided in Settings.
- Full keyboard-only accessibility testing was not performed. The visual/mobile checks above are not a complete accessibility audit.
- Live access to a user's private GitHub repository or Supabase project was not tested because no connector credentials were supplied. Supabase transport/schema/field mapping, row caps, RLS-empty responses and privileged-key rejection use mocked HTTP and local API checks, not a claim of live project validation.
- AWS Comprehend was not called. The $0.0180 figure for 60 separate records is a published-rate estimate before free tier, not measured cost. AWS latency, memory, CPU and detection accuracy were not measured. Presidio custom operators and full NLP detection are outside the baseline.
- Optional WebMCP registration was not verified in a supporting browser.
- No universal anonymization, causal-equivalence proof, arbitrary-repository support, or compliance certification.
- No defense guarantee against every malicious program or resource-exhaustion strategy. The worker JavaScript heap cap is not an OS-wide/WebAssembly memory quota.
- No hosted multi-user access, cloud deployment, or Tenki integration.

Run `npm test`, `npm run test:integration`, `node tests/connected-integration.ts`, `node tests/model-auto-integration.ts`, and `node scripts/verify-export.ts` to repeat the corresponding tests. Live tests require the app running at the configured local test URL. Test artifacts use bundled synthetic examples or the attributed public UCI excerpt. Browser/runtime caches, local credentials, applied test files and screenshots are excluded from distribution.

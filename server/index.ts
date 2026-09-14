import express from 'express';
import { createServer as createViteServer } from 'vite';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z, ZodError } from 'zod';
import { inputSchema, validateRecords } from './contracts.ts';
import { releaseErrors, makePreview } from './candidates.ts';
import { runPython, CancelledError } from './runner.ts';
import { exportBundle } from './export.ts';
import type { AppStatus, CaseView, Provider, ConnectionStatus } from '../shared/types.ts';
import { listModels, requestModelPatch, providerLabel, normalizeModel, assertPreviewCurrent } from './model-provider.ts';
import { connectionFailure, diagnosticCode } from './network-errors.ts';
import { Connectors } from './connectors.ts';
import { reproduceCase, generateCase, validateCase, startAuto, autoModelPatch, finishAuto, stopAuto, applyLocal, hashSource } from './workflow.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));
const app = express();
app.disable('x-powered-by');
const token = randomBytes(32).toString('hex');
let provider: Provider = process.env.AI_PROVIDER === 'anthropic' ? 'anthropic' : 'gemini';
const connections: Record<Provider, { key: string; model: string }> = {
  gemini: { key: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '', model: normalizeModel(process.env.GEMINI_MODEL || '') },
  anthropic: { key: process.env.ANTHROPIC_API_KEY || '', model: process.env.ANTHROPIC_MODEL || '' },
};
const runtime: AppStatus['runtime'] = { state: 'idle', message: 'Runtime not checked yet', version: 'Wasmer SDK 0.13.0 / Python package 3.13.18' };
const cases = new Map<string, CaseView & { touched: number }>();
const connectors = new Connectors();
let active: { id: string; controller: AbortController } | undefined;
let port = Number(process.env.PORT || 4317);
let shutdown = () => {};
function secureEqual(a: string, b: string) { const left = Buffer.from(a), right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); }
function fail(message: string, status = 400): never { throw Object.assign(new Error(message), { status }); }
app.use((req, res, next) => {
  if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(req.headers.host ?? '')) return res.status(403).json({ error: 'Only the local ReproSafe address is accepted.' });
  const origin = req.headers.origin;
  if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) return res.status(403).json({ error: 'Cross-origin access is not allowed.' });
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Cache-Control', 'no-store');
  if (process.argv.includes('--production')) res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  if (req.path.startsWith('/api/') && req.method !== 'GET') {
    if (!secureEqual(String(req.headers['x-reprosafe-token'] ?? ''), token)) return res.status(403).json({ error: 'Reopen ReproSafe to refresh this session.' });
    if (!req.is('application/json')) return res.status(415).json({ error: 'JSON requests are required.' });
  }
  next();
});
app.use(express.json({ limit: '512kb' }));
function connectionStatus(selected: Provider): ConnectionStatus { const { key, model } = connections[selected]; return { configured: Boolean(key && model), keyPresent: Boolean(key), name: model }; }
const status = (): AppStatus => ({ token, runtime, model: { provider, ...connectionStatus(provider) }, providers: { gemini: connectionStatus('gemini'), anthropic: connectionStatus('anthropic') } });
const publicCase = (session: CaseView): CaseView => { const { id, title, kind, source, records, original, attempts, candidate, preview, releaseErrors: errors, patch, patchOrigin, validation, events, busy, operation, generationComplete, automation, applied } = session; return { id, title, kind, source, records, original, attempts, candidate, preview, releaseErrors: errors, patch, patchOrigin, validation, events, busy, operation, generationComplete, automation, applied }; };
function getCase(id: string): CaseView { const session = cases.get(id); if (!session) fail('This case has expired. Reproduce the input again.', 404); session.touched = Date.now(); return session; }
function event(session: CaseView, label: string, detail?: string) { session.events.push({ time: new Date().toISOString(), label, detail }); if (session.events.length > 60) session.events.shift(); }
async function operation(session: CaseView, name: string, fn: (signal: AbortSignal) => Promise<void>) {
  if (active) fail('Another execution is running. Wait or cancel it first.', 409);
  const controller = new AbortController(); active = { id: session.id, controller }; session.busy = true; session.operation = name;
  try { await fn(controller.signal); }
  catch (error) { event(session, error instanceof CancelledError ? 'Run cancelled' : 'Run failed'); throw error; }
  finally { session.busy = false; session.operation = undefined; active = undefined; }
}
app.get('/api/status', (_req, res) => res.json(status()));
app.get('/api/connectors', (_req, res) => res.json(connectors.status()));
app.post('/api/connectors/github/connect', async (req, res) => { if (active) fail('Wait for the active run.', 409); res.json(await connectors.connectGitHub(req.body)); });
app.post('/api/connectors/supabase/connect', async (req, res) => { if (active) fail('Wait for the active run.', 409); res.json(await connectors.connectSupabase(req.body)); });
app.post('/api/connectors/disconnect', (req, res) => { const { service } = z.object({ service: z.enum(['github','supabase']) }).strict().parse(req.body); connectors.disconnect(service); res.json(connectors.status()); });
app.get('/api/connectors/github/repos', async (_req, res) => res.json(await connectors.repos()));
app.post('/api/connectors/github/branches', async (req, res) => res.json(await connectors.branches(req.body)));
app.post('/api/connectors/github/files', async (req, res) => res.json(await connectors.files(req.body)));
app.get('/api/connectors/supabase/tables', async (_req, res) => res.json(await connectors.tables()));
app.post('/api/connectors/supabase/rows', async (req, res) => res.json(await connectors.rows(req.body)));
app.get('/api/demo/retail', (_req, res) => {
  const path = resolve(root, 'demo/retail/records.json');
  if (!existsSync(path)) fail('The public demo dataset has not been prepared yet.', 404);
  res.json({ title: 'UCI retail: quoted product descriptions', kind: 'csv', source: readFileSync(resolve(root, 'demo/retail/buggy.py'), 'utf8'), records: JSON.parse(readFileSync(path, 'utf8')) });
});
app.post('/api/network/check', async (_req, res) => {
  const results = [];
  for (const [service, url] of [['Gemini API', 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1'], ['Wasmer registry', 'https://registry.wasmer.io/graphql']]) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
      await response.body?.cancel();
      results.push({ service, reachable: true, httpStatus: response.status });
    } catch (error) { const code = diagnosticCode(error); results.push({ service, reachable: false, code, message: connectionFailure(service, code) }); }
  }
  res.json({ results, note: 'Unauthenticated reachability checks only. HTTP 400/401/403 from Google can be expected without a key and do not validate credentials.' });
});
app.post('/api/runtime/check', async (_req, res) => {
  if (active) fail('Wait for the current run to finish.', 409);
  const controller = new AbortController(); active = { id: 'runtime', controller }; runtime.state = 'checking'; runtime.message = 'Loading Python into Wasmer';
  try {
    const result = await runPython('def process(records):\n    return {"answer": 42}\n', [], { signal: controller.signal, bootTimeoutMs: 240_000 });
    runtime.state = result.state === 'ok' && (result.output as {answer?: number})?.answer === 42 ? 'ready' : 'error';
    runtime.message = runtime.state === 'ready' ? 'Python execution verified' : result.runtimeCode === 'RUNTIME_CACHE_INVALID' ? 'The cached Python package failed its integrity check. Restore the runtime cache before running code.' : result.runtimeCode && result.runtimeCode !== 'INITIALIZATION_ERROR' ? connectionFailure('Wasmer initialization', result.runtimeCode) : result.state === 'timeout' ? 'Wasmer initialization exceeded its time limit. A first download may take longer; run npm run check:runtime.' : `Wasmer initialization failed (${result.runtimeCode || result.errorType || result.state}). Run npm run check:runtime for diagnosis.`;
  }
  catch (error) { runtime.state = 'error'; runtime.message = error instanceof CancelledError ? 'Runtime check cancelled.' : 'The Wasmer worker could not complete its check. Run npm run check:runtime for diagnosis.'; }
  finally { active = undefined; }
  res.json(status());
});
app.post('/api/cancel', (_req, res) => { active?.controller.abort(); res.json({ cancelled: Boolean(active) }); });
app.post('/api/shutdown', (_req, res) => { res.json({ stopped: true }); shutdown(); });
app.post('/api/settings', (req, res) => {
  if (active) fail('Wait for the current run before changing connection settings.', 409);
  const input = z.object({ provider: z.enum(['gemini','anthropic']).optional(), apiKey: z.string().max(1000).optional(), model: z.string().trim().max(127).regex(/^(?:models\/)?[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$|^$/).optional(), clearKey: z.boolean().optional() }).strict().parse(req.body);
  const selected = input.provider ?? provider, connection = connections[selected];
  const nextKey = input.clearKey ? '' : input.apiKey?.trim() || connection.key;
  const nextModel = input.model === undefined ? connection.model : normalizeModel(input.model);
  if (provider !== selected || nextKey !== connection.key || nextModel !== connection.model) for (const session of cases.values()) { session.preview = undefined; if (session.automation?.state === 'awaiting-request') stopAuto(session, new Error('Connection changed')); }
  provider = selected; connection.key = nextKey; connection.model = nextModel;
  res.json(status());
});
app.get('/api/models', async (_req, res) => {
  const selected = provider, key = connections[selected].key;
  if (!key) fail(`Add a ${providerLabel(selected)} API key in Settings first.`);
  const models = await listModels(selected, key);
  res.json({ provider: selected, models, note: 'Models reported by the API. Generation access and quota are checked when a request is sent.' });
});
app.post('/api/cases', (req, res) => {
  const input = inputSchema.parse(req.body); const records = validateRecords(input.kind, input.records);
  for (const [id, old] of cases) if (!old.busy && Date.now() - old.touched > 3600_000) cases.delete(id);
  if (cases.size >= 20) { const oldest = [...cases.values()].find(s => !s.busy); if (oldest) cases.delete(oldest.id); }
  const session = { ...input, records, id: randomUUID(), attempts: [], events: [], releaseErrors: [], busy: false, generationComplete: false, touched: Date.now() } satisfies CaseView & { touched: number };
  cases.set(session.id, session); event(session, 'Case created', 'Input held in local memory'); res.status(201).json(publicCase(session));
});
app.get('/api/cases/:id', (req, res) => res.json(publicCase(getCase(req.params.id))));
app.delete('/api/cases/:id', (req, res) => { if (active?.id === req.params.id) active.controller.abort(); cases.delete(req.params.id); res.json({ deleted: true }); });
app.post('/api/cases/:id/reproduce', async (req, res) => {
  const session = getCase(req.params.id);
  if (active) fail('Wait for the active run.', 409);
  session.automation = undefined;
  await operation(session, 'Running original input', async signal => {
    await reproduceCase(session, signal);
    if (session.original?.status !== 'error') { runtime.state = 'ready'; runtime.message = 'Python execution verified'; }
  }); res.json(publicCase(session));
});
app.post('/api/cases/:id/generate', async (req, res) => {
  const session = getCase(req.params.id); if (session.original?.status !== 'fail') fail('Reproduce a contract failure before creating a synthetic case.');
  if (active) fail('Wait for the active run.', 409);
  session.automation = undefined;
  await operation(session, 'Generating synthetic candidates', async signal => {
    await generateCase(session, signal);
  }); res.json(publicCase(session));
});
app.post('/api/cases/:id/preview', (req, res) => {
  const session = getCase(req.params.id); if (session.busy) fail('Wait for execution to finish.', 409); if (!session.candidate || !session.original || session.releaseErrors.length) fail('A verified, releasable synthetic example is required.');
  session.preview = makePreview(session.kind, session.source, session.candidate.records, session.original, connections[provider].model, provider); event(session, 'Outgoing request prepared', 'No external request sent'); res.json(publicCase(session));
});
app.post('/api/cases/:id/patch', (req, res) => {
  const session = getCase(req.params.id); if (session.busy) fail('Wait for execution to finish.', 409);
  const input = z.object({ source: z.string().min(10).max(24000), origin: z.enum(['manual','sample']).default('manual') }).strict().parse(req.body); if (!session.candidate) fail('Create a verified synthetic example first.');
  session.automation = undefined; session.applied = undefined; session.patch = input.source; session.patchOrigin = input.origin; session.validation = undefined; event(session, input.origin === 'sample' ? 'Bundled sample patch loaded' : 'Manual patch saved', 'No model request'); res.json(publicCase(session));
});
app.post(['/api/cases/:id/ai-patch', '/api/cases/:id/claude-patch'], async (req, res) => {
  const session = getCase(z.string().parse(req.params.id)); const approval = z.object({ previewId: z.string(), hash: z.string(), reviewed: z.literal(true) }).strict().parse(req.body);
  const { key, model } = connections[provider];
  if (!key || !model) fail(`Configure a ${providerLabel(provider)} API key and model in Settings.`);
  if (!session.preview || approval.previewId !== session.preview.id || !secureEqual(approval.hash, session.preview.hash)) fail('The outgoing request changed. Review a fresh preview.', 409);
  assertPreviewCurrent(session.preview, provider, model);
  if (req.path.endsWith('/claude-patch') && provider !== 'anthropic') fail('Use the AI patch endpoint for Gemini requests.');
  if (!session.candidate || releaseErrors(session.source, session.records, session.candidate.records).length) fail('The release policy does not permit sending this case.');
  const approved = structuredClone(session.preview);
  await operation(session, `Requesting a patch from ${providerLabel(approved.provider)}`, async signal => {
    const source = await requestModelPatch(approved, key, signal);
    session.automation = undefined; session.applied = undefined; session.patch = source; session.patchOrigin = approved.provider === 'gemini' ? 'gemini' : 'claude'; session.validation = undefined;
    event(session, `${providerLabel(approved.provider)} patch received`, `Approved request ${approved.hash.slice(0, 12)}`);
  }); res.json(publicCase(session));
});
app.post('/api/cases/:id/validate', async (req, res) => {
  const session = getCase(req.params.id); if (!session.patch || !session.candidate) fail('Add a patch to the synthetic case first.');
  await operation(session, 'Validating patch', async signal => {
    await validateCase(session, signal);
  }); res.json(publicCase(session));
});
app.post('/api/cases/:id/auto', async (req, res) => {
  const session = getCase(req.params.id);
  const options = z.object({ mode: z.enum(['review','automatic']), patch: z.enum(['none','sample','model']), applyLocal: z.boolean(), consent: z.boolean(), expectedProvider: z.enum(['gemini','anthropic']).optional(), expectedModel: z.string().max(127).optional() }).strict().parse(req.body);
  await operation(session, 'Starting Auto', async signal => {
    await startAuto(session, options, { provider, ...connections[provider] }, root, signal);
    if (session.original?.status !== 'error') { runtime.state = 'ready'; runtime.message = 'Python execution verified'; }
  }); res.json(publicCase(session));
});
app.post('/api/cases/:id/auto/continue', async (req, res) => {
  const session = getCase(req.params.id);
  const approval = z.object({ reviewed: z.literal(true), previewId: z.string().optional(), hash: z.string() }).strict().parse(req.body);
  const stage = session.automation?.state;
  if (stage !== 'awaiting-request' && stage !== 'awaiting-apply') fail('This Auto run is not waiting for approval.', 409);
  if (stage === 'awaiting-request' && (!session.preview || session.preview.id !== approval.previewId || !secureEqual(session.preview.hash, approval.hash))) fail('The outgoing request changed. Review it again.', 409);
  if (stage === 'awaiting-apply' && (!session.patch || !secureEqual(hashSource(session.patch), approval.hash))) fail('The patch changed. Review the diff again.', 409);
  await operation(session, 'Continuing Auto', async signal => {
    try {
      if (stage === 'awaiting-request') { await autoModelPatch(session, { provider, ...connections[provider] }, signal); await finishAuto(session, root, signal); }
      else { await applyLocal(session, approval.hash, root, signal); session.automation!.state = 'complete'; session.automation!.message = 'Verified fix applied to a new local file'; }
    } catch (error) { stopAuto(session, error); throw error; }
  }); res.json(publicCase(session));
});
app.post('/api/cases/:id/apply', async (req, res) => {
  const session = getCase(req.params.id);
  const approval = z.object({ reviewed: z.literal(true), hash: z.string() }).strict().parse(req.body);
  await operation(session, 'Applying verified local fix', signal => applyLocal(session, approval.hash, root, signal)); res.json(publicCase(session));
});
app.get('/api/cases/:id/export', (req, res) => { const session = getCase(req.params.id); if (session.busy) fail('Wait for execution to finish.', 409); const zip = exportBundle(session); res.setHeader('Content-Type', 'application/zip'); res.setHeader('Content-Disposition', 'attachment; filename="reprosafe-synthetic-reproducer.zip"'); res.send(Buffer.from(zip)); event(session, 'Synthetic reproduction bundle exported'); });
app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API route.' }));
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof ZodError) return res.status(400).json({ error: 'Input does not match the supported contract. Check the field names, types, and size limits.', fields: error.issues.map(i => i.path.join('.')) });
  const err = error as Error & { status?: number; type?: string }; if (error instanceof CancelledError) return res.status(409).json({ error: 'Run cancelled.' });
  res.status(err.status && err.status >= 400 && err.status < 600 ? err.status : 500).json({ error: err.type === 'entity.parse.failed' ? 'Invalid JSON request.' : err.message || 'The operation failed.' });
});
if (process.argv.includes('--production')) { app.use(express.static(resolve(root, 'dist'), { etag: false })); app.get('/{*path}', (_req, res) => res.sendFile(resolve(root, 'dist/index.html'))); }
else { const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' }); app.use(vite.middlewares); }
const idleCleanup = setInterval(() => { for (const [id, session] of cases) if (!session.busy && Date.now() - session.touched > 3600_000) cases.delete(id); }, 60_000); idleCleanup.unref();
function listen() {
  const server = app.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}`;
    mkdirSync(resolve(root, '.local'), { recursive: true });
    writeFileSync(resolve(root, '.local/server.json'), JSON.stringify({ pid: process.pid, port, url }));
    console.log(`ReproSafe: ${url}`);
  });
  server.on('error', (error: NodeJS.ErrnoException) => { if (error.code === 'EADDRINUSE' && port < 4330) { port += 1; listen(); } else { console.error('ReproSafe could not start:', error.code); process.exitCode = 1; } });
  const stop = () => { active?.controller.abort(); connections.gemini.key = ''; connections.anthropic.key = ''; connectors.disconnect('github'); connectors.disconnect('supabase'); cases.clear(); server.close(); setTimeout(() => process.exit(0), 1200).unref(); };
  shutdown = stop; process.once('SIGTERM', stop); process.once('SIGINT', stop);
}
listen();

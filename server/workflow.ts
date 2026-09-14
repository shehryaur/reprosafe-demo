import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { examples } from '../shared/examples.ts';
import type { CaseView, Provider, AutoOptions } from '../shared/types.ts';
import { assess, regressionInputs } from './contracts.ts';
import { candidates, releaseErrors, makePreview } from './candidates.ts';
import { runPython, CancelledError } from './runner.ts';
import { requestModelPatch, assertPreviewCurrent } from './model-provider.ts';

export function fail(message: string, status = 400): never { throw Object.assign(new Error(message), { status }); }
export function event(session: CaseView, label: string, detail?: string) { session.events.push({ time: new Date().toISOString(), label, detail }); if (session.events.length > 60) session.events.shift(); }
export const hashSource = (source: string) => createHash('sha256').update(source).digest('hex');
export function clearDerived(session: CaseView) { session.attempts = []; session.candidate = undefined; session.preview = undefined; session.patch = undefined; session.patchOrigin = undefined; session.validation = undefined; session.applied = undefined; session.releaseErrors = []; session.generationComplete = false; }
export async function reproduceCase(session: CaseView, signal: AbortSignal) {
  clearDerived(session); session.operation = 'Running original input';
  session.original = assess(session.kind, session.records, await runPython(session.source, session.records, { signal }));
  event(session, 'Original execution completed', session.original.code);
}
export async function generateCase(session: CaseView, signal: AbortSignal) {
  if (session.original?.status !== 'fail') fail('Reproduce a contract failure before creating a synthetic case.');
  clearDerived(session);
  for (const candidate of candidates(session.kind, session.records)) {
    if (signal.aborted) throw new CancelledError(); session.operation = candidate.title;
    const result = assess(session.kind, candidate.records, await runPython(session.source, candidate.records, { signal }));
    const preserved = result.status === 'fail' && result.code === session.original.code;
    session.attempts.push({ title: candidate.title, strategy: candidate.strategy, result, preserved });
    event(session, candidate.title, preserved ? 'Original failure preserved' : result.code);
    if (preserved && !session.candidate) { const errors = releaseErrors(session.source, session.records, candidate.records); if (!errors.length) session.candidate = candidate; else session.releaseErrors = errors; }
  }
  session.generationComplete = true;
  if (session.candidate) { session.releaseErrors = []; event(session, 'Synthetic reproducer selected', 'Field replacement policy passed'); } else event(session, 'No releasable reproducer found');
}
export async function validateCase(session: CaseView, signal: AbortSignal) {
  if (!session.patch || !session.candidate) fail('Add a patch to the synthetic case first.');
  session.validation = []; session.applied = undefined;
  for (const test of [{ title: 'Private original input', records: session.records }, { title: 'Verified synthetic input', records: session.candidate.records }, ...regressionInputs(session.kind)]) {
    if (signal.aborted) throw new CancelledError(); session.operation = `Checking: ${test.title}`;
    session.validation.push({ title: test.title, result: assess(session.kind, test.records, await runPython(session.patch, test.records, { signal })) });
  }
  event(session, 'Patch validation completed', allChecksPass(session) ? 'All four checks passed' : 'One or more checks failed');
}
export function allChecksPass(session: CaseView) { return session.validation?.length === 4 && session.validation.every(t => t.result.status === 'pass'); }
export async function applyLocal(session: CaseView, expectedHash: string, root: string, signal?: AbortSignal) {
  if (!session.patch || hashSource(session.patch) !== expectedHash) fail('The patch changed. Review the current diff again.', 409);
  if (!allChecksPass(session) || !session.candidate) fail('All four checks must pass before applying a patch.');
  if (releaseErrors(session.patch, session.records, session.candidate.records).length) fail('The patch did not pass the release scan. Review it locally before saving.');
  if (signal?.aborted) throw new CancelledError();
  if (session.applied?.patchHash === expectedHash) return;
  const folder = resolve(root, '.local', 'applied', randomUUID());
  await mkdir(folder, { recursive: true });
  try {
    await writeFile(resolve(folder, 'fixed.py'), session.patch, { flag: 'wx' });
    await writeFile(resolve(folder, 'verification.json'), JSON.stringify({ patchHash: expectedHash, sourceHash: hashSource(session.source), checks: session.validation, scope: 'New local fixed.py only. GitHub and Supabase were not modified.' }, null, 2), { flag: 'wx' });
    if (signal?.aborted) throw new CancelledError();
  } catch (error) {
    // Only these two known files in this newly-created directory can be removed.
    await rm(resolve(folder, 'fixed.py'), { force: true }); await rm(resolve(folder, 'verification.json'), { force: true }); throw error;
  }
  session.applied = { path: resolve(folder, 'fixed.py'), patchHash: expectedHash, appliedAt: new Date().toISOString() };
  event(session, 'Validated fix applied locally', 'New fixed.py created; remote sources unchanged');
}
type ModelConnection = { provider: Provider; model: string; key: string };
export async function startAuto(session: CaseView, options: AutoOptions, connection: ModelConnection, root: string, signal: AbortSignal) {
  if (options.mode === 'automatic' && !options.consent) fail('Approve the automatic run scope before starting.');
  if (options.mode === 'automatic' && options.patch === 'model' && (options.expectedProvider !== connection.provider || options.expectedModel !== connection.model)) fail('The model connection changed. Reopen Auto and approve the current provider and model.', 409);
  if (options.patch === 'model' && (!connection.key || !connection.model)) fail('Configure an API key and model first, or choose Prepare only.');
  if (options.patch === 'sample' && !examples.some(e => e.id === session.kind && e.source === session.source)) fail('The bundled fix is only available for an exact supported demo source.');
  session.automation = { options, state: 'running', message: 'Preparing the original and replacement input' };
  event(session, 'Auto started', `${options.mode}; patch: ${options.patch}; local apply: ${options.applyLocal}`);
  try {
    await reproduceCase(session, signal);
    if (session.original?.status !== 'fail') fail('Auto stopped: this input did not reproduce a supported failure.');
    await generateCase(session, signal);
    if (!session.candidate) fail('Auto stopped: no replacement preserved the failure and passed the release scan.');
    if (options.patch === 'none') { session.automation.state = 'complete'; session.automation.message = 'Reproducer prepared. No AI request or file changes.'; return; }
    if (options.patch === 'model') {
      session.preview = makePreview(session.kind, session.source, session.candidate.records, session.original!, connection.model, connection.provider);
      if (options.mode === 'review') { session.automation.state = 'awaiting-request'; session.automation.message = 'Review the exact model request'; return; }
      await autoModelPatch(session, connection, signal);
    } else {
      session.patch = examples.find(e => e.id === session.kind && e.source === session.source)!.patch;
      session.patchOrigin = 'sample'; event(session, 'Bundled sample patch loaded', 'No AI request; not a model-generated fix');
    }
    await finishAuto(session, root, signal);
  } catch (error) { stopAuto(session, error); throw error; }
}
export function stopAuto(session: CaseView, error: unknown) { if (session.automation) { session.automation.state = 'stopped'; session.automation.message = error instanceof CancelledError ? 'Cancelled. No further actions will run.' : 'Stopped. Review the error before retrying.'; } }
export async function autoModelPatch(session: CaseView, connection: ModelConnection, signal: AbortSignal) {
  if (!session.preview || !session.candidate || releaseErrors(session.source, session.records, session.candidate.records).length) fail('A fresh releasable preview is required.');
  assertPreviewCurrent(session.preview, connection.provider, connection.model);
  if (!connection.key) fail('Reconnect the model API first.');
  if (signal.aborted) throw new CancelledError();
  session.operation = 'Requesting model patch';
  event(session, 'Auto model request authorized', `${session.automation?.options.mode}; request ${session.preview.hash.slice(0,12)}`);
  session.patch = await requestModelPatch(structuredClone(session.preview), connection.key, signal);
  session.patchOrigin = connection.provider === 'gemini' ? 'gemini' : 'claude'; session.validation = undefined; session.applied = undefined;
}
export async function finishAuto(session: CaseView, root: string, signal: AbortSignal) {
  const auto = session.automation; if (!auto) fail('This Auto run is no longer active.', 409);
  auto.state = 'running';
  await validateCase(session, signal);
  if (!allChecksPass(session)) fail('Auto stopped: the proposed fix failed validation. No fix was applied.');
  if (auto.options.applyLocal) {
    if (auto.options.mode === 'review') { auto.state = 'awaiting-apply'; auto.message = 'All checks passed. Review the diff before applying locally.'; return; }
    await applyLocal(session, hashSource(session.patch!), root, signal);
  }
  auto.state = 'complete'; auto.message = session.applied ? 'Verified fix applied to a new local file' : 'Patch validated. No files changed.';
}

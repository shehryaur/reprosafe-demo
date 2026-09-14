import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Records, Execution } from '../shared/types.ts';

const workerPath = fileURLToPath(new URL('./sandbox-worker.mjs', import.meta.url));
const responseSchema = z.object({
  state: z.enum(['ok', 'error', 'timeout']), output: z.unknown().optional(),
  errorType: z.enum(['ValueError','TypeError','KeyError','IndexError','SyntaxError','NameError','ImportError','ModuleNotFoundError','UnicodeEncodeError','PermissionError','FileNotFoundError','OSError','ZeroDivisionError','RuntimeError','ExecutionError','OutputLimit','RuntimeUnavailable']).optional(),
  runtimeCode: z.string().max(80).optional(), durationMs: z.number().min(0),
  resources: z.object({ userCpuMs: z.number().min(0), systemCpuMs: z.number().min(0), maxRssKiB: z.number().min(0) }).optional(),
});
export class CancelledError extends Error { constructor() { super('Run cancelled.'); } }

export function runPython(source: string, records: Records, options: { signal?: AbortSignal; timeoutMs?: number; bootTimeoutMs?: number } = {}): Promise<Execution> {
  const started = performance.now();
  if (options.signal?.aborted) return Promise.reject(new CancelledError());
  // The host process supplies no model key or inherited user environment to the worker.
  const workerEnv: NodeJS.ProcessEnv = {};
  for (const name of ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'NODE_EXTRA_CA_CERTS']) if (process.env[name]) workerEnv[name] = process.env[name];
  const child = fork(workerPath, [], { silent: true, execArgv: ['--max-old-space-size=384'], env: workerEnv });
  return new Promise((resolve, reject) => {
    let result: Execution | undefined;
    let failure: Error | undefined;
    const timer = setTimeout(() => {
      result = { state: 'timeout', durationMs: Math.round(performance.now() - started) };
      child.kill();
    }, options.bootTimeoutMs ?? 45_000);
    const cancel = () => { failure = new CancelledError(); child.kill(); };
    options.signal?.addEventListener('abort', cancel, { once: true });
    // SDK and guest diagnostics remain private and are not forwarded to the model or logs.
    child.stdout?.resume(); child.stderr?.resume();
    child.on('message', message => {
      const parsed = responseSchema.safeParse(message);
      if (parsed.success) result = parsed.data;
      else failure = new Error('The sandbox returned an invalid result.');
    });
    child.once('error', () => { failure = new Error('The Wasmer worker could not start.'); });
    child.once('close', () => {
      clearTimeout(timer); options.signal?.removeEventListener('abort', cancel);
      if (failure) reject(failure);
      else if (result) resolve(result);
      else reject(new Error('The Wasmer worker exited without a result. Run the runtime check in Settings.'));
    });
    child.send({ source, records, timeoutMs: options.timeoutMs ?? 5000 });
  });
}

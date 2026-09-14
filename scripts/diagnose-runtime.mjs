import { Wasmer } from '@wasmer/sdk/node';
const originalFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  const request = args[0];
  console.log('Runtime fetch', String(request?.url ?? request));
  const response = await originalFetch(...args);
  console.log('Runtime response', response.status, response.headers.get('content-length'));
  if (!response.body) return response;
  let received = 0;
  let next = 10_000_000;
  return new Response(response.body.pipeThrough(new TransformStream({ transform(chunk, controller) {
    received += chunk.length;
    if (received >= next) { console.log('Downloaded MB', Math.round(received / 1_000_000)); next += 10_000_000; }
    controller.enqueue(chunk);
  } })), { status: response.status, headers: response.headers });
};
console.log('Creating client');
const wasmer = new Wasmer({ outputBytes: 4096, parallelism: 2 });
console.log('Loading Python package');
const sandbox = await wasmer.sandboxes.create({ packages: ['python/python@=3.13.18'], network: { mode: 'disabled' }, files: { 'main.py': 'print(42)' } });
console.log('Sandbox created; running Python');
const result = await sandbox.command('python', ['/workspace/main.py']).run({ timeoutMs: 5000, outputBytes: 4096, check: false });
console.log({ exitCode: result.exitCode, reason: result.reason, stdout: result.stdout.text(), stderr: result.stderr.text() });
await sandbox.close();
await wasmer.close();

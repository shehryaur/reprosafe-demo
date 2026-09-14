import assert from 'node:assert/strict';
import { Wasmer } from '@wasmer/sdk/node';
import { pythonPackage } from '../server/runtime-package.ts';

const runtime = await pythonPackage();
assert.ok(runtime instanceof Uint8Array, 'Download the Python runtime first with npm run check:runtime.');
const originalFetch = globalThis.fetch;
let attempts = 0;
globalThis.fetch = async () => { attempts++; throw Object.assign(new Error('Network disabled for this offline test.'), { code: 'EACCES' }); };
const wasmer = new Wasmer({ outputBytes: 4096, parallelism: 2 });
let sandbox;
try {
  sandbox = await wasmer.sandboxes.create({ packages: [runtime], network: { mode: 'disabled' }, env: {}, files: { 'main.py': 'print(42)' } });
  const result = await sandbox.command('python', ['/workspace/main.py']).run({ timeoutMs: 5000, check: false });
  assert.equal(result.exitCode, 0); assert.equal(result.stdout.text().trim(), '42'); assert.equal(attempts, 0);
  console.log('PASS: hash-verified cached Python ran in Wasmer with zero host fetches and guest networking disabled.');
} finally { await sandbox?.close(); await wasmer.close(); globalThis.fetch = originalFetch; }

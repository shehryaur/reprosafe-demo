import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnosticCode, connectionFailure } from '../server/network-errors.ts';
import { listModels } from '../server/model-provider.ts';
import { verifyRuntimePackage } from '../server/runtime-package.ts';

test('nested network permission errors are identified without exposing sensitive error text', async () => {
  const error = new TypeError('PRIVATE-KEY-IN-ERROR', { cause: new AggregateError([Object.assign(new Error('PRIVATE-HOST'), { code: 'EACCES' })]) });
  assert.equal(diagnosticCode(error), 'EACCES');
  await assert.rejects(() => listModels('gemini', 'test-key', async () => { throw error; }), result => {
    assert.ok(result instanceof Error); assert.match(result.message, /denied network access/); assert.ok(!result.message.includes('PRIVATE')); return true;
  });
});
test('DNS, certificate, timeout, and permission failures have distinct explanations', () => {
  assert.match(connectionFailure('API', 'ENOTFOUND'), /resolve/);
  assert.match(connectionFailure('API', 'SELF_SIGNED_CERT_IN_CHAIN'), /certificate/);
  assert.match(connectionFailure('API', 'UND_ERR_CONNECT_TIMEOUT'), /timed out/);
  assert.match(connectionFailure('API', 'EPERM'), /denied network access/);
  assert.equal(diagnosticCode({code:'PRIVATE-UNRECOGNIZED-CODE'}), undefined);
  const cyclic: {cause?: unknown} = {}; cyclic.cause = cyclic; assert.equal(diagnosticCode(cyclic), undefined);
});
test('a corrupt cached Python package is rejected before execution', () => {
  assert.throws(() => verifyRuntimePackage(new Uint8Array([1,2,3])), { code: 'RUNTIME_CACHE_INVALID' });
});

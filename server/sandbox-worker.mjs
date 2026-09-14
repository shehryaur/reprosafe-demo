import { Wasmer } from '@wasmer/sdk/node';
import { pythonPackage } from './runtime-package.ts';
import { diagnosticCode } from './network-errors.ts';

const harness = `import json
import sys
import traceback

safe_types = {"ValueError", "TypeError", "KeyError", "IndexError", "SyntaxError", "NameError", "ImportError", "ModuleNotFoundError", "UnicodeEncodeError", "PermissionError", "FileNotFoundError", "OSError", "ZeroDivisionError", "RuntimeError"}
try:
    with open('/workspace/input.json', encoding='utf-8') as f:
        records = json.load(f)
    import main
    result = main.process(records)
    serialized = json.dumps({"state": "ok", "output": result}, ensure_ascii=True)
    if len(serialized) > 131072:
        serialized = json.dumps({"state": "error", "errorType": "OutputLimit"})
except BaseException as error:
    kind = type(error).__name__
    serialized = json.dumps({"state": "error", "errorType": kind if kind in safe_types else "ExecutionError"})
with open('/workspace/result.json', 'w', encoding='utf-8') as f:
    f.write(serialized)
`;

process.once('message', async message => {
  const started = performance.now();
  let wasmer;
  let sandbox;
  let response;
  let initialized = false;
  try {
    const runtime = await pythonPackage();
    wasmer = new Wasmer({ outputBytes: 4096, parallelism: 2 });
    sandbox = await wasmer.sandboxes.create({
      packages: [runtime], network: { mode: 'disabled' }, env: {},
      files: { 'main.py': message.source, 'input.json': JSON.stringify(message.records), 'runner.py': harness },
    });
    initialized = true;
    const output = await sandbox.command('python', ['/workspace/runner.py']).run({ timeoutMs: message.timeoutMs, outputBytes: 4096, check: false });
    if (output.reason === 'timeout') response = { state: 'timeout' };
    else if (!output.ok) response = { state: 'error', errorType: 'ExecutionError' };
    else {
      const stat = await sandbox.fs.stat('result.json');
      if (stat.size > 131072) response = { state: 'error', errorType: 'OutputLimit' };
      else response = JSON.parse(await sandbox.fs.readText('result.json'));
    }
  } catch (error) {
    response = initialized ? { state: 'error', errorType: 'ExecutionError' } : { state: 'error', errorType: 'RuntimeUnavailable', runtimeCode: diagnosticCode(error) ?? 'INITIALIZATION_ERROR' };
  } finally {
    try { await sandbox?.close(); } catch {}
    try { await wasmer?.close(); } catch {}
  }
  const usage = process.resourceUsage();
  process.send?.({ ...response, durationMs: Math.round(performance.now() - started), resources: { userCpuMs: usage.userCPUTime / 1000, systemCpuMs: usage.systemCPUTime / 1000, maxRssKiB: usage.maxRSS } }, () => process.exit(0));
});

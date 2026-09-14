import { runPython } from '../server/runner.ts';

console.log('Checking Wasmer Python. The first run downloads its runtime.');
const result = await runPython('def process(records):\n    return {"answer": 42}\n', [], { bootTimeoutMs: 600_000 });
console.log(JSON.stringify(result, null, 2));
if (result.state !== 'ok' || (result.output as { answer?: number })?.answer !== 42) process.exitCode = 1;

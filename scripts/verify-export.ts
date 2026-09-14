import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { runPython } from '../server/runner.ts';

for (const kind of ['invoices','csv']) {
  const files=unzipSync(readFileSync(`test-results/${kind}-reproducer.zip`));
  const bundle=JSON.stringify(Object.fromEntries(['main.py','fixed.py','verify.py','input.json'].map(name=>[name,strFromU8(files[name])])));
  for (const variant of ['main','fixed']) {
    const source=`def process(records):
    import json
    import sys
    files = json.loads(${JSON.stringify(bundle)})
    for name, text in files.items():
        with open(name, 'w', encoding='utf-8') as f:
            f.write(text)
    sys.modules.pop('main', None)
    sys.argv = ['verify.py', ${JSON.stringify(variant)}]
    exec(compile(files['verify.py'], 'verify.py', 'exec'), {'__name__': '__main__'})
    return {'verified': True}
`;
    const result=await runPython(source,[]);
    assert.equal(result.state,variant==='fixed'?'ok':'error',JSON.stringify(result));
    console.log(`PASS standalone ${kind} bundle: ${variant} ${result.state}`);
  }
}
const marker='HOST-ONLY-TEST-SECRET';
const previous=process.env.ANTHROPIC_API_KEY;
const probe=resolve('.local/sandbox-test-only.txt');
writeFileSync(probe,marker); process.env.ANTHROPIC_API_KEY=marker;
try {
  const result=await runPython(`def process(records):
    import os
    return {'key': os.environ.get('ANTHROPIC_API_KEY'), 'host_file': os.path.exists(${JSON.stringify(probe.replaceAll('\\','/'))})}
`,[]);
  assert.equal(result.state,'ok'); assert.deepEqual(result.output,{key:null,host_file:false});
  console.log('PASS populated host credential and real host file are absent in guest');
} finally {
  if (previous===undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY=previous;
  rmSync(probe);
}

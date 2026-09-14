import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { examples } from '../shared/examples.ts';
import { runPython, CancelledError } from '../server/runner.ts';
import { privateMarkers } from '../server/candidates.ts';
import type { AppStatus, CaseView } from '../shared/types.ts';

const base=process.env.REPROSAFE_TEST_URL || 'http://127.0.0.1:4317';
const status=await (await fetch(`${base}/api/status`)).json() as AppStatus;
const headers={'Content-Type':'application/json','X-ReproSafe-Token':status.token};
const checks:string[]=[];
async function call(path:string,body?:unknown,expected=200) {
  const response=await fetch(`${base}/api${path}`,body===undefined?{}:{method:'POST',headers,body:JSON.stringify(body)});
  const data=await response.json(); assert.equal(response.status,expected,JSON.stringify(data)); return data;
}
function passed(name:string) { checks.push(name); console.log(`PASS ${name}`); }
assert.equal((await fetch(`${base}/api/cases`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
assert.equal((await fetch(`${base}/api/status`,{headers:{Origin:'https://example.com'}})).status,403);
passed('local API rejects missing session tokens and foreign origins');
for (const example of examples) {
  let session=await call('/cases',{title:example.title,kind:example.id,source:example.source,records:example.records},201) as CaseView;
  const route=`/cases/${session.id}`;
  session=await call(`${route}/reproduce`,{});
  assert.equal(session.original?.code,example.id==='invoices'?'CUSTOMER_ISOLATION':'CSV_PARSE_ERROR');
  passed(`${example.id}: real Wasmer execution reproduces named failure`);
  session=await call(`${route}/generate`,{});
  assert.equal(session.attempts.length,2); assert.equal(session.attempts[0].preserved,false); assert.equal(session.attempts[1].preserved,true); assert.ok(session.candidate);
  passed(`${example.id}: ordinary masking loses the failure; structural replacement preserves it`);
  session=await call(`${route}/preview`,{});
  assert.equal(session.preview!.provider,status.model.provider);
  if(status.model.provider==='gemini') assert.ok(session.preview!.destination.startsWith('https://generativelanguage.googleapis.com/v1beta/models/'));
  const outgoing=JSON.stringify(session.preview!.payload);
  for (const marker of privateMarkers(example.records)) assert.ok(!outgoing.includes(marker));
  await call(`${route}/ai-patch`,{previewId:session.preview!.id,hash:session.preview!.hash,reviewed:false},400);
  passed(`${example.id}: exact outgoing payload excludes known private strings and requires approval`);
  await call(`${route}/patch`,{source:example.patch,origin:'sample'});
  session=await call(`${route}/validate`,{});
  assert.equal(session.validation?.length,4); assert.ok(session.validation!.every(test=>test.result.status==='pass'),JSON.stringify(session.validation));
  passed(`${example.id}: corrected patch passes original, synthetic, and two regression inputs`);
  const exported=await fetch(`${base}/api${route}/export`); assert.equal(exported.status,200);
  const bytes=new Uint8Array(await exported.arrayBuffer()), files=unzipSync(bytes);
  assert.ok(files['fixed.py'] && files['verify.py']);
  const content=Object.values(files).map(value=>strFromU8(value)).join('\n');
  for (const marker of privateMarkers(example.records)) assert.ok(!content.includes(marker));
  mkdirSync('test-results',{recursive:true}); writeFileSync(`test-results/${example.id}-reproducer.zip`,bytes);
  passed(`${example.id}: ZIP export contains validated patch, synthetic fixture, and standalone verifier`);
  if (example.id==='invoices') {
    await call(`${route}/patch`,{source:'def process(records):\n    return []\n',origin:'manual'});
    session=await call(`${route}/validate`,{}); assert.ok(session.validation!.every(test=>test.result.status==='fail'));
    passed('empty-output patch fails all four acceptance tests');
  }
  await fetch(`${base}/api${route}`,{method:'DELETE',headers,body:'{}'});
}
const containment=await runPython(`def process(records):
    import os
    import socket
    result = {"key": os.environ.get("ANTHROPIC_API_KEY"), "host_file": os.path.exists("/host/.env")}
    try:
        connection = socket.create_connection(("127.0.0.1", 4317), timeout=1)
        connection.close()
        result["network"] = "connected"
    except Exception:
        result["network"] = "blocked"
    return result
`,[]);
assert.equal(containment.state,'ok'); assert.deepEqual(containment.output,{key:null,host_file:false,network:'blocked'});
passed('sandbox probe cannot connect to host listener or see the host key/file path');
const timeout=await runPython('def process(records):\n    while True:\n        pass\n',[],{timeoutMs:400,bootTimeoutMs:20000});
assert.equal(timeout.state,'timeout'); passed('infinite loop terminates at execution deadline');
const controller=new AbortController(); const cancelled=runPython('def process(records):\n    while True:\n        pass\n',[],{signal:controller.signal});
setTimeout(()=>controller.abort(),250); await assert.rejects(cancelled,CancelledError); passed('cancellation stops worker and rejects pending execution');
const logs=await runPython('def process(records):\n    print("PRIVATE-LOG-MARKER")\n    raise ValueError("PRIVATE-EXCEPTION-MARKER")\n',[]);
assert.equal(logs.state,'error'); assert.ok(!JSON.stringify(logs).includes('PRIVATE')); passed('guest output and exception messages are not forwarded in result metadata');
writeFileSync('test-results/integration.json',JSON.stringify({verifiedAt:new Date().toISOString(),provider:status.model.provider,checks,externalModelRequest:'Not tested: requires user API key and explicit payload approval'},null,2));
console.log(`\n${checks.length} integration checks passed. No external model request was made.`);

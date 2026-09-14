import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { examples } from '../shared/examples.ts';
import type { CaseView } from '../shared/types.ts';
import { startAuto, autoModelPatch, finishAuto } from '../server/workflow.ts';
import { privateMarkers } from '../server/candidates.ts';

const root=await mkdtemp(join(tmpdir(),'reprosafe-model-auto-'));
const example=examples[1];
const value:CaseView={id:'test-model',title:'model test',kind:'csv',source:example.source,records:example.records,attempts:[],events:[],releaseErrors:[],busy:false,generationComplete:false};
const connection={provider:'gemini' as const,model:'gemini-test-model',key:'test-only-not-a-real-key'};
const originalFetch=globalThis.fetch; let calls=0;
globalThis.fetch=(async(url,init)=>{
  calls++; assert.ok(String(url).startsWith('https://generativelanguage.googleapis.com/'));
  assert.equal(String(init?.body),JSON.stringify(value.preview!.payload));
  for(const marker of privateMarkers(example.records)) assert.ok(!String(init?.body).includes(marker));
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({source:example.patch})}]}}]});
}) as typeof fetch;
try {
  const signal=new AbortController().signal;
  await startAuto(value,{mode:'review',patch:'model',applyLocal:true,consent:false},connection,root,signal);
  assert.equal(calls,0); assert.equal(value.automation?.state,'awaiting-request'); assert.ok(value.preview);
  await assert.rejects(autoModelPatch(value,{...connection,model:'different-model'},signal)); assert.equal(calls,0);
  await autoModelPatch(value,connection,signal); assert.equal(calls,1);
  await finishAuto(value,root,signal); assert.equal(value.automation?.state,'awaiting-apply'); assert.equal(value.applied,undefined);
  assert.ok(value.validation?.every(t=>t.result.status==='pass'));
  console.log('PASS: model Auto pauses before sending; rejects changed model; sends exact reviewed payload; validates response; pauses before apply. Google response was mocked; no live API call.');
} finally {globalThis.fetch=originalFetch;}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startAuto, applyLocal, hashSource } from '../server/workflow.ts';
import { examples } from '../shared/examples.ts';
import type { CaseView } from '../shared/types.ts';

function session(): CaseView { return { id:'test', title:'test', kind:'csv', source:examples[1].source, records:examples[1].records, attempts:[],events:[],releaseErrors:[],busy:false,generationComplete:false }; }
test('Automatic mode requires explicit scope consent before any work', async () => {
  const value = session();
  await assert.rejects(startAuto(value,{mode:'automatic',patch:'none',applyLocal:false,consent:false},{provider:'gemini',key:'',model:''},tmpdir(),new AbortController().signal),/Approve/);
  assert.equal(value.original,undefined); assert.equal(value.events.length,0);
});
test('Auto rejects unconfigured AI and sample fixes on unrelated source', async () => {
  const value = session();
  await assert.rejects(startAuto(value,{mode:'review',patch:'model',applyLocal:true,consent:false},{provider:'gemini',key:'',model:''},tmpdir(),new AbortController().signal),/Configure/);
  value.source += '\n# changed';
  await assert.rejects(startAuto(value,{mode:'review',patch:'sample',applyLocal:true,consent:false},{provider:'gemini',key:'',model:''},tmpdir(),new AbortController().signal),/exact supported/);
});
test('Automatic model consent is bound to the selected provider and model', async () => {
  const value = session();
  await assert.rejects(startAuto(value,{mode:'automatic',patch:'model',applyLocal:true,consent:true,expectedProvider:'gemini',expectedModel:'approved-model'},{provider:'anthropic',key:'test-only',model:'other-model'},tmpdir(),new AbortController().signal),/connection changed/);
  assert.equal(value.original,undefined);
});
test('Local apply requires current hash, four passes and clean release scan', async () => {
  const value = session(); value.patch = examples[1].patch;
  const hash = hashSource(value.patch);
  await assert.rejects(applyLocal(value,'stale',tmpdir()),/changed/);
  await assert.rejects(applyLocal(value,hash,tmpdir()),/four checks/);
  value.candidate = {strategy:'test',title:'test',records:[{row:'"Example, Person",170'}]};
  value.validation = Array.from({length:4},() => ({title:'test',result:{status:'pass' as const,code:'PASS',label:'passed',checks:[],durationMs:1}}));
  value.patch += '\n# github_pat_secretValueForTesting';
  await assert.rejects(applyLocal(value,hashSource(value.patch),tmpdir()),/release scan/);
  value.patch = examples[1].patch;
  const root = await mkdtemp(join(tmpdir(),'reprosafe-apply-test-'));
  await applyLocal(value,hash,root);
  assert.ok(value.applied?.path.startsWith(join(root,'.local','applied')));
  assert.equal(await readFile(value.applied!.path,'utf8'),examples[1].patch);
  assert.equal(value.source,examples[1].source);
  const path = value.applied!.path; await applyLocal(value,hash,root); assert.equal(value.applied!.path,path);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { createHash } from 'node:crypto';
import { examples } from '../shared/examples.ts';
import { validateRecords, assess, regressionInputs } from '../server/contracts.ts';
import { candidates, makePreview, releaseErrors, privateMarkers } from '../server/candidates.ts';
import { exportBundle } from '../server/export.ts';
import type { CaseView, Execution } from '../shared/types.ts';

const goodOutput = (records: typeof examples[0]['records']) => {
  const result = new Map<string, {customer_id:string;invoice_ids:string[];total_cents:number}>();
  for (const record of records) {
    const key = String(record.customer_id), group = result.get(key) ?? { customer_id:key,invoice_ids:[],total_cents:0 };
    group.invoice_ids.push(String(record.invoice_id)); group.total_cents += Number(record.amount_cents); result.set(key,group);
  }
  return [...result.values()];
};
const execution = (output: unknown): Execution => ({ state:'ok',output,durationMs:1 });
test('input contracts reject extra fields, duplicate invoices, and malformed CSV', () => {
  for (const example of examples) assert.equal(validateRecords(example.id,example.records).length,example.records.length);
  assert.throws(() => validateRecords('invoices',[{...examples[0].records[0],password:'private'}]));
  assert.throws(() => validateRecords('invoices',[examples[0].records[0],examples[0].records[0]]));
  assert.throws(() => validateRecords('csv',[{row:'a,b,10'}]));
});
test('invoice oracle rejects missing, duplicated, merged, and incorrectly totalled data', () => {
  const records = examples[0].records, good = goodOutput(records);
  assert.equal(assess('invoices',records,execution(good)).code,'PASS');
  assert.equal(assess('invoices',records,execution([])).status,'fail');
  assert.equal(assess('invoices',records,execution([good[0],good[0]])).status,'fail');
  assert.equal(assess('invoices',records,execution([{customer_id:'x',invoice_ids:records.map(r=>r.invoice_id),total_cents:1}])).code,'CUSTOMER_ISOLATION');
  assert.equal(assess('invoices',records,execution(good.map(g=>({...g,total_cents:0})))).code,'INVOICE_TOTALS');
});
test('CSV oracle preserves quoted names, amounts, and order', () => {
  assert.equal(assess('csv',examples[1].records,execution([{name:'Martin, Nora',amount_cents:12500},{name:'Evan Cole',amount_cents:8900}])).code,'PASS');
  assert.equal(assess('csv',examples[1].records,execution([])).status,'fail');
  assert.equal(assess('csv',examples[1].records,{state:'error',errorType:'ValueError',durationMs:1}).code,'CSV_PARSE_ERROR');
  for (const item of regressionInputs('csv')) validateRecords('csv',item.records);
});
test('replacement policies create fresh values and preserve identifier case relationships', () => {
  for (const example of examples) for (const candidate of candidates(example.id,example.records)) {
    validateRecords(example.id,candidate.records);
    assert.deepEqual(releaseErrors(example.source,example.records,candidate.records),[]);
  }
  const [ordinary,structural] = candidates('invoices',examples[0].records);
  assert.notEqual(String(ordinary.records[0].customer_id).toLowerCase(),String(ordinary.records[1].customer_id).toLowerCase());
  assert.notEqual(structural.records[0].customer_id,structural.records[1].customer_id);
  assert.equal(String(structural.records[0].customer_id).toLowerCase(),String(structural.records[1].customer_id).toLowerCase());
});
test('release policy blocks embedded original values, CSV names, and recognizable keys', () => {
  const example = examples[0], synthetic = candidates(example.id,example.records)[1].records;
  assert.ok(releaseErrors(example.source+'\n# Nora Martin',example.records,synthetic).length);
  assert.ok(releaseErrors('# sk-ant-example123456',example.records,synthetic).length);
  assert.ok(releaseErrors('# Martin, Nora',examples[1].records,candidates('csv',examples[1].records)[1].records).length);
});
test('model request is bounded, hash-addressed, and contains no original fixture markers', () => {
  const example=examples[0], candidate=candidates(example.id,example.records)[1];
  const preview=makePreview(example.id,example.source,candidate.records,assess(example.id,example.records,execution([])),'test-model');
  const serialized=JSON.stringify(preview.payload);
  assert.equal(preview.hash,createHash('sha256').update(JSON.stringify({provider:preview.provider,model:preview.model,destination:preview.destination,payload:preview.payload})).digest('hex'));
  assert.equal(preview.bytes,Buffer.byteLength(serialized));
  for (const marker of privateMarkers(example.records)) assert.ok(!serialized.includes(marker));
  assert.ok(preview.provider === 'anthropic');
  const user=JSON.parse(preview.payload.messages[0].content);
  assert.deepEqual(Object.keys(user).sort(),['contract','observed_failure','source','synthetic_input']);
});
test('export excludes original fields and incomplete or unsafe patches', () => {
  const example=examples[0], candidate=candidates(example.id,example.records)[1];
  const original=assess(example.id,example.records,execution([]));
  const session:CaseView={id:'test',title:'private case title',kind:example.id,source:example.source,records:example.records,original,candidate,attempts:[],releaseErrors:[],events:[],busy:false,generationComplete:true,preview:makePreview(example.id,example.source,candidate.records,original,'model'),patch:example.patch};
  const passed=assess(example.id,example.records,execution(goodOutput(example.records)));
  session.validation=[{title:'Private original input',result:passed}];
  assert.ok(!unzipSync(exportBundle(session))['fixed.py']);
  session.validation=Array.from({length:4},(_,i)=>({title:`Check ${i}`,result:passed}));
  const files=unzipSync(exportBundle(session)); assert.ok(files['fixed.py']);
  const all=Object.values(files).map(value=>strFromU8(value)).join('\n');
  for (const marker of privateMarkers(example.records)) assert.ok(!all.includes(marker));
  assert.ok(!all.includes(session.title));
  session.patch+='\n# Nora Martin'; assert.throws(()=>exportBundle(session),/private value/);
});

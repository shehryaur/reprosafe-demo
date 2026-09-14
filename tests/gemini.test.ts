import test from 'node:test';
import assert from 'node:assert/strict';
import { examples } from '../shared/examples.ts';
import { candidates, makePreview, privateMarkers, releaseErrors } from '../server/candidates.ts';
import { assess } from '../server/contracts.ts';
import { assertPreviewCurrent, destinationFor, listModels, previewHash, requestModelPatch } from '../server/model-provider.ts';
import { CancelledError } from '../server/runner.ts';

function preview() {
  const example = examples[0];
  return makePreview('invoices', example.source, candidates('invoices',example.records)[1].records, assess('invoices',example.records,{state:'ok',output:[],durationMs:1}), 'gemini-test-flash','gemini');
}
test('Gemini preview shows the exact Google body, destination, model, and bounded schema', () => {
  const request = preview(); assert.ok(request.provider === 'gemini');
  assert.equal(request.destination,'https://generativelanguage.googleapis.com/v1beta/models/gemini-test-flash:generateContent');
  assert.equal(request.hash,previewHash(request));
  assert.equal(request.bytes,Buffer.byteLength(JSON.stringify(request.payload)));
  assert.equal(request.payload.generationConfig.responseMimeType,'application/json');
  assert.deepEqual(request.payload.generationConfig.responseJsonSchema.required,['source']);
  assert.ok(!('model' in request.payload));
  const input=JSON.parse(request.payload.contents[0].parts[0].text);
  assert.deepEqual(Object.keys(input).sort(),['contract','observed_failure','source','synthetic_input']);
  for (const marker of privateMarkers(examples[0].records)) assert.ok(!JSON.stringify(request).includes(marker));
});
test('changing provider, model, destination, or body invalidates approval', () => {
  const original=preview(); assert.doesNotThrow(()=>assertPreviewCurrent(original,'gemini',original.model));
  assert.throws(()=>assertPreviewCurrent(original,'anthropic',original.model));
  assert.throws(()=>assertPreviewCurrent(original,'gemini','gemini-other'));
  assert.throws(()=>assertPreviewCurrent({...original,destination:'http://localhost:8080'},'gemini',original.model));
  const modified=structuredClone(original); assert.ok(modified.provider==='gemini'); modified.payload.contents[0].parts[0].text='changed';
  assert.throws(()=>assertPreviewCurrent(modified,'gemini',modified.model));
  assert.throws(()=>destinationFor('gemini','../another-host'));
  assert.equal(destinationFor('anthropic','claude-test'),'https://api.anthropic.com/v1/messages');
});
test('model discovery paginates, filters non-text endpoints, and sends only the key header', async () => {
  let requests=0;
  const fake: typeof fetch = async (input,init) => {
    const url=new URL(String(input)); assert.equal(url.origin,'https://generativelanguage.googleapis.com'); assert.equal(url.pathname,'/v1beta/models'); assert.equal(url.searchParams.get('key'),null);
    assert.equal(new Headers(init?.headers).get('x-goog-api-key'),'test-only-key'); assert.equal(init?.body,undefined); assert.equal(init?.redirect,'error');
    requests++;
    if (requests===1) return Response.json({models:[{name:'models/gemini-test-pro',displayName:'Test Pro',supportedGenerationMethods:['generateContent']},{name:'models/gemini-embedding',supportedGenerationMethods:['embedContent']},{name:'models/gemini-test-tts',supportedGenerationMethods:['generateContent']}],nextPageToken:'page with / spaces'});
    assert.equal(url.searchParams.get('pageToken'),'page with / spaces');
    return Response.json({models:[{name:'models/gemini-test-flash',displayName:'Test Flash',supportedGenerationMethods:['generateContent']},{name:'models/gemini-test-pro',supportedGenerationMethods:['generateContent']},{name:'models/gemma-test',supportedGenerationMethods:['generateContent']}]});
  };
  const result=await listModels('gemini','test-only-key',fake);
  assert.equal(requests,2); assert.deepEqual(result.map(model=>model.id).sort(),['gemini-test-flash','gemini-test-pro']);
});
test('empty and repeating catalogs are handled without invented model names', async () => {
  assert.deepEqual(await listModels('gemini','key',async()=>Response.json({})),[]);
  await assert.rejects(()=>listModels('gemini','key',async()=>Response.json({models:[],nextPageToken:'same'})),/repeated/);
});
test('Gemini sends exactly the approved body and excludes reasoning parts from the patch', async () => {
  const approved=preview(); let calls=0;
  const fake: typeof fetch=async(input,init)=>{
    calls++; assert.equal(String(input),approved.destination); assert.equal(init?.method,'POST');
    assert.equal(init?.body,JSON.stringify(approved.payload)); assert.equal(new Headers(init?.headers).get('x-goog-api-key'),'local-test-key');
    return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'Not a patch'},{text:JSON.stringify({source:examples[0].patch})}]}}]});
  };
  assert.equal(await requestModelPatch(approved,'local-test-key',new AbortController().signal,fake),examples[0].patch); assert.equal(calls,1);
});
test('quota and access failures are sanitized and never automatically retried', async () => {
  for (const status of [400,401,403,404,429,500]) {
    let calls=0;
    await assert.rejects(()=>listModels('gemini','key',async()=>{calls++;return Response.json({error:{message:'PRIVATE-KEY-DETAIL'}},{status});}),error=>{
      assert.ok(error instanceof Error); assert.ok(!error.message.includes('PRIVATE')); return true;
    });
    assert.equal(calls,1);
  }
});
test('Gemini refuses blocked, truncated, malformed, and oversized patch responses', async () => {
  const responses=[{promptFeedback:{blockReason:'SAFETY'}},{candidates:[{finishReason:'MAX_TOKENS'}]},{candidates:[{finishReason:'SAFETY'}]},{candidates:[{finishReason:'STOP',content:{parts:[{text:'not JSON'}]}}]},{candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({source:'x'.repeat(24001)})}]}}]}];
  for(const data of responses) await assert.rejects(()=>requestModelPatch(preview(),'key',new AbortController().signal,async()=>Response.json(data)));
});
test('cancelled requests do not send and recognized Google keys block release', async () => {
  const controller=new AbortController(); controller.abort();
  const fake: typeof fetch=async(_input,init)=>{init?.signal?.throwIfAborted();throw new Error('Request should be aborted');};
  await assert.rejects(()=>requestModelPatch(preview(),'key',controller.signal,fake),CancelledError);
  assert.ok(releaseErrors('# AIza'+'A'.repeat(35),examples[0].records,candidates('invoices',examples[0].records)[1].records).length);
});

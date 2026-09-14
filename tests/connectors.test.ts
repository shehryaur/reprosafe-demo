import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Connectors, checkPublicKey, supabaseOrigin, safeFilePath, readJson } from '../server/connectors.ts';

const jwt = (role: string) => `eyJ0ZXN0Ijp0cnVlfQ.${Buffer.from(JSON.stringify({role})).toString('base64url')}.test-signature`;
test('Supabase origin rejects alternate hosts, credentials, redirects and URL tricks', () => {
  assert.equal(supabaseOrigin('https://abcdefghijklmnopqrst.supabase.co'), 'https://abcdefghijklmnopqrst.supabase.co');
  for (const url of ['http://abcdefghijklmnopqrst.supabase.co','https://localhost','https://127.0.0.1','https://abcdefghijklmnopqrst.supabase.co.evil.test','https://abcdefghijklmnopqrst.supabase.co@evil.test','https://abcdefghijklmnopqrst.supabase.co/rest/v1','https://abcdefghijklmnopqrst.supabase.co?key=secret','https://abcdefghijklmnopqrst.supabase.co:444']) assert.throws(() => supabaseOrigin(url));
});
test('Connection keys reject service-role and admin credentials', () => {
  assert.doesNotThrow(() => checkPublicKey('sb_publishable_example'));
  assert.doesNotThrow(() => checkPublicKey(jwt('anon')));
  assert.doesNotThrow(() => checkPublicKey(jwt('authenticated'), true));
  for (const key of ['sb_secret_secret',jwt('service_role'),jwt('postgres'),'invalid']) assert.throws(() => checkPublicKey(key));
  assert.throws(() => checkPublicKey(jwt('service_role'),true));
});
test('GitHub file paths cannot traverse or change origin', () => {
  assert.equal(safeFilePath('src/file name.py'), 'src/file%20name.py');
  for (const path of ['../.env','/file','src//a','src/../a','src\\a','src/\u0000.py']) assert.throws(() => safeFilePath(path));
});
test('GitHub connects in memory, reads through API only, and never follows download_url', async () => {
  const requests: {url: string; init?: RequestInit}[] = [];
  const connector = new Connectors((async (url, init) => {
    requests.push({url:String(url),init});
    return Response.json(String(url).endsWith('/user') ? {login:'test-user'} : {type:'file',size:40,encoding:'base64',sha:'abc123',content:Buffer.from('def process(records):\n    return []\n').toString('base64'), download_url:'https://evil.test/steal'});
  }) as typeof fetch);
  await connector.connectGitHub({token:'github_pat_test-only'});
  assert.equal(JSON.stringify(connector.status()).includes('github_pat_test-only'),false);
  const result = await connector.files({owner:'owner',repo:'repo',path:'buggy.py',ref:'a'.repeat(40)});
  assert.ok(result.file?.content.includes('def process'));
  assert.ok(requests.every(r => r.url.startsWith('https://api.github.com/') && r.init?.method === 'GET' && r.init.redirect === 'error'));
  connector.disconnect('github'); assert.equal(connector.status().github.authenticated,false);
});
test('Supabase selects only mapped columns with a row cap, no writes or arbitrary SQL', async () => {
  const urls: string[] = [];
  const connector = new Connectors((async (url, init) => {
    urls.push(String(url)); assert.equal(init?.method,'GET');
    return Response.json(String(url).endsWith('/rest/v1/') ? {paths:{'/demo':{get:{}}},definitions:{demo:{properties:{csv_text:{},reference:{}}}}} : [{csv_text:'"Example, Item",120',reference:'reference-one'}]);
  }) as typeof fetch);
  await connector.connectSupabase({url:'https://abcdefghijklmnopqrst.supabase.co',key:'sb_publishable_example'});
  const result = await connector.rows({table:'demo',kind:'csv',mapping:{row:'csv_text',reference:'reference'},limit:12,filterColumn:'reference',filterValue:'reference-one'});
  assert.equal(result.records[0].row,'"Example, Item",120');
  const url = new URL(urls.at(-1)!); assert.equal(url.searchParams.get('select'),'csv_text,reference'); assert.equal(url.searchParams.get('limit'),'12'); assert.equal(url.searchParams.get('reference'),'eq.reference-one');
  const count = urls.length;
  await assert.rejects(connector.rows({table:'demo',kind:'csv',mapping:{row:'csv_text'},limit:12,expectedUrl:'https://zyxwvutsrqponmlkjihg.supabase.co'}),/project changed/);
  await assert.rejects(connector.rows({table:'demo;delete',kind:'csv',mapping:{row:'csv_text'},limit:12}));
  await assert.rejects(connector.rows({table:'demo',kind:'csv',mapping:{row:'*'},limit:12}));
  await assert.rejects(connector.rows({table:'demo',kind:'csv',mapping:{row:'csv_text'},limit:61}));
  await assert.rejects(connector.rows({table:'demo',kind:'csv',mapping:{row:'csv_text'},limit:12,query:'DROP TABLE demo'}));
  assert.equal(urls.length,count);
  assert.equal(JSON.stringify(connector.status()).includes('sb_publishable'),false);
  const empty = new Connectors((async url => Response.json(String(url).endsWith('/rest/v1/') ? {} : [])) as typeof fetch);
  await empty.connectSupabase({url:'https://abcdefghijklmnopqrst.supabase.co',key:'sb_publishable_example'});
  await assert.rejects(empty.rows({table:'demo',kind:'csv',mapping:{row:'csv_text'},limit:12}),/No accessible rows/);
});
test('Upstream errors never expose reflected response bodies or credentials', async () => {
  await assert.rejects(readJson('https://api.github.com/user',{},'GitHub',(async () => new Response('SECRET-DO-NOT-SHOW',{status:401})) as typeof fetch), error => error instanceof Error && !error.message.includes('SECRET') && error.message.includes('credentials'));
  await assert.rejects(readJson('https://api.github.com/user',{},'GitHub',(async () => new Response('x'.repeat(200))) as typeof fetch,100),/too large/);
});

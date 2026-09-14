import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const { port } = JSON.parse(readFileSync('.local/server.json','utf8'));
assert.ok(Number.isInteger(port) && port > 1024 && port < 65536);
const base=`http://127.0.0.1:${port}`;
const page=await fetch(base);
assert.equal(page.status,200); assert.ok((await page.text()).includes('<title>ReproSafe</title>'));
assert.ok(page.headers.get('content-security-policy')?.includes("default-src 'self'"));
for (const name of readdirSync('dist/assets')) {
  const response=await fetch(`${base}/assets/${name}`); assert.equal(response.status,200); assert.ok((await response.arrayBuffer()).byteLength>0);
}
const status=await (await fetch(`${base}/api/status`)).json();
const checked=await (await fetch(`${base}/api/runtime/check`,{method:'POST',headers:{'Content-Type':'application/json','X-ReproSafe-Token':status.token},body:'{}'})).json();
assert.equal(checked.runtime.state,'ready');
console.log(`PASS production page, security header, all built assets, and live runtime: ${base}`);

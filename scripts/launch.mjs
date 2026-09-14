import { existsSync, mkdirSync, openSync, closeSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Install Node.js 24 or newer from https://nodejs.org/en/download, then reopen this launcher.');
mkdirSync('.local', { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function running() {
  try {
    const state = JSON.parse(readFileSync('.local/server.json', 'utf8'));
    if (!Number.isInteger(state.port) || state.port < 1024 || state.port > 65535) return null;
    const url = `http://127.0.0.1:${state.port}`;
    const response = await fetch(`${url}/api/status`, { signal: AbortSignal.timeout(1200) });
    const data = await response.json();
    if (!response.ok || !data.token || !data.runtime?.version?.startsWith('Wasmer SDK')) return null;
    return { url, token: data.token, port: state.port };
  } catch { return null; }
}
function npm(command) {
  const args = command === 'ci' ? 'npm ci --cache .local/npm-cache --no-fund --no-audit' : 'npm run build';
  const result = process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', args], { cwd: root, stdio: 'inherit', windowsHide: true })
    : spawnSync('npm', command === 'ci' ? ['ci','--cache','.local/npm-cache','--no-fund','--no-audit'] : ['run','build'], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Setup failed. Check the messages above and your internet connection.');
}
let server = await running();
const restart = process.argv.includes('--restart'), stop = process.argv.includes('--stop');
const previousPort = server?.port;
if (stop || restart) {
  if (server) {
    const response = await fetch(`${server.url}/api/shutdown`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ReproSafe-Token': server.token }, body: '{}' });
    if (!response.ok) throw new Error('The server could not be stopped. Close active operations and retry.');
    await response.json();
    console.log('ReproSafe stopped. In-memory cases and API key cleared.');
    server = null;
    for (let i = 0; i < 40; i++) { if (!await running()) break; await sleep(250); if (i === 39) throw new Error('The old server has not stopped. Retry in a moment.'); }
  } else console.log('ReproSafe is not running.');
}
if (!stop) {
if (!server) {
  if (!existsSync('node_modules/@wasmer/sdk')) npm('ci');
  if (!existsSync('dist/index.html')) npm('build');
  const out = openSync('.local/server.log', 'a');
  const child = spawn(process.execPath, ['server/index.ts', '--production'], { cwd: root, env: { ...process.env, ...(restart && previousPort ? { PORT: String(previousPort) } : {}) }, detached: true, windowsHide: true, stdio: ['ignore', out, out] });
  child.unref(); closeSync(out);
  for (let i = 0; i < 60 && !server; i++) { await sleep(500); server = await running(); }
  if (!server) throw new Error('The server did not start. See .local/server.log.');
}
console.log(`ReproSafe is ready: ${server.url}`);
if (!process.argv.includes('--no-open')) {
  const child = process.platform === 'win32'
    ? spawn('powershell.exe', ['-NoProfile','-NonInteractive','-Command', `Start-Process '${server.url}'`], { windowsHide: true, stdio: 'ignore' })
    : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [server.url], { stdio: 'ignore' });
  child.unref();
}
}

import { z } from 'zod';
import type { ConnectorStatus, Records } from '../shared/types.ts';
import type { CaseKind } from '../shared/examples.ts';
import { validateRecords } from './contracts.ts';
import { connectionFailure, diagnosticCode } from './network-errors.ts';

const identifier = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/);
const segment = z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/).refine(s => s !== '.' && s !== '..');
export const repoSchema = z.object({ owner: segment, repo: segment });
export const fileSchema = repoSchema.extend({ ref: z.string().min(1).max(200), path: z.string().max(500).default('') }).strict();
const keySchema = z.string().trim().min(10).max(5000).regex(/^\S+$/);

function error(message: string, status = 400): never { throw Object.assign(new Error(message), { status }); }
export function safeFilePath(path: string) {
  if (path && (path.startsWith('/') || path.split('/').some(p => !p || p === '.' || p === '..' || /[\\\x00-\x1f]/.test(p)))) error('Choose a regular repository file path.');
  return path.split('/').map(encodeURIComponent).join('/');
}
export function supabaseOrigin(value: string) {
  let url: URL; try { url = new URL(value); } catch { return error('Enter your Supabase project URL.'); }
  if (url.protocol !== 'https:' || !/^[a-z0-9]{10,40}\.supabase\.co$/.test(url.hostname) || url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/') error('Use the HTTPS project URL ending in .supabase.co, without a path.');
  return url.origin;
}
export function checkPublicKey(key: string, user = false) {
  if (!user && key.startsWith('sb_publishable_')) return;
  try {
    const parts = key.split('.');
    if (parts.length !== 3) throw new Error();
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (payload.role !== (user ? 'authenticated' : 'anon')) throw new Error();
  } catch { error(user ? 'Use an authenticated user access token, not a service-role or admin token.' : 'Use a publishable or legacy anon key. Secret and service-role keys are not accepted.'); }
  // This check only rejects privileged token types; Supabase verifies signatures and permissions.
}
export async function readJson(url: string, headers: Record<string, string>, service: string, fetcher: typeof fetch = fetch, limit = 2_000_000): Promise<any> {
  let response: Response;
  try { response = await fetcher(url, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(20_000) }); }
  catch (e) { return error(connectionFailure(service, diagnosticCode(e)), 502); }
  if (!response.ok) {
    await response.body?.cancel();
    error(response.status === 401 ? `${service}: credentials were rejected. Reconnect with a valid key.` : response.status === 403 ? `${service}: access denied or API rate limit reached. Check the selected resource and permissions.` : response.status === 404 ? `${service}: resource not found or not accessible.` : response.status === 429 ? `${service}: rate limit reached. Try again later.` : `${service} returned HTTP ${response.status}.`, 502);
  }
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); error(`${service}: response is too large. Select a smaller resource.`); }
  const reader = response.body?.getReader(); if (!reader) error(`${service}: empty response.`);
  const chunks: Uint8Array[] = []; let length = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; length += part.value.length; if (length > limit) { await reader.cancel(); error(`${service}: response is too large. Select a smaller resource.`); } chunks.push(part.value); } }
  catch (e) { if (e instanceof Error && 'status' in e) throw e; error(`${service}: the response could not be read.`, 502); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return error(`${service}: invalid JSON response.`, 502); }
}

export class Connectors {
  private githubToken = '';
  private account = '';
  private ghConnected = false;
  private sb?: { url: string; key: string; jwt: string };
  private fetcher: typeof fetch;
  constructor(fetcher: typeof fetch = fetch) { this.fetcher = fetcher; }
  status(): ConnectorStatus { return { github: { connected: this.ghConnected, authenticated: Boolean(this.githubToken), account: this.account }, supabase: { connected: Boolean(this.sb), url: this.sb?.url ?? '' } }; }
  disconnect(service: 'github' | 'supabase') { if (service === 'github') { this.githubToken = ''; this.account = ''; this.ghConnected = false; } else this.sb = undefined; }
  async connectGitHub(input: unknown) {
    const { token } = z.object({ token: z.string().trim().max(5000).regex(/^\S*$/).default('') }).strict().parse(input);
    let account = 'Public repositories';
    if (token) { const user = await this.gh('/user', token); account = z.string().parse(user.login); }
    this.githubToken = token; this.account = account; this.ghConnected = true; return this.status();
  }
  private gh(path: string, token = this.githubToken) { return readJson(`https://api.github.com${path}`, { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'ReproSafe-local', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, 'GitHub', this.fetcher); }
  async repos() {
    if (!this.githubToken) error('For public repositories, enter owner/repository. A token is needed to list your private repositories.');
    const rows = await this.gh('/user/repos?per_page=100&sort=updated');
    if (!Array.isArray(rows)) error('GitHub returned an unexpected repository list.', 502);
    return { repositories: rows.map(r => ({ owner: r.owner?.login, repo: r.name, branch: r.default_branch, private: r.private })), limited: rows.length === 100 };
  }
  async branches(input: unknown) {
    const { owner, repo } = repoSchema.strict().parse(input);
    const rows = await this.gh(`/repos/${owner}/${repo}/branches?per_page=100`);
    if (!Array.isArray(rows)) error('GitHub returned an unexpected branch list.', 502);
    return { branches: rows.map(r => ({ name: r.name, sha: r.commit?.sha })), limited: rows.length === 100 };
  }
  async files(input: unknown) {
    const { owner, repo, ref, path } = fileSchema.parse(input);
    const item = await this.gh(`/repos/${owner}/${repo}/contents/${safeFilePath(path)}?ref=${encodeURIComponent(ref)}`);
    if (Array.isArray(item)) return { entries: item.filter(r => r.type === 'dir' || r.type === 'file' && /\.(py|json)$/i.test(r.name)).map(r => ({ name: r.name, path: r.path, type: r.type })), limited: item.length >= 1000 };
    if (item.type !== 'file' || item.submodule_git_url || item.target || item.encoding !== 'base64' || item.size > 256_000 || !/\.(py|json)$/i.test(path)) error('Choose a regular .py or .json file smaller than 256 KB.');
    const bytes = Buffer.from(z.string().parse(item.content), 'base64');
    if (bytes.length > 256_000 || bytes.includes(0)) error('Choose a small text file.');
    return { file: { path, sha: item.sha, content: bytes.toString('utf8'), repository: `${owner}/${repo}`, ref } };
  }
  async connectSupabase(input: unknown) {
    const value = z.object({ url: z.string().max(200), key: keySchema, jwt: z.string().trim().max(5000).regex(/^\S*$/).default('') }).strict().parse(input);
    const next = { ...value, url: supabaseOrigin(value.url) }; checkPublicKey(next.key); if (next.jwt) checkPublicKey(next.jwt, true);
    await this.sbRead('/', next); this.sb = next; return this.status();
  }
  private sbRead(path: string, connection = this.sb) {
    if (!connection) error('Connect your Supabase project first.');
    return readJson(`${connection.url}/rest/v1${path}`, { apikey: connection.key, Accept: path === '/' ? 'application/openapi+json' : 'application/json', ...(connection.jwt ? { Authorization: `Bearer ${connection.jwt}` } : !connection.key.startsWith('sb_') ? { Authorization: `Bearer ${connection.key}` } : {}) }, 'Supabase', this.fetcher);
  }
  async tables() {
    const schema = await this.sbRead('/');
    return { tables: Object.entries(schema.paths ?? {}).filter(([path, value]) => /^\/[A-Za-z_][A-Za-z0-9_]*$/.test(path) && (value as any).get).map(([path]) => ({ name: path.slice(1), columns: Object.keys(schema.definitions?.[path.slice(1)]?.properties ?? {}) })) };
  }
  async rows(input: unknown) {
    const query = z.object({ table: identifier, kind: z.enum(['invoices','csv']), mapping: z.record(z.string(), identifier), limit: z.number().int().min(1).max(60), filterColumn: identifier.optional(), filterValue: z.string().max(200).optional(), expectedUrl: z.string().max(200).optional() }).strict().parse(input);
    if (query.expectedUrl && supabaseOrigin(query.expectedUrl) !== this.sb?.url) error('The Supabase project changed. Select the records again.', 409);
    return this.readRows(query);
  }
  private async readRows(query: { table: string; kind: CaseKind; mapping: Record<string, string>; limit: number; filterColumn?: string; filterValue?: string }) {
    const allowed = query.kind === 'csv' ? ['row','reference'] : ['customer_id','invoice_id','amount_cents','name','email','notes'];
    const required = query.kind === 'csv' ? ['row'] : ['customer_id','invoice_id','amount_cents'];
    if (Object.keys(query.mapping).some(key => !allowed.includes(key)) || required.some(key => !query.mapping[key])) error('Map the required fields for this contract.');
    if (Boolean(query.filterColumn) !== (query.filterValue !== undefined)) error('Provide both the filter column and its value.');
    const params = new URLSearchParams({ select: [...new Set(Object.values(query.mapping))].join(','), limit: String(query.limit) });
    if (query.filterColumn) params.set(query.filterColumn, `eq.${query.filterValue}`);
    const rows = await this.sbRead(`/${query.table}?${params}`);
    if (!Array.isArray(rows) || rows.length > query.limit) error('Supabase returned an unexpected row set.');
    if (!rows.length) error('No accessible rows matched. Check your filter, SELECT grants, and row-level security.');
    const records: Records = rows.map(row => Object.fromEntries(Object.entries(query.mapping).map(([target, column]) => [target, row[column]])));
    return { records: validateRecords(query.kind, records), count: records.length, limit: query.limit };
  }
}

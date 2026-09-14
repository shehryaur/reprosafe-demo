import { useEffect, useRef, useState } from 'react';
import { GitBranch as Github, Database, Folder, FileCode2, ArrowLeft, Download, Plug, Unplug, LoaderCircle } from 'lucide-react';
import type { CaseKind } from '../shared/examples';
import type { ConnectorStatus, Records } from '../shared/types';
import { api } from './api';

type Entry = { name: string; path: string; type: string };
export type GitHubSelection = { owner: string; repo: string; ref: string; path: string };
export type InputSelection = { service: 'github'; selection: GitHubSelection } | { service: 'supabase'; projectUrl: string; selection: {table:string;kind:CaseKind;mapping:Record<string,string>;limit:number;filterColumn?:string;filterValue?:string} };
export interface SourceBindings { source?: GitHubSelection; input?: InputSelection; }
export function Sources({ kind, onSource, onRecords, onDemo }: { kind: CaseKind; onSource: (value: string, label: string, selection: GitHubSelection) => void; onRecords: (value: Records, label: string, selection: InputSelection) => void; onDemo: () => Promise<void> }) {
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [tab, setTab] = useState<'github'|'supabase'>('github');
  const [status, setStatus] = useState<ConnectorStatus>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [note, setNote] = useState('');
  const [token, setToken] = useState(''), [repo, setRepo] = useState(''), [ref, setRef] = useState('main'), [path, setPath] = useState('');
  const [repos, setRepos] = useState<{owner: string; repo: string; branch: string; private: boolean}[]>([]);
  const [branches, setBranches] = useState<{name: string; sha: string}[]>([]), [entries, setEntries] = useState<Entry[]>([]);
  const [url, setUrl] = useState(''), [key, setKey] = useState(''), [jwt, setJwt] = useState('');
  const [tables, setTables] = useState<{name: string; columns: string[]}[]>([]), [table, setTable] = useState('');
  const [mapping, setMapping] = useState<Record<string,string>>({}), [limit, setLimit] = useState(60);
  const [filterColumn, setFilterColumn] = useState(''), [filterValue, setFilterValue] = useState('');
  useEffect(() => { api<ConnectorStatus>('/connectors').then(value => { setStatus(value); setUrl(value.supabase.url); }).catch(e => setError(e.message)); }, []);
  const fields = kind === 'csv' ? ['row','reference'] : ['customer_id','invoice_id','amount_cents','name','email','notes'];
  const required = kind === 'csv' ? ['row'] : ['customer_id','invoice_id','amount_cents'];
  const columns = tables.find(t => t.name === table)?.columns ?? [];
  async function run(fn: () => Promise<void>) { if (busy) return; setBusy(true); setError(''); setNote(''); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  function repository() {
    const parts = repo.trim().replace(/^https:\/\/github\.com\//, '').replace(/\/$/, '').split('/');
    if (parts.length !== 2 || parts.some(p => !p)) throw new Error('Enter owner/repository, or its GitHub URL.');
    return { owner: parts[0], repo: parts[1] };
  }
  async function browse(nextPath = '') {
    const result = await api<{entries?: Entry[]; limited?: boolean; file?: {content: string; path: string; sha: string}}>( '/connectors/github/files', { ...repository(), ref, path: nextPath });
    if (!alive.current) return;
    if (result.file) {
      const selection = {...repository(),ref,path:result.file.path};
      if (/\.py$/i.test(result.file.path)) onSource(result.file.content, `GitHub: ${repo}/${result.file.path}`, selection);
      else { let records: Records; try { records = JSON.parse(result.file.content); } catch { throw new Error('The selected JSON file is invalid.'); } if (!Array.isArray(records)) throw new Error('Choose a JSON array of records.'); onRecords(records, `GitHub: ${result.file.path}`, {service:'github',selection}); }
      setNote(`Read ${result.file.path} at ${result.file.sha.slice(0,12)}. Remote file unchanged.`);
    } else { setEntries(result.entries ?? []); setPath(nextPath); if (result.limited) setNote('GitHub limited this directory listing. Enter a specific file path.'); }
  }
  async function loadTables() { const result = await api<{tables: {name:string; columns:string[]}[]}>('/connectors/supabase/tables'); setTables(result.tables); if (!result.tables.length) setNote('No tables are advertised. Enter an accessible table name below.'); }
  return <div className="sources-content">
    <div className="source-tabs" role="tablist" aria-label="Data providers"><button role="tab" aria-selected={tab === 'github'} disabled={busy} onClick={() => setTab('github')}><Github size={17} /> GitHub</button><button role="tab" aria-selected={tab === 'supabase'} disabled={busy} onClick={() => setTab('supabase')}><Database size={17} /> Supabase</button></div>
    <div className="modal-body">
      {tab === 'github' ? <>
        <div className="connection-state"><Github size={18} /><strong>{status?.github.connected ? status.github.account : 'Not connected'}</strong>{status?.github.connected && <button title="Disconnect GitHub" aria-label="Disconnect GitHub" className="icon-button" disabled={busy} onClick={() => run(async () => { setStatus(await api('/connectors/disconnect', { service:'github' })); setEntries([]); setRepos([]); setBranches([]); })}><Unplug size={16} /></button>}</div>
        <label>Read-only GitHub token (optional for public repositories)<input type="password" autoComplete="off" value={token} disabled={busy} onChange={e => setToken(e.target.value)} /></label>
        <div className="source-actions"><button disabled={busy} onClick={() => run(async () => { setStatus(await api('/connectors/github/connect', { token })); setToken(''); setNote('Connected. Repository access is read-only in this app.'); })}><Plug size={15} /> Connect GitHub</button><button disabled={busy || !status?.github.authenticated} onClick={() => run(async () => { const result = await api<{repositories: typeof repos; limited: boolean}>('/connectors/github/repos'); setRepos(result.repositories); if (result.limited) setNote('Showing the first 100 repositories. You can also enter a repository directly.'); })}><Folder size={15} /> My repositories</button></div>
        <p className="field-hint"><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">Create a fine-grained token</a>: selected repositories, Contents: read-only. Tokens stay in this server session.</p>
        {repos.length > 0 && <label>Repository<select value={repo} disabled={busy} onChange={e => { const r = repos.find(r => `${r.owner}/${r.repo}` === e.target.value); setRepo(e.target.value); setRef(r?.branch ?? 'main'); setEntries([]); setBranches([]); setPath(''); }}><option value="">Select repository</option>{repos.map(r => <option key={`${r.owner}/${r.repo}`} value={`${r.owner}/${r.repo}`}>{r.owner}/{r.repo}{r.private ? ' (private)' : ''}</option>)}</select></label>}
        <div className="source-grid"><label>Repository URL or owner/repository<input value={repo} disabled={busy} onChange={e => { setRepo(e.target.value); setBranches([]); setEntries([]); setPath(''); }} placeholder="your-account/reprosafe-demo" /></label><label>Branch or commit<input value={ref} disabled={busy} onChange={e => { setRef(e.target.value); setEntries([]); setPath(''); }} /></label></div>
        <div className="source-actions"><button disabled={busy || !repo} onClick={() => run(async () => { const result = await api<{branches: typeof branches}>('/connectors/github/branches', repository()); setBranches(result.branches); })}>Load branches</button><button disabled={busy || !repo || !ref} onClick={() => run(() => browse(''))}><Folder size={15} /> Browse files</button></div>
        {branches.length > 0 && <label>Pin to branch revision<select value={ref} disabled={busy} onChange={e => { setRef(e.target.value); setEntries([]); setPath(''); }}><option value={ref}>Current: {ref}</option>{branches.map(b => <option key={b.name} value={b.sha}>{b.name} ({b.sha.slice(0,8)})</option>)}</select></label>}
        <div className="source-grid"><label>File or directory<input value={path} disabled={busy} onChange={e => setPath(e.target.value)} placeholder="buggy.py" /></label><button disabled={busy || !repo || !ref} onClick={() => run(() => browse(path))}><Download size={15} /> Read selected path</button></div>
        <div className="file-browser" aria-label="GitHub files">{path && <button disabled={busy} onClick={() => run(() => browse(path.split('/').slice(0,-1).join('/')))}><ArrowLeft size={15} /> Parent directory</button>}{entries.map(entry => <button key={entry.path} disabled={busy} onClick={() => run(() => browse(entry.path))}>{entry.type === 'dir' ? <Folder size={16} /> : <FileCode2 size={16} />}<span>{entry.name}</span></button>)}</div>
      </> : <>
        <div className="connection-state"><Database size={18} /><strong>{status?.supabase.connected ? 'Project connected' : 'Not connected'}</strong>{status?.supabase.connected && <button title="Disconnect Supabase" aria-label="Disconnect Supabase" className="icon-button" disabled={busy} onClick={() => run(async () => { setStatus(await api('/connectors/disconnect', {service:'supabase'})); setTables([]); })}><Unplug size={16} /></button>}</div>
        <label>Project URL<input value={url} disabled={busy} onChange={e => setUrl(e.target.value)} placeholder="https://your-project.supabase.co" /></label>
        <label>Publishable key or legacy anon key<input type="password" autoComplete="off" value={key} disabled={busy} onChange={e => setKey(e.target.value)} /></label>
        <label>User access token (optional, for authenticated RLS access)<input type="password" autoComplete="off" value={jwt} disabled={busy} onChange={e => setJwt(e.target.value)} /></label>
        <p className="field-hint">No service-role or secret keys. Only GET requests; row visibility depends on your database grants and RLS. Selected rows are read into local memory.</p>
        <div className="source-actions"><button disabled={busy || !url || !key} onClick={() => run(async () => { setStatus(await api('/connectors/supabase/connect', {url,key,jwt})); setKey(''); setJwt(''); await loadTables(); })}><Plug size={15} /> Connect Supabase</button><button disabled={busy || !status?.supabase.connected} onClick={() => run(loadTables)}><Database size={15} /> Refresh tables</button></div>
        <label>Table<input list="supabase-tables" value={table} disabled={busy} onChange={e => { setTable(e.target.value); const columns = tables.find(t => t.name === e.target.value)?.columns ?? []; setMapping(Object.fromEntries(fields.filter(f => columns.includes(f)).map(f => [f,f]))); }} placeholder="reprosafe_retail_demo" /><datalist id="supabase-tables">{tables.map(t => <option key={t.name} value={t.name} />)}</datalist></label>
        <div className="mapping-grid">{fields.map(field => <label key={field}>{field}{required.includes(field) ? ' *' : ''}<input list="supabase-columns" value={mapping[field] ?? ''} disabled={busy} onChange={e => setMapping({...mapping, [field]:e.target.value})} placeholder={`Column for ${field}`} /></label>)}<datalist id="supabase-columns">{columns.map(c => <option key={c} value={c} />)}</datalist></div>
        <div className="source-grid"><label>Filter column (optional)<input list="supabase-columns" value={filterColumn} disabled={busy} onChange={e => setFilterColumn(e.target.value)} /></label><label>Equals<input value={filterValue} disabled={busy} onChange={e => setFilterValue(e.target.value)} /></label><label>Maximum records<input type="number" min={1} max={60} value={limit} disabled={busy} onChange={e => setLimit(Number(e.target.value))} /></label></div>
        <button disabled={busy || !status?.supabase.connected || !table || required.some(f => !mapping[f])} onClick={() => run(async () => { const selection = { table,kind,mapping:Object.fromEntries(Object.entries(mapping).filter(([,value]) => value)),limit,...(filterColumn ? {filterColumn,filterValue} : {}) }; const result = await api<{records: Records; count: number}>('/connectors/supabase/rows', {...selection,expectedUrl:status!.supabase.url}); if (!alive.current) return; onRecords(result.records, `Supabase: ${table}`, {service:'supabase',projectUrl:status!.supabase.url,selection}); setNote(`${result.count} rows read locally. Database unchanged.`); })}><Download size={15} /> Read selected records</button>
      </>}
      {busy && <p className="running-line" role="status"><LoaderCircle size={15} className="spin" /> Connecting</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}{note && <p className="field-hint" role="status">{note}</p>}
      <div className="public-demo-action"><button disabled={busy} onClick={() => run(onDemo)}><FileCode2 size={15} /> Open public retail demo</button><span>UCI Online Retail / CC BY 4.0 / adapted transactions</span></div>
    </div>
  </div>;
}

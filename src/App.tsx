import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Braces, ChevronRight, FileCode2, FolderOpen, LockKeyhole, Play, Settings2, ShieldCheck, Plus, X, Download, Check, CircleAlert, RotateCcw, LoaderCircle, Square, ArrowUpRight, KeyRound, FileCheck2, History, Clipboard, Upload, CircleCheck, GitCompareArrows, Plug, Zap, Save } from 'lucide-react';
import { diffLines } from 'diff';
import { examples, contractText, type Example, type CaseKind } from '../shared/examples';
import type { AppStatus, CaseView, Assessment, Provider, ModelOption, AutoOptions, Records, ConnectorStatus } from '../shared/types';
import { api, setToken } from './api';
import { Sources, type SourceBindings, type GitHubSelection } from './Sources';
const modelProviderName = (provider?: Provider) => provider === 'anthropic' ? 'Claude' : 'Gemini';

function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className={`modal ${wide ? 'wide' : ''}`} onCancel={onClose} onClick={e => { if (e.target === ref.current) onClose(); }}><div className="modal-header"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={18} /></button></div>{children}</dialog>;
}
function Badge({ result }: { result: Assessment }) { return <span className={`result-badge ${result.status}`}>{result.status === 'pass' ? <Check size={12} /> : <CircleAlert size={12} />}{result.status === 'pass' ? 'Passed' : result.status === 'fail' ? 'Failed' : 'Error'}</span>; }
function Checks({ result }: { result: Assessment }) { return <div className="check-list">{result.checks.map(check => <div key={check.name}><span className={check.passed ? 'success-text' : 'danger-text'}>{check.passed ? <Check size={15} /> : <X size={15} />}</span>{check.name}</div>)}</div>; }
function Code({ value, onChange, label, disabled }: { value: string; onChange?: (text: string) => void; label: string; disabled?: boolean }) {
  return <textarea className="code-editor" spellCheck={false} autoCapitalize="off" autoCorrect="off" aria-label={label} value={value} onChange={event => onChange?.(event.target.value)} readOnly={!onChange || disabled} onKeyDown={event => {
    if (event.key === 'Tab' && onChange && !disabled) { event.preventDefault(); const element = event.currentTarget; const start = element.selectionStart, end = element.selectionEnd; onChange(value.slice(0, start) + '    ' + value.slice(end)); requestAnimationFrame(() => element.setSelectionRange(start + 4, start + 4)); }
  }} />;
}

export default function App() {
  const [exampleId, setExampleId] = useState<string>('invoices');
  const [kind, setKind] = useState<CaseKind>('invoices');
  const [title, setTitle] = useState(examples[0].title);
  const [source, setSource] = useState(examples[0].source);
  const [input, setInput] = useState(JSON.stringify(examples[0].records, null, 2));
  const [tab, setTab] = useState('source');
  const [view, setView] = useState<'work'|'synthetic'|'patch'|'activity'>('work');
  const [session, setSession] = useState<CaseView>();
  const sessionRef = useRef<CaseView | undefined>(undefined);
  const [status, setStatus] = useState<AppStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState<'settings'|'new'|'preview'|'sources'|'auto'|'apply'|null>(null);
  const [autoOptions, setAutoOptions] = useState<AutoOptions>({mode:'review', patch:'none', applyLocal:true, consent:false});
  const [applyReviewed, setApplyReviewed] = useState(false);
  const [bindings, setBindings] = useState<SourceBindings>({});
  const [refreshSources, setRefreshSources] = useState(true);
  const [keyDraft, setKeyDraft] = useState('');
  const [providerDraft, setProviderDraft] = useState<Provider>('gemini');
  const [modelDraft, setModelDraft] = useState('');
  const [models, setModels] = useState<ModelOption[]>([]);
  const [discoveryNote, setDiscoveryNote] = useState('');
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [patchDraft, setPatchDraft] = useState('');
  const [patchTab, setPatchTab] = useState('diff');
  const [newTitle, setNewTitle] = useState('Customer data reproducer');
  const [newKind, setNewKind] = useState<CaseKind>('invoices');
  const [mobileMenu, setMobileMenu] = useState(false);
  const fileSource = useRef<HTMLInputElement>(null), fileInput = useRef<HTMLInputElement>(null);

  function updateSession(value: CaseView | undefined) { sessionRef.current = value; setSession(value); }
  async function refreshStatus() {
    const value = await api<AppStatus>('/status');
    if (!value.providers || !value.model.provider) throw new Error('This address is running an older ReproSafe server. Open the updated address from Start-ReproSafe.cmd.');
    setStatus(value); setToken(value.token); return value;
  }
  useEffect(() => { refreshStatus().catch(e => setError(e.message)); }, []);
  useEffect(() => {
    if (!busy || !session?.id) return;
    let alive = true;
    const timer = setInterval(() => api<CaseView>(`/cases/${session.id}`).then(value => { if (alive) updateSession(value); }).catch(() => {}), 800);
    return () => { alive = false; clearInterval(timer); };
  }, [busy, session?.id]);
  useEffect(() => { if (session?.patch) setPatchDraft(session.patch); }, [session?.patch]);
  useEffect(() => { if (!notice) return; const timeout = setTimeout(() => setNotice(''), 4000); return () => clearTimeout(timeout); }, [notice]);

  // Only a local status read is exposed to page agents; no fixture or release authority.
  useEffect(() => {
    const context = (document as Document & { modelContext?: { registerTool: (tool: unknown, options: {signal: AbortSignal}) => unknown } }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    try { Promise.resolve(context.registerTool({ name: 'get_reprosafe_run_status', title: 'Read reproduction status', description: 'Return the current local run status without source code, input values, or model credentials.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false }, execute: (input: unknown) => {
      if (!input || typeof input !== 'object' || Object.keys(input).length) throw new Error('No arguments are accepted.'); const current = sessionRef.current; return { active: Boolean(current), busy: current?.busy ?? false, failure: current?.original?.code ?? null, syntheticReady: Boolean(current?.candidate), patchChecks: current?.validation?.map(test => ({ title: test.title, status: test.result.status })) ?? [] };
    } }, { signal: lifecycle.signal })).catch(() => {}); } catch {}
    return () => lifecycle.abort();
  }, []);

  function discard() { const old = sessionRef.current; if (old) void api(`/cases/${old.id}`, {}, 'DELETE').catch(() => {}); updateSession(undefined); setPatchDraft(''); setReviewed(false); setError(''); }
  function loadExample(example: Example) { if (busy) return; discard(); setBindings({}); setExampleId(example.id); setKind(example.id); setTitle(example.title); setSource(example.source); setInput(JSON.stringify(example.records, null, 2)); setView('work'); setTab('source'); setMobileMenu(false); }
  function edited(which: 'source'|'input', value: string) { discard(); setBindings(previous => ({...previous,[which]:undefined})); setView('work'); which === 'source' ? setSource(value) : setInput(value); }
  async function perform(fn: () => Promise<void>) {
    if (busy) return; setBusy(true); setError('');
    try { await fn(); } catch (error) { setError(error instanceof Error ? error.message : 'The operation failed.'); }
    finally { setBusy(false); void refreshStatus().catch(() => {}); const current = sessionRef.current; if (current) api<CaseView>(`/cases/${current.id}`).then(value => { if (sessionRef.current?.id === current.id) updateSession(value); }).catch(() => {}); }
  }
  async function reproduce() { await perform(async () => {
    let records; try { records = JSON.parse(input); } catch { throw new Error('The input is not valid JSON. Check commas, brackets, and quoted field names.'); }
    const created = await api<CaseView>('/cases', { title, kind, source, records }); updateSession(created); setView('work');
    updateSession(await api<CaseView>(`/cases/${created.id}/reproduce`, {}));
  }); }
  async function generate() { if (!session) return; setView('synthetic'); await perform(async () => updateSession(await api<CaseView>(`/cases/${session.id}/generate`, {}))); }
  async function preview() { if (!session) return; await perform(async () => { updateSession(await api<CaseView>(`/cases/${session.id}/preview`, {})); setReviewed(false); setModal('preview'); }); }
  async function savePatch(origin: 'manual'|'sample', code: string) { if (!session) return; await perform(async () => { updateSession(await api<CaseView>(`/cases/${session.id}/patch`, { source: code, origin })); setPatchDraft(code); setView('patch'); setPatchTab('diff'); }); }
  async function validatePatch() { if (!session) return; await perform(async () => {
    if (patchDraft !== session.patch) updateSession(await api<CaseView>(`/cases/${session.id}/patch`, { source: patchDraft, origin: 'manual' }));
    updateSession(await api<CaseView>(`/cases/${session.id}/validate`, {}));
  }); }
  async function requestPatch() { const request = session?.preview; if (!session || !request || !reviewed) return; setModal(null); setView('patch'); await perform(async () => updateSession(await api<CaseView>(`/cases/${session.id}/${session.automation?.state === 'awaiting-request' ? 'auto/continue' : 'ai-patch'}`, { previewId: request.id, hash: request.hash, reviewed: true }))); }
  async function runAuto() { setModal(null); await perform(async () => {
    let currentSource = source, records: Records;
    try { records = JSON.parse(input); } catch { throw new Error('The input is not valid JSON.'); }
    async function readGitHub(selection: GitHubSelection) { const value = await api<{file?:{content:string}}>('/connectors/github/files',selection); if (!value.file) throw new Error('The connected file is no longer a regular file.'); return value.file.content; }
    if (refreshSources) {
      if (bindings.source) currentSource = await readGitHub(bindings.source);
      if (bindings.input?.service === 'github') { try { records = JSON.parse(await readGitHub(bindings.input.selection)); } catch (e) { throw new Error(`Connected JSON could not be read: ${(e as Error).message}`); } }
      if (bindings.input?.service === 'supabase') {
        const connected = await api<ConnectorStatus>('/connectors');
        if (!connected.supabase.connected || connected.supabase.url !== bindings.input.projectUrl) throw new Error('The Supabase connection changed. Select your records again in Data sources.');
        records = (await api<{records:Records}>('/connectors/supabase/rows',{...bindings.input.selection,expectedUrl:bindings.input.projectUrl})).records;
      }
    }
    setSource(currentSource); setInput(JSON.stringify(records,null,2));
    const created = await api<CaseView>('/cases', {title,kind,source:currentSource,records}); updateSession(created); setView('synthetic');
    const value = await api<CaseView>(`/cases/${created.id}/auto`, {...autoOptions,...(autoOptions.patch === 'model' ? {expectedProvider:status?.model.provider,expectedModel:status?.model.name} : {})}); updateSession(value);
    if (value.automation?.state === 'awaiting-request') { setReviewed(false); setModal('preview'); }
    if (value.patch) setView('patch');
  }); }
  async function patchHash(value: string) { const bytes = new TextEncoder().encode(value); return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(b => b.toString(16).padStart(2,'0')).join(''); }
  async function applyPatch() { if (!session?.patch || !applyReviewed || patchDraft !== session.patch) return; setModal(null); await perform(async () => { const value = await api<CaseView>(`/cases/${session.id}/${session.automation?.state === 'awaiting-apply' ? 'auto/continue' : 'apply'}`, {reviewed:true,hash:await patchHash(session.patch!)}); updateSession(value); setNotice('Validated fixed.py saved locally. GitHub and Supabase unchanged.'); }); }
  async function loadPublicDemo() { const demo = await api<{title:string; kind:CaseKind; source:string; records:Records}>('/demo/retail'); discard(); setBindings({}); setExampleId('custom'); setTitle(demo.title); setKind(demo.kind); setSource(demo.source); setInput(JSON.stringify(demo.records,null,2)); setView('work'); setTab('input'); setModal(null); }
  async function download() { if (!session) return; if (!session.preview) { await preview(); return; } await perform(async () => {
    const response = await fetch(`/api/cases/${session.id}/export`); if (!response.ok) { const data = await response.json(); throw new Error(data.error); }
    const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = 'reprosafe-synthetic-reproducer.zip'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 5000); setNotice('Synthetic reproduction bundle downloaded.');
  }); }
  async function settingsSave(loadModels = false) {
    setSettingsBusy(true); setError('');
    try { const result = await api<AppStatus>('/settings', { provider: providerDraft, ...(keyDraft ? { apiKey: keyDraft } : {}), model: modelDraft }); setKeyDraft(''); setStatus(result); setReviewed(false);
      const current = sessionRef.current; if (current) updateSession({ ...current, preview: undefined });
      if (loadModels) {
        setModels([]); setDiscoveryNote('');
        const result = await api<{provider: Provider; models: ModelOption[]; note: string}>('/models');
        if (result.provider !== providerDraft) throw new Error('Provider changed during discovery. Load models again.');
        setModels(result.models); setDiscoveryNote(result.models.length ? `${result.models.length} models returned. ${result.note}` : 'No supported text-generation models were returned for this key.');
        if (!result.models.some(model => model.id === modelDraft)) setModelDraft('');
      }
      else { setNotice('Connection settings saved for this server session.'); setModal(null); }
    } catch (error) { setError((error as Error).message); } finally { setSettingsBusy(false); }
  }
  async function removeKey() {
    setSettingsBusy(true); setError('');
    try { setStatus(await api<AppStatus>('/settings', {provider: providerDraft, clearKey: true})); setKeyDraft(''); setModels([]); setDiscoveryNote(''); setReviewed(false); const current = sessionRef.current; if (current) updateSession({...current, preview: undefined}); }
    catch (error) { setError((error as Error).message); } finally { setSettingsBusy(false); }
  }
  async function checkRuntime() { setSettingsBusy(true); setError(''); try { setStatus(await api<AppStatus>('/runtime/check', {})); } catch (error) { setError((error as Error).message); } finally { setSettingsBusy(false); } }
  async function importFile(file: File | undefined, which: 'source'|'input') { if (!file) return; if (file.size > 256_000) { setError('Choose a file smaller than 256 KB.'); return; } const value = await file.text(); edited(which, value); setTab(which); setNotice(`${file.name} loaded locally.`); }
  const dirtyPatch = Boolean(session?.patch && patchDraft !== session.patch);
  const allPassed = session?.validation?.length === 4 && session.validation.every(t => t.result.status === 'pass') && !dirtyPatch;
  const matchedExample = examples.find(e => e.id === exampleId && e.source === source);
  const step = session?.candidate ? 3 : session?.original?.status === 'fail' ? 2 : 1;
  const runtimeReady = status?.runtime.state === 'ready';
  const selectedConnection = status?.providers?.[providerDraft];
  const selectedProviderName = modelProviderName(providerDraft);
  const previewProviderName = modelProviderName(session?.preview?.provider);
  const previewCurrent = Boolean(session?.preview && status && session.preview.provider === status.model.provider && session.preview.model === status.model.name);

  return <div className="app-shell">
    <aside className={`sidebar ${mobileMenu ? 'mobile-open' : ''}`}>
      <div className="brand"><ShieldCheck size={25} /><span>ReproSafe</span><button className="icon-button mobile-case-toggle" aria-label="Toggle cases" onClick={() => setMobileMenu(!mobileMenu)}><FolderOpen size={18} /></button></div>
      <div className="sidebar-label">WORKSPACE</div><div className="nav-current"><FolderOpen size={17} /> Cases <span className="nav-count">{exampleId === 'custom' ? 3 : 2}</span></div>
      <button className="new-case-button" disabled={busy} onClick={() => setModal('new')}><Plus size={16} /> New case</button>
      <div className="sidebar-label case-label">DEMONSTRATIONS</div>
      {examples.map(example => <button key={example.id} disabled={busy} className={`case-item ${exampleId === example.id ? 'active' : ''}`} onClick={() => loadExample(example)}><FileCode2 size={17} /><span>{example.title}<small>Synthetic sample data</small></span></button>)}
      {exampleId === 'custom' && <><div className="sidebar-label case-label">YOUR CASE</div><div className="case-item active"><FileCode2 size={17} /><span>{title}<small>Local input</small></span></div></>}
      <div className="sidebar-bottom"><LockKeyhole size={15} /><span>Local workspace<br /><small>Inputs in memory; applied fixes saved locally</small></span></div>
    </aside>
    <main className="main">
      <header className="topbar"><div>Cases <ChevronRight size={14} /><span className="breadcrumb-title">{title}</span></div><div><span className="connection-label">{modelProviderName(status?.model.provider)} {status?.model.configured ? 'configured' : 'not configured'}</span><button className="icon-button" title="Connection settings" aria-label="Connection settings" onClick={() => { setProviderDraft(status?.model.provider ?? 'gemini'); setModelDraft(status?.model.name ?? ''); setKeyDraft(''); setModels([]); setDiscoveryNote(''); setModal('settings'); }}><Settings2 size={18} /></button></div></header>
      <section className="case-header"><div className="case-title-row"><div><div className="eyebrow">PYTHON / JSON</div><h1>{title}</h1></div><button className="icon-button" title="Reset case" aria-label="Reset case" disabled={busy} onClick={() => { discard(); setView('work'); }}><RotateCcw size={17} /></button></div><p>{examples.find(e => e.id === kind)?.description}</p><div className="case-meta"><span className="tag">{exampleId === 'custom' ? 'Local case' : 'Synthetic demo'}</span><span><LockKeyhole size={13} /> Original input stays local</span><span className="case-records">{session?.records.length ?? (() => { try { return JSON.parse(input).length || 0; } catch { return 0; } })()} records</span></div></section>
      {error && <div className="error-banner" role="alert"><CircleAlert size={17} /><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={15} /></button></div>}
      <div className="connection-toolbar"><button disabled={busy || !status} onClick={() => setModal('sources')}><Plug size={16} /> Data sources</button><button disabled={busy || !status} onClick={() => { setAutoOptions({mode:'review',patch:status?.model.configured ? 'model' : 'none',applyLocal:true,consent:false}); setModal('auto'); }}><Zap size={16} /> Auto</button>{session?.automation && <span className="auto-state" role="status">{session.automation.state === 'running' ? session.operation : session.automation.message}</span>}{session?.automation?.state === 'awaiting-request' && <button disabled={busy} onClick={() => { setReviewed(false); setModal('preview'); }}>Review request</button>}{session?.automation?.state === 'awaiting-apply' && <button disabled={busy || dirtyPatch} onClick={() => { setApplyReviewed(false); setView('patch'); setModal('apply'); }}><Save size={15} /> Review & apply</button>}</div>
      {session?.applied && <div className="applied-status"><Check size={16} /><span>Applied locally: <code>{session.applied.path}</code></span><button className="icon-button" title="Copy local patch path" aria-label="Copy local patch path" onClick={() => navigator.clipboard.writeText(session.applied!.path).then(() => setNotice('Local patch path copied.')).catch(() => setError('Clipboard access was unavailable.'))}><Clipboard size={15} /></button></div>}
      <nav className="workflow" aria-label="Reproduction workflow">{([{num:1,label:'Reproduce',page:'work'},{num:2,label:'Create synthetic case',page:'synthetic'},{num:3,label:'Review & patch',page:'patch'}] as const).map((item, i) => <div className="step-wrap" key={item.num}>{i > 0 && <ChevronRight size={15} />}<button className={`${view === item.page ? 'current' : ''} ${step > item.num ? 'completed' : ''}`} disabled={busy || (item.num > step)} onClick={() => setView(item.page)}><b>{step > item.num ? <Check size={13} /> : item.num}</b>{item.label}</button></div>)}<button className={`activity-toggle ${view === 'activity' ? 'current' : ''}`} aria-label="View run history" title="Run history" disabled={!session} onClick={() => setView('activity')}><History size={17} /></button></nav>

      {view === 'work' && <section className="workspace-grid"><div className="editor-pane"><div className="pane-header"><div className="tabs" role="tablist" aria-label="Case files">{['source','input','contract'].map(t => <button role="tab" aria-selected={tab === t} key={t} className={tab === t ? 'selected' : ''} onClick={() => setTab(t)}>{t === 'source' ? 'Source code' : t === 'input' ? 'Private input' : 'Contract'}</button>)}</div><div className="file-tools"><span className="file-label">{tab === 'source' ? 'main.py' : tab === 'input' ? 'input.json' : 'read-only'}</span>{tab !== 'contract' && <button className="icon-button" aria-label={`Import ${tab === 'source' ? 'Python' : 'JSON'} file`} title="Import file" disabled={busy} onClick={() => (tab === 'source' ? fileSource : fileInput).current?.click()}><Upload size={15} /></button>}</div></div>
      {tab === 'contract' ? <div className="contract-copy"><span className="section-caption">ACCEPTANCE CONTRACT</span><p>{contractText[kind]}</p><div className="policy-note"><LockKeyhole size={16} /><span>All supported input values are treated as private. Replacement checks run locally.</span></div></div> : <Code value={tab === 'source' ? source : input} onChange={value => edited(tab as 'source'|'input', value)} label={tab === 'source' ? 'Python source code' : 'JSON input'} disabled={busy} />}
      </div><div className="results-pane"><div className="pane-header"><h2>Execution results</h2>{session?.original ? <span className="muted">{(session.original.durationMs / 1000).toFixed(1)}s</span> : <span className="muted">Not run</span>}</div>
        {session?.original ? <div className="result-content"><div className={`result-heading ${session.original.status === 'fail' ? 'warning' : session.original.status === 'pass' ? 'success-text' : 'danger-text'}`}>{session.original.status === 'pass' ? <CircleCheck size={21} /> : <CircleAlert size={21} />}<h3>{session.original.status === 'fail' ? 'Failure reproduced' : session.original.status === 'pass' ? 'Contract passed' : 'Execution failed'}</h3></div><p className="result-description">{session.original.label}</p><code className="failure-code">{session.original.code}</code><Checks result={session.original} /><div className="result-meta"><span>Runtime</span><strong>Wasmer / Python</strong><span>Guest networking</span><strong>Disabled</strong><span>Model requests</span><strong>None for reproduction</strong></div>{session.original.status === 'pass' && <p className="quiet-note">This input does not fail the selected contract.</p>}</div> : <div className="empty-state">{busy ? <LoaderCircle className="spin" size={30} /> : <FileCode2 size={30} strokeWidth={1.2} />}<h3>{busy ? 'Executing in Wasmer' : 'No execution yet'}</h3><p>{busy ? session?.operation || 'Starting the local Python runtime.' : 'Run the original input to check the failure.'}</p></div>}
      </div></section>}

      {view === 'synthetic' && <section className="workspace-grid"><div className="editor-pane"><div className="pane-header"><h2>Synthetic input</h2><span className="file-label"><Braces size={14} /> synthetic.json</span></div>{session?.candidate ? <><div className="inline-status success-text"><Check size={15} /> Failure preserved with fresh values</div><Code label="Verified synthetic input" value={JSON.stringify(session.candidate.records,null,2)} /></> : <div className="empty-state">{busy ? <LoaderCircle className="spin" size={30} /> : <Braces size={30} strokeWidth={1.2} />}<h3>{busy ? 'Testing replacement candidates' : session?.generationComplete ? 'No releasable reproducer found' : 'Ready to create a synthetic case'}</h3><p>{busy ? session?.operation : session?.generationComplete ? 'The supported replacements could not preserve the failure and pass the field policy.' : 'The original input remains in local memory.'}</p></div>}</div>
      <div className="results-pane"><div className="pane-header"><h2>Candidate checks</h2><span className="muted">{session?.attempts.length ?? 0} tested</span></div><div className="candidate-list">{session?.attempts.map((attempt, i) => <div className="attempt" key={attempt.strategy}><div className="attempt-header"><span className="attempt-number">0{i + 1}</span><h3>{attempt.title}</h3></div><div className={attempt.preserved ? 'success-text attempt-outcome' : 'warning attempt-outcome'}>{attempt.preserved ? <Check size={15} /> : <CircleAlert size={15} />}{attempt.preserved ? 'Original failure preserved' : 'Original failure not preserved'}</div><p>{attempt.result.label}</p><span className="attempt-time">{(attempt.result.durationMs / 1000).toFixed(1)}s &middot; {attempt.result.code}</span></div>)}{busy && <div className="running-line"><LoaderCircle className="spin" size={15} /> {session?.operation || 'Preparing candidates'}</div>}</div>{session?.candidate && <div className="privacy-summary"><LockKeyhole size={18} /><div><h3>Ready for your review</h3><p>Supported field values were replaced. Original strings of four or more characters were checked against the outgoing source and data.</p><small>These checks do not guarantee anonymization.</small></div></div>}{session?.releaseErrors.map(message => <p className="inline-error" key={message}>{message}</p>)}</div></section>}

      {view === 'patch' && <section className="workspace-grid"><div className="editor-pane"><div className="pane-header"><div className="tabs" role="tablist" aria-label="Patch views"><button role="tab" aria-selected={patchTab === 'diff'} className={patchTab === 'diff' ? 'selected' : ''} onClick={() => setPatchTab('diff')}>Changes</button><button role="tab" aria-selected={patchTab === 'edit'} className={patchTab === 'edit' ? 'selected' : ''} onClick={() => setPatchTab('edit')}>Patch editor</button></div><span className="file-label">{session?.patchOrigin === 'gemini' ? 'Gemini proposal' : session?.patchOrigin === 'claude' ? 'Claude proposal' : session?.patchOrigin === 'sample' ? 'Bundled sample patch' : session?.patch ? 'Manual patch' : 'No patch'}</span></div>
        {patchDraft ? patchTab === 'edit' ? <Code value={patchDraft} onChange={setPatchDraft} label="Python patch editor" disabled={busy} /> : <pre className="diff-view" aria-label="Patch changes">{diffLines(source, patchDraft).map((part,i) => <span key={i} className={part.added ? 'diff-added' : part.removed ? 'diff-removed' : ''}>{part.value.split('\n').filter((line,index,array) => line || index < array.length - 1).map((line,j) => <span className="diff-line" key={j}><span className="diff-gutter">{part.added ? '+' : part.removed ? '-' : ' '}</span>{line || ' '}</span>)}</span>)}</pre> : <div className="empty-state"><GitCompareArrows size={30} strokeWidth={1.2} /><h3>{busy ? 'Waiting for a patch' : 'No patch yet'}</h3><p>Review the model request, or enter a patch locally.</p><div className="empty-actions"><button disabled={busy || !session?.candidate} onClick={preview}><ArrowUpRight size={15} /> Review request</button><button disabled={busy} onClick={() => { setPatchDraft(source); setPatchTab('edit'); }}>Enter patch</button></div>{matchedExample && <button className="text-button" disabled={busy} onClick={() => savePatch('sample', matchedExample.patch)}>Load bundled sample fix</button>}</div>}
      </div><div className="results-pane"><div className="pane-header"><h2>Patch validation</h2>{allPassed ? <span className="result-badge pass"><Check size={12} /> 4 / 4 passed</span> : <span className="muted">{dirtyPatch ? 'Patch changed' : session?.validation ? `${session.validation.length} checked` : 'Not validated'}</span>}</div>{session?.validation && !dirtyPatch ? <div className="validation-list">{session.validation.map(test => <div className="validation-item" key={test.title}><div><h3>{test.title}</h3><Badge result={test.result} /></div><p>{test.result.label}</p><Checks result={test.result} /></div>)}{busy && <div className="running-line"><LoaderCircle size={15} className="spin" />{session.operation}</div>}</div> : <div className="empty-state">{busy ? <LoaderCircle className="spin" size={30} /> : <FileCheck2 size={30} strokeWidth={1.2} />}<h3>{busy ? session?.operation : dirtyPatch ? 'Validation is out of date' : 'Four local checks'}</h3><p>Private original, synthetic reproducer, and two regression cases.</p></div>}
      {patchDraft && <div className="patch-actions"><button disabled={busy || !patchDraft.trim()} onClick={validatePatch}><Play size={15} /> Validate patch</button><button disabled={busy} onClick={preview}>Review model request</button>{allPassed && !session?.applied && <button disabled={busy} onClick={() => { setApplyReviewed(false); setModal('apply'); }}><Save size={15} /> Apply locally</button>}</div>}</div></section>}

      {view === 'activity' && <section className="activity-view"><div className="pane-header"><h2>Run history</h2><span className="muted">Local session only</span></div>{session?.events.map((event,i) => <div className="event-row" key={`${event.time}-${i}`}><time>{new Date(event.time).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}</time><span>{event.label}</span><small>{event.detail}</small></div>)}</section>}

      <footer className="actionbar"><span title={status?.runtime.message}><ShieldCheck size={15} className={runtimeReady ? 'success-text' : ''} />{runtimeReady ? 'Wasmer ready' : status?.runtime.state === 'error' ? 'Runtime needs attention' : 'Wasmer local sandbox'}<span className="footer-network">&middot; Guest network disabled</span></span><div className="footer-actions">{busy ? <><span className="running-label"><LoaderCircle className="spin" size={14} /> Running</span><button onClick={() => api('/cancel', {}).catch(e => setError(e.message))}><Square size={13} /> Cancel</button></> : <>{session?.candidate && <button className="icon-button" aria-label="Download synthetic reproducer" title="Download synthetic reproducer" onClick={() => session.preview ? download() : preview()}><Download size={17} /></button>}{view === 'patch' && patchDraft ? <button className="primary-button" onClick={allPassed ? download : validatePatch}>{allPassed ? <Download size={16} /> : <Play size={16} />}{allPassed ? 'Export reproduction' : 'Validate patch'}</button> : session?.candidate ? <button className="primary-button" onClick={preview}><ArrowUpRight size={16} /> Review outgoing request</button> : session?.original?.status === 'fail' ? <button className="primary-button" onClick={generate}><Braces size={16} />{session.generationComplete ? 'Retry synthetic case' : 'Create synthetic case'}</button> : <button className="primary-button" disabled={!status} onClick={reproduce}><Play size={16} /> Reproduce failure</button>}</>}</div></footer>
    </main>
    <input ref={fileSource} className="sr-only" type="file" accept=".py,text/x-python" aria-label="Import Python source" onChange={e => { void importFile(e.target.files?.[0], 'source'); e.target.value = ''; }} />
    <input ref={fileInput} className="sr-only" type="file" accept=".json,application/json" aria-label="Import JSON input" onChange={e => { void importFile(e.target.files?.[0], 'input'); e.target.value = ''; }} />
    {notice && <div className="toast" role="status"><Check size={16} />{notice}</div>}

    {modal === 'sources' && <Modal title="Connected sources" wide onClose={() => setModal(null)}><Sources kind={kind} onSource={(value,label,selection) => { edited('source',value); setBindings(previous => ({...previous,source:selection})); setExampleId('custom'); setNotice(`${label} read locally.`); }} onRecords={(value,label,selection) => { edited('input',JSON.stringify(value,null,2)); setBindings(previous => ({...previous,input:selection})); setExampleId('custom'); setNotice(`${label} read locally.`); }} onDemo={loadPublicDemo} /></Modal>}
    {modal === 'auto' && <Modal title="Auto workflow" onClose={() => setModal(null)}><div className="modal-body">
      <label>Approval mode<select value={autoOptions.mode} onChange={e => setAutoOptions({...autoOptions,mode:e.target.value as AutoOptions['mode'],consent:false})}><option value="review">Human review</option><option value="automatic">Automatic for this run</option></select></label>
      <label>Patch step<select value={autoOptions.patch} onChange={e => setAutoOptions({...autoOptions,patch:e.target.value as AutoOptions['patch'],consent:false})}><option value="none">Prepare reproducer only (no AI)</option><option value="sample" disabled={!examples.some(e => e.id === kind && e.source === source)}>Bundled demo fix (no AI)</option><option value="model" disabled={!status?.model.configured}>{modelProviderName(status?.model.provider)} proposal</option></select></label>
      {(bindings.source || bindings.input) && <label className="checkbox-label"><input type="checkbox" checked={refreshSources} onChange={e => { setRefreshSources(e.target.checked); setAutoOptions({...autoOptions,consent:false}); }} /> Refresh the selected connected files and rows before running</label>}
      {autoOptions.patch !== 'none' && <label className="checkbox-label"><input type="checkbox" checked={autoOptions.applyLocal} onChange={e => setAutoOptions({...autoOptions,applyLocal:e.target.checked,consent:false})} /> Apply validated fix to a new local fixed.py</label>}
      <p className="field-hint">Reproduce, replace values, verify the failure{autoOptions.patch !== 'none' ? ', and validate the patch against four checks' : ''}. GitHub and Supabase stay unchanged. No automatic deployment or merge.</p>
      {autoOptions.mode === 'review' ? <p className="field-hint">Pauses before any model request and before applying a fix.</p> : <label className="checkbox-label"><input type="checkbox" checked={autoOptions.consent} onChange={e => setAutoOptions({...autoOptions,consent:e.target.checked})} /> I authorize this run{autoOptions.patch === 'model' ? ` to send source code and verified replacement input to ${modelProviderName(status?.model.provider)} (${status?.model.name}), using my API quota` : ' without AI'}{autoOptions.applyLocal && autoOptions.patch !== 'none' ? ', then save a local fix only if all four checks pass' : ''}. No further approval prompts.</label>}
      {autoOptions.patch === 'model' && <p className="field-hint">The release scan is limited, not an anonymization guarantee. Use human review for confidential source code.</p>}
    </div><div className="modal-footer"><button onClick={() => setModal(null)}>Cancel</button><button className="primary-button" disabled={busy || autoOptions.mode === 'automatic' && !autoOptions.consent} onClick={runAuto}><Zap size={16} /> Start Auto</button></div></Modal>}
    {modal === 'apply' && session?.patch && <Modal title="Review local file changes" wide onClose={() => setModal(null)}><div className="preview-policy"><LockKeyhole size={16} /><span>A new fixed.py and verification report will be saved under .local/applied. Your original source, GitHub repository, and Supabase database will not change.</span></div><pre className="request-preview">{diffLines(source,session.patch).map((part,i) => <span key={i} className={part.added ? 'diff-added' : part.removed ? 'diff-removed' : ''}>{part.value.split('\n').map((line,j) => <span className="diff-line" key={j}>{part.added ? '+ ' : part.removed ? '- ' : '  '}{line}</span>)}</span>)}</pre><div className="approval-row"><label><input type="checkbox" checked={applyReviewed} onChange={e => setApplyReviewed(e.target.checked)} /> I reviewed this diff and approve saving the verified fix locally.</label></div><div className="modal-footer"><button onClick={() => setModal(null)}>Cancel</button><button className="primary-button" disabled={!applyReviewed || !allPassed || busy} onClick={applyPatch}><Save size={15} /> Apply locally</button></div></Modal>}

    {modal === 'new' && <Modal title="New local case" onClose={() => setModal(null)}><form onSubmit={e => { e.preventDefault(); discard(); setBindings({}); setExampleId('custom'); setKind(newKind); setTitle(newTitle); setSource('def process(records):\n    return []\n'); setInput('[]'); setView('work'); setTab('source'); setModal(null); }}><div className="modal-body"><label>Case name<input value={newTitle} onChange={e => setNewTitle(e.target.value)} maxLength={100} required /></label><label>Acceptance contract<select value={newKind} onChange={e => setNewKind(e.target.value as CaseKind)}><option value="invoices">Invoice customer isolation</option><option value="csv">Quoted CSV import</option></select></label><p className="quiet-note">One Python module with process(records) and a JSON array. Maximum 60 records; supported fields only.</p></div><div className="modal-footer"><button type="button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button" type="submit"><Plus size={16} /> Create case</button></div></form></Modal>}

    {modal === 'settings' && <Modal title="Connection settings" onClose={() => { setModal(null); setKeyDraft(''); }}>
      <div className="modal-body">
        <div className="settings-section">
          <div className="settings-heading"><KeyRound size={18} /><h3>Model connection</h3></div>
          <label>Provider<select value={providerDraft} disabled={settingsBusy || busy} onChange={event => { const next = event.target.value as Provider; setProviderDraft(next); setKeyDraft(''); setModelDraft(status?.providers?.[next]?.name ?? ''); setModels([]); setDiscoveryNote(''); setError(''); }}><option value="gemini">Google Gemini API</option><option value="anthropic">Anthropic Claude API</option></select></label>
          <label>{selectedProviderName} API key<input type="password" autoComplete="off" disabled={settingsBusy || busy} value={keyDraft} onChange={event => setKeyDraft(event.target.value)} placeholder={selectedConnection?.keyPresent ? `A ${selectedProviderName} key is already set` : `Enter your ${selectedProviderName} API key`} /></label>
          <p className="field-hint">Stored in server memory for this session. Never passed into the guest sandbox.</p>
          {providerDraft === 'gemini' && <p className="field-hint"><a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Google AI Studio API keys <ArrowUpRight size={12} /></a><br />Uses the Google Cloud project's API quota and billing.</p>}
          <button disabled={settingsBusy || busy || (!keyDraft.trim() && !selectedConnection?.keyPresent)} onClick={() => settingsSave(true)}>{settingsBusy ? <LoaderCircle className="spin" size={15} /> : <RotateCcw size={15} />} Load available models</button>
          {discoveryNote && <p className="field-hint" role="status">{discoveryNote}</p>}
          <label>Model{models.length ? <select value={modelDraft} disabled={settingsBusy || busy} title={modelDraft} onChange={event => setModelDraft(event.target.value)}><option value="">Select a model</option>{models.map(model => <option key={model.id} value={model.id}>{model.name} ({model.id})</option>)}</select> : <input value={modelDraft} disabled={settingsBusy || busy} onChange={event => setModelDraft(event.target.value)} placeholder="Model ID returned by your provider" />}</label>
          {selectedConnection?.keyPresent && <button className="text-button danger-text" disabled={settingsBusy || busy} onClick={removeKey}>Remove stored {selectedProviderName} key</button>}
        </div>
        <div className="settings-section"><div className="settings-heading"><ShieldCheck size={19} /><h3>Wasmer runtime</h3></div><p className="quiet-note">{status?.runtime.message}</p><div className="runtime-version">{status?.runtime.version}</div><button disabled={settingsBusy || busy} onClick={checkRuntime}>{settingsBusy ? <LoaderCircle className="spin" size={15} /> : <Play size={15} />} Check runtime</button><p className="field-hint">The first run downloads Python. Local execution does not require a Wasmer account token.</p></div>
        {error && <p className="inline-error" role="alert">{error}</p>}
      </div>
      <div className="modal-footer"><button onClick={() => { setModal(null); setKeyDraft(''); }}>Close</button><button className="primary-button" disabled={settingsBusy || busy} onClick={() => settingsSave()}><Check size={15} /> Save settings</button></div>
    </Modal>}

    {modal === 'preview' && session?.preview && <Modal title="Review outgoing request" wide onClose={() => setModal(null)}>
      <div className="preview-meta"><span title={session.preview.destination}><ArrowUpRight size={15} />{new URL(session.preview.destination).host}</span><span>{session.preview.bytes.toLocaleString()} bytes &middot; {session.preview.model || 'No model selected'}</span><button className="icon-button" title="Copy reviewed request" aria-label="Copy reviewed request" onClick={() => navigator.clipboard.writeText(JSON.stringify(session.preview!.payload,null,2)).then(() => setNotice('Reviewed request copied.')).catch(() => setError('Clipboard access was unavailable.'))}><Clipboard size={16} /></button></div>
      <div className="preview-policy"><LockKeyhole size={16} /><span>Original input, execution logs, and the replacement map are excluded. Source code is included; review it for embedded private values.</span></div>
      <div className="request-destination"><span>POST</span><code>{session.preview.destination}</code></div>
      <pre className="request-preview">{JSON.stringify(session.preview.payload,null,2)}</pre><div className="preview-hash">SHA-256 <code>{session.preview.hash}</code></div>
      <div className="approval-row"><label><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} /> I reviewed this exact request and approve sending it to {previewProviderName}.</label></div>
      <div className="modal-footer preview-footer"><button onClick={() => { setModal(null); setView('patch'); }}>{matchedExample ? 'Continue without AI' : 'Enter a manual patch'}</button><button className="primary-button" disabled={!reviewed || !status?.model.configured || !previewCurrent || busy} onClick={requestPatch}><ArrowUpRight size={16} /> Send approved request</button></div>
      {!status?.model.configured && <p className="modal-bottom-note">{modelProviderName(status?.model.provider)} is not configured. Connect an API key in Settings or continue with a manual patch.</p>}
      {status?.model.configured && !previewCurrent && <p className="modal-bottom-note">Connection settings changed. Close this dialog and prepare a fresh request.</p>}
    </Modal>}
  </div>;
}

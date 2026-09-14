import type { CaseKind } from './examples';

export type Records = Record<string, unknown>[];
export interface Execution { state: 'ok' | 'error' | 'timeout'; output?: unknown; errorType?: string; runtimeCode?: string; durationMs: number; resources?: { userCpuMs: number; systemCpuMs: number; maxRssKiB: number }; }
export interface Check { name: string; passed: boolean; }
export interface Assessment { status: 'pass' | 'fail' | 'error'; code: string; label: string; checks: Check[]; durationMs: number; }
export interface Candidate { strategy: string; title: string; records: Records; }
export interface Attempt { title: string; strategy: string; result: Assessment; preserved: boolean; }
export type Provider = 'gemini' | 'anthropic';
export interface AnthropicPayload { model: string; max_tokens: number; system: string; messages: { role: 'user'; content: string }[]; }
export interface GeminiPayload {
  systemInstruction: { parts: { text: string }[] };
  contents: { role: 'user'; parts: { text: string }[] }[];
  generationConfig: { maxOutputTokens: number; responseMimeType: 'application/json'; responseJsonSchema: { type: 'object'; properties: { source: { type: 'string' } }; required: string[]; additionalProperties: false } };
}
interface PreviewBase { id: string; hash: string; model: string; destination: string; bytes: number; createdAt: string; }
export type Preview = PreviewBase & ({ provider: 'anthropic'; payload: AnthropicPayload } | { provider: 'gemini'; payload: GeminiPayload });
export interface ModelOption { id: string; name: string; }
export interface ConnectionStatus { configured: boolean; name: string; keyPresent: boolean; }
export interface CaseView {
  id: string; title: string; kind: CaseKind; source: string; records: Records;
  original?: Assessment; attempts: Attempt[]; candidate?: Candidate;
  preview?: Preview; releaseErrors: string[]; patch?: string; patchOrigin?: 'manual' | 'sample' | 'claude' | 'gemini';
  validation?: { title: string; result: Assessment }[];
  events: { time: string; label: string; detail?: string }[];
  busy: boolean; operation?: string; generationComplete: boolean;
  automation?: AutoRun;
  applied?: { path: string; patchHash: string; appliedAt: string };
}
export interface AutoOptions { mode: 'review' | 'automatic'; patch: 'none' | 'sample' | 'model'; applyLocal: boolean; consent: boolean; expectedProvider?: Provider; expectedModel?: string; }
export interface AutoRun { options: AutoOptions; state: 'running' | 'awaiting-request' | 'awaiting-apply' | 'complete' | 'stopped'; message: string; }
export interface ConnectorStatus { github: { connected: boolean; authenticated: boolean; account: string }; supabase: { connected: boolean; url: string }; }
export interface AppStatus { token: string; runtime: { state: 'idle' | 'checking' | 'ready' | 'error'; message: string; version: string; }; model: ConnectionStatus & { provider: Provider }; providers: Record<Provider, ConnectionStatus>; }

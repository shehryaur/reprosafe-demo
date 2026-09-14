import Anthropic from '@anthropic-ai/sdk';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ModelOption, Preview, Provider } from '../shared/types.ts';
import { CancelledError } from './runner.ts';
import { connectionFailure, diagnosticCode } from './network-errors.ts';

const googleBase = 'https://generativelanguage.googleapis.com/v1beta';
const anthropicBase = 'https://api.anthropic.com';
export const providerLabel = (provider: Provider) => provider === 'gemini' ? 'Gemini' : 'Claude';
export const normalizeModel = (model: string) => model.trim().replace(/^models\//, '');
export function destinationFor(provider: Provider, model: string): string {
  if (model && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(model)) throw new Error('Use a model ID from the available models list.');
  return provider === 'gemini' ? `${googleBase}/models/${model || 'not-selected'}:generateContent` : `${anthropicBase}/v1/messages`;
}
export function previewHash(preview: Pick<Preview, 'provider' | 'model' | 'destination' | 'payload'>): string {
  return createHash('sha256').update(JSON.stringify({ provider: preview.provider, model: preview.model, destination: preview.destination, payload: preview.payload })).digest('hex');
}
export function buildModelPreview(provider: Provider, model: string, system: string, content: string): Preview {
  model = normalizeModel(model);
  const common = { id: randomUUID(), model, destination: destinationFor(provider, model), hash: '', bytes: 0, createdAt: new Date().toISOString() };
  const preview: Preview = provider === 'gemini' ? {
    ...common, provider, payload: {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: content }] }],
      generationConfig: { maxOutputTokens: 8192, responseMimeType: 'application/json', responseJsonSchema: { type: 'object', properties: { source: { type: 'string' } }, required: ['source'], additionalProperties: false } },
    },
  } : { ...common, provider, payload: { model, max_tokens: 2400, system, messages: [{ role: 'user', content }] } };
  preview.bytes = Buffer.byteLength(JSON.stringify(preview.payload));
  preview.hash = previewHash(preview);
  return preview;
}
export function assertPreviewCurrent(preview: Preview, provider: Provider, model: string): void {
  if (preview.provider !== provider || preview.model !== model || preview.destination !== destinationFor(provider, model) || preview.hash !== previewHash(preview)) {
    throw Object.assign(new Error('The provider, model, or request changed. Review a fresh preview.'), { status: 409 });
  }
}
class ProviderError extends Error {
  status: number;
  constructor(message: string, status = 502) { super(message); this.status = status; }
}
const modelPage = z.object({ models: z.array(z.object({ name: z.string(), displayName: z.string().optional(), supportedGenerationMethods: z.array(z.string()).optional() })).default([]), nextPageToken: z.string().optional() });
const googleResponse = z.object({
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
  candidates: z.array(z.object({ finishReason: z.string().optional(), content: z.object({ parts: z.array(z.object({ text: z.string().optional(), thought: z.boolean().optional() })).default([]) }).optional() })).default([]),
});
const patchSchema = z.object({ source: z.string().min(10).max(24000) }).strict();

// Fixed HTTPS destinations and header-only keys keep redirects and URLs from exposing credentials.
async function googleJson(path: string, key: string, options: { body?: unknown; signal?: AbortSignal; timeoutMs?: number } = {}, fetcher: typeof fetch = fetch): Promise<unknown> {
  const signal = AbortSignal.any([AbortSignal.timeout(options.timeoutMs ?? 45_000), ...(options.signal ? [options.signal] : [])]);
  try {
    const response = await fetcher(`${googleBase}${path}`, { method: options.body === undefined ? 'GET' : 'POST', redirect: 'error', signal, headers: { 'x-goog-api-key': key, ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) throw new ProviderError('Google rejected the API key or project access. Check the key, Generative Language API access, and key restrictions.', 400);
      if (response.status === 429) throw new ProviderError('Google reports a quota or rate limit. Check this project in AI Studio and retry later. No automatic retry was made.', 429);
      if (response.status === 404) throw new ProviderError('That Gemini model is unavailable. Refresh the model list and choose another model.', 400);
      if (response.status === 400) throw new ProviderError('Google rejected the request. This model may not support the required JSON output configuration. Choose a different text model.', 400);
      throw new ProviderError('Google could not complete the request. Check service availability and retry later.');
    }
    if (!response.body) throw new ProviderError('Google returned an empty response.');
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0;
    try {
      while (true) { const item = await reader.read(); if (item.done) break; bytes += item.value.byteLength; if (bytes > 1_000_000) { await reader.cancel(); throw new ProviderError('Google response exceeded the local size limit.'); } chunks.push(item.value); }
    } finally { reader.releaseLock(); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ProviderError('Google returned an invalid response.'); }
  } catch (error) {
    if (options.signal?.aborted) throw new CancelledError();
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(connectionFailure('Gemini API', diagnosticCode(error), signal.aborted));
  }
}
export async function listModels(provider: Provider, key: string, fetcher: typeof fetch = fetch): Promise<ModelOption[]> {
  if (provider === 'anthropic') {
    try {
      const client = new Anthropic({ apiKey: key, baseURL: anthropicBase, maxRetries: 0, timeout: 20_000 });
      const result: ModelOption[] = [];
      for await (const model of client.models.list({ limit: 100 })) { result.push({ id: model.id, name: model.display_name }); if (result.length >= 1000) break; }
      return result;
    } catch { throw new ProviderError('Could not list Claude models. Check the API key, account access, and connection. No case data was sent.'); }
  }
  const models = new Map<string, ModelOption>(), seenTokens = new Set<string>();
  let pageToken = '';
  const deadline = Date.now() + 30_000;
  for (let page = 0; page < 20; page++) {
    const query = new URLSearchParams({ pageSize: '100', ...(pageToken ? { pageToken } : {}) });
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new ProviderError('Google model discovery timed out. Retry later.');
    const parsed = modelPage.safeParse(await googleJson(`/models?${query}`, key, { timeoutMs: remaining }, fetcher));
    if (!parsed.success) throw new ProviderError('Google returned an unexpected model catalog.');
    for (const model of parsed.data.models) {
      const id = normalizeModel(model.name);
      if (!/^gemini-[a-zA-Z0-9._-]+$/.test(id) || !model.supportedGenerationMethods?.includes('generateContent') || /(?:image|audio|tts|robotics|computer-use)/i.test(id)) continue;
      models.set(id, { id, name: model.displayName || id });
    }
    pageToken = parsed.data.nextPageToken ?? '';
    if (!pageToken) return [...models.values()].sort((a,b) => a.name.localeCompare(b.name));
    if (seenTokens.has(pageToken)) throw new ProviderError('Google repeated a model catalog page. Retry discovery.');
    seenTokens.add(pageToken);
  }
  throw new ProviderError('The model catalog exceeded the local page limit.');
}
export async function requestModelPatch(preview: Preview, key: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<string> {
  assertPreviewCurrent(preview, preview.provider, preview.model);
  let text: string;
  if (preview.provider === 'gemini') {
    const parsed = googleResponse.safeParse(await googleJson(`/models/${preview.model}:generateContent`, key, { body: preview.payload, signal }, fetcher));
    if (!parsed.success) throw new ProviderError('Gemini returned an unexpected response. No generated code was executed.');
    const candidate = parsed.data.candidates[0];
    if (parsed.data.promptFeedback?.blockReason || !candidate) throw new ProviderError('Gemini did not return a patch. The request may have been blocked. No generated code was executed.');
    if (candidate.finishReason === 'MAX_TOKENS') throw new ProviderError('Gemini reached its output limit. No partial patch was accepted. Choose another model or enter a manual patch.');
    if (candidate.finishReason !== 'STOP') throw new ProviderError('Gemini did not finish a usable response. No generated code was executed.');
    text = candidate.content?.parts.filter(part => !part.thought).map(part => part.text ?? '').join('') ?? '';
  } else {
    const client = new Anthropic({ apiKey: key, baseURL: anthropicBase, maxRetries: 0, timeout: 45_000 });
    let message;
    try { message = await client.messages.create(preview.payload, { signal }); } catch { if (signal.aborted) throw new CancelledError(); throw new ProviderError('Claude request failed. Check account access, credits, and connection. The original fixture was not sent.'); }
    if (message.stop_reason === 'max_tokens') throw new ProviderError('The patch response was truncated. Retry or enter a manual patch.');
    text = message.content.filter(part => part.type === 'text').map(part => part.text).join('');
  }
  try { return patchSchema.parse(JSON.parse(text)).source; } catch { throw new ProviderError(`${providerLabel(preview.provider)} did not return a valid JSON patch. No generated code was executed.`); }
}

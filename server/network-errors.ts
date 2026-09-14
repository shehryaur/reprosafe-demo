const knownCodes = new Set(['EACCES', 'EPERM', 'ERR_ACCESS_DENIED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'RUNTIME_CACHE_INVALID']);

export function diagnosticCode(error: unknown): string | undefined {
  const pending: unknown[] = [error], seen = new Set<unknown>();
  while (pending.length && seen.size < 20) {
    const item = pending.shift();
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);
    const value = item as { code?: unknown; cause?: unknown; errors?: unknown[] };
    if (typeof value.code === 'string' && knownCodes.has(value.code)) return value.code;
    pending.push(value.cause);
    if (Array.isArray(value.errors)) pending.push(...value.errors.slice(0, 10));
  }
  return undefined;
}

export function connectionFailure(service: string, code?: string, timedOut = false): string {
  if (['EACCES', 'EPERM', 'ERR_ACCESS_DENIED'].includes(code ?? '')) return `${service}: the local server is denied network access (${code}). Your browser can still have internet. Restart ReproSafe from its Windows launcher with network permission; a new API key will not fix this.`;
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code ?? '')) return `${service}: the server could not resolve the service address (${code}). Check the computer's DNS or proxy configuration.`;
  if (code?.includes('CERT') || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') return `${service}: the server could not verify the HTTPS certificate (${code}). Check the system clock and trusted certificates. Certificate verification has not been disabled.`;
  if (timedOut || ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT'].includes(code ?? '')) return `${service}: the server connection timed out. No automatic retry was made.`;
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET') return `${service}: the server connection was refused or reset (${code}). Check service access and any configured proxy.`;
  return `${service}: a connection could not be established from the local server. Check its network permissions or proxy settings. No API response was received.`;
}

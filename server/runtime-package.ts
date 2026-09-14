import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const runtimePackage = 'python/python@=3.13.18';
const runtimeHash = '0464f16f1ad0ce4d1ab4266b057b62accd5b4123995a08103897699aefc92a54';
const cachedPackage = fileURLToPath(new URL(`../.wasmer/cache-v1/packages/${runtimeHash}.bin`, import.meta.url));

export function verifyRuntimePackage(bytes: Uint8Array): Uint8Array {
  if (createHash('sha256').update(bytes).digest('hex') !== runtimeHash) throw Object.assign(new Error('The cached Python package failed its integrity check.'), { code: 'RUNTIME_CACHE_INVALID' });
  return bytes;
}

export async function pythonPackage(): Promise<string | Uint8Array> {
  let bytes: Uint8Array;
  try { bytes = await readFile(cachedPackage); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return runtimePackage; throw error; }
  // Raw, hash-verified package bytes avoid registry refreshes after the first download.
  return verifyRuntimePackage(bytes);
}

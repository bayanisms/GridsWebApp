/** Revoke after the browser has had time to start/finish reading the blob download. */
export function deferObjectUrlRevoke(url: string, delayMs = 60_000): void {
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, delayMs);
}

export function downloadTextFile(fileName: string, text: string, mimeType: string): void {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  deferObjectUrlRevoke(url);
}

export function downloadBinaryFile(fileName: string, bytes: Uint8Array, mimeType: string): void {
  // Copy into a standalone ArrayBuffer so Blob/download never depends on a view offset.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  // Some browsers ignore download unless the node is in the document.
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Do NOT revoke on the next microtask — that aborts large WAV downloads mid-stream.
  deferObjectUrlRevoke(url, 120_000);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

export function createDeterministicPrng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

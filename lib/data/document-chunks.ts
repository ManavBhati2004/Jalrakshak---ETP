/* ============================================================
   Pure helpers for compliance-document storage.

   Deliberately separate from `documents.ts`: that module imports the Firebase
   client, which would have to boot just to unit-test a byte split. Everything
   here is dependency-free and directly testable.
   ============================================================ */

/** Well under Firestore's 1 MiB per-document cap, leaving room for the sibling fields. */
export const CHUNK_BYTES = 900_000;
/** Firestore commits cap at ~10 MiB; stay clear of that and of the 500-op batch limit. */
export const BATCH_MAX_BYTES = 6_000_000;
export const BATCH_MAX_OPS = 100;
/** Practical ceiling. Chunking removes the hard limit; this keeps uploads sane. */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/** Human-readable size for UI messages. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 KB";
  return n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Split a byte array into upload-sized pieces. A zero-length input yields a single
 * empty chunk so that `chunkCount` is never 0 — a document with no chunks would be
 * indistinguishable from a torn upload on read.
 */
export function splitChunks(bytes: Uint8Array, chunkBytes: number = CHUNK_BYTES): Uint8Array[] {
  if (!Number.isFinite(chunkBytes) || chunkBytes <= 0) throw new Error("chunkBytes must be > 0");
  const out: Uint8Array[] = [];
  for (let off = 0; off < bytes.length; off += chunkBytes) {
    out.push(bytes.subarray(off, Math.min(off + chunkBytes, bytes.length)));
  }
  return out.length ? out : [new Uint8Array(0)];
}

/** Reassemble chunks in index order. */
export function joinChunks(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Size/extension checks that need no file reading — shared by the upload path and tests. */
export function checkPdfName(name: string, size: number): { ok: true } | { ok: false; error: string } {
  if (!name.toLowerCase().endsWith(".pdf")) return { ok: false, error: "Only PDF files are accepted." };
  if (size === 0) return { ok: false, error: "That file is empty." };
  if (size > MAX_DOCUMENT_BYTES) {
    return { ok: false, error: `File is ${formatBytes(size)} — the limit is ${formatBytes(MAX_DOCUMENT_BYTES)}.` };
  }
  return { ok: true };
}

/** True when the first bytes are the `%PDF` signature. */
export function hasPdfMagic(head: Uint8Array): boolean {
  return head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
}

/** How many chunk-writes fit in one Firestore batch, under BOTH the op and payload limits. */
export function planBatches(sizes: number[]): number[][] {
  const batches: number[][] = [];
  let cur: number[] = [];
  let bytes = 0;
  for (let i = 0; i < sizes.length; i++) {
    if (cur.length > 0 && (bytes + sizes[i] > BATCH_MAX_BYTES || cur.length >= BATCH_MAX_OPS)) {
      batches.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(i);
    bytes += sizes[i];
  }
  if (cur.length) batches.push(cur);
  return batches;
}

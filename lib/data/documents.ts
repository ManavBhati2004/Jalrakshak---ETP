/* ============================================================
   JalRakshak — compliance document storage (CTE / CTO / Authorization / Notice)

   This app is client-only Firebase on the Spark plan: there is no server and no
   Cloud Storage bucket. PDFs are therefore stored in Firestore, split across
   native `Bytes` chunks (NOT base64 — that would inflate every file by a third).

   They live in a SUBCOLLECTION, never inside the tenant's `json` blob, because
   that blob is re-serialized and rewritten on every single store mutation and is
   live-streamed in full to the regulator. A subcollection is invisible to both
   paths: Firestore collection reads never include subcollections.

       industries/{industryId}/docs/{docType}                        <- metadata
       industries/{industryId}/docs/{docType}/chunks/{uploadId}-{n}  <- bytes

   Isolation is enforced by firestore.rules (owner read/write, admin read), not
   by this module. Verified empirically: a cross-tenant read returns
   permission-denied.
   ============================================================ */

import { Bytes, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, setDoc, writeBatch, type Unsubscribe } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { EtpDocumentMeta, EtpDocumentType } from "@/lib/types";

/** Well under Firestore's 1 MiB per-document cap, leaving room for the sibling fields. */
const CHUNK_BYTES = 900_000;
/** Firestore commits cap at ~10 MiB; stay clear of it and of the 500-op batch limit. */
const BATCH_MAX_BYTES = 6_000_000;
const BATCH_MAX_OPS = 100;
/** Practical ceiling. Chunking removes the hard limit; this keeps uploads sane. */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

export type UploadResult = { ok: true; meta: EtpDocumentMeta } | { ok: false; error: string };

const metaRef = (industryId: string, docType: EtpDocumentType) => doc(db, "industries", industryId, "docs", docType);
const chunksCol = (industryId: string, docType: EtpDocumentType) => collection(db, "industries", industryId, "docs", docType, "chunks");

/** Human-readable size for messages. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 KB";
  return n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Validate before touching the network. Checks extension, MIME and the actual `%PDF`
 * magic bytes — a renamed .docx is rejected rather than stored as a broken "PDF".
 * Client-side only, and therefore advisory: there is no server to re-check it.
 */
export async function validatePdf(file: File): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!file.name.toLowerCase().endsWith(".pdf")) return { ok: false, error: "Only PDF files are accepted." };
  if (file.type && file.type !== "application/pdf") return { ok: false, error: `Expected a PDF, got "${file.type}".` };
  if (file.size === 0) return { ok: false, error: "That file is empty." };
  if (file.size > MAX_DOCUMENT_BYTES) {
    return { ok: false, error: `File is ${formatBytes(file.size)} — the limit is ${formatBytes(MAX_DOCUMENT_BYTES)}.` };
  }
  try {
    const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    // "%PDF-"
    if (head[0] !== 0x25 || head[1] !== 0x50 || head[2] !== 0x44 || head[3] !== 0x46) {
      return { ok: false, error: "That file is not a valid PDF (missing PDF header)." };
    }
  } catch {
    return { ok: false, error: "Could not read the file." };
  }
  return { ok: true };
}

/** Split a byte array into upload-sized pieces. Exported for tests. */
export function splitChunks(bytes: Uint8Array, chunkBytes: number = CHUNK_BYTES): Uint8Array[] {
  if (chunkBytes <= 0) throw new Error("chunkBytes must be > 0");
  const out: Uint8Array[] = [];
  for (let off = 0; off < bytes.length; off += chunkBytes) out.push(bytes.subarray(off, Math.min(off + chunkBytes, bytes.length)));
  return out.length ? out : [new Uint8Array(0)];
}

/** Reassemble chunks in index order. Exported for tests. */
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

/**
 * Upload (or replace) one document.
 *
 * Replacement is deliberately ordered so a reader never sees a torn file: the NEW
 * chunks are written first under a fresh uploadId, the metadata is flipped to point
 * at them, and only then are the old chunks deleted. A failed upload leaves the
 * previous document intact and simply orphans some chunks.
 */
export async function uploadDocument(input: {
  industryId: string;
  docType: EtpDocumentType;
  file: File;
  uploadedByUid: string;
  onProgress?: (fraction: number) => void;
}): Promise<UploadResult> {
  const { industryId, docType, file, uploadedByUid, onProgress } = input;

  const valid = await validatePdf(file);
  if (!valid.ok) return valid;

  try {
    const previous = await getDoc(metaRef(industryId, docType));
    const prev = previous.exists() ? (previous.data() as EtpDocumentMeta) : null;

    const bytes = new Uint8Array(await file.arrayBuffer());
    const parts = splitChunks(bytes);
    // Unique per upload; also what makes replacement atomic.
    const uploadId = `u${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

    // 1. write the new chunks, batched under both the op and payload limits
    let batch = writeBatch(db);
    let batchBytes = 0;
    let batchOps = 0;
    let written = 0;
    for (let i = 0; i < parts.length; i++) {
      if (batchOps > 0 && (batchBytes + parts[i].length > BATCH_MAX_BYTES || batchOps >= BATCH_MAX_OPS)) {
        await batch.commit();
        batch = writeBatch(db);
        batchBytes = 0;
        batchOps = 0;
      }
      batch.set(doc(chunksCol(industryId, docType), `${uploadId}-${i}`), { i, data: Bytes.fromUint8Array(parts[i]) });
      batchBytes += parts[i].length;
      batchOps += 1;
      written += 1;
      onProgress?.(Math.min(0.95, written / (parts.length + 1)));
    }
    if (batchOps > 0) await batch.commit();

    // 2. flip the metadata to the new upload — this is the commit point
    const meta: EtpDocumentMeta = {
      docType,
      filename: file.name,
      size: file.size,
      contentType: "application/pdf",
      uploadId,
      chunkCount: parts.length,
      uploadedAt: new Date().toISOString(),
      uploadedByUid,
      complete: true,
    };
    await setDoc(metaRef(industryId, docType), meta);
    onProgress?.(1);

    // 3. only now retire the previous chunks; failure here is harmless litter
    if (prev?.uploadId && prev.uploadId !== uploadId) {
      await Promise.all(
        Array.from({ length: prev.chunkCount ?? 0 }, (_, i) =>
          deleteDoc(doc(chunksCol(industryId, docType), `${prev.uploadId}-${i}`)).catch(() => {}),
        ),
      );
    }
    return { ok: true, meta };
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    if (code === "permission-denied") return { ok: false, error: "You do not have permission to upload for this unit." };
    return { ok: false, error: "Upload failed. Check your connection and try again." };
  }
}

/** All four slots' metadata for a unit, keyed by docType. Missing = not uploaded. */
export async function listDocuments(industryId: string): Promise<Partial<Record<EtpDocumentType, EtpDocumentMeta>>> {
  const out: Partial<Record<EtpDocumentType, EtpDocumentMeta>> = {};
  try {
    const snap = await getDocs(collection(db, "industries", industryId, "docs"));
    snap.forEach((d) => {
      const m = d.data() as EtpDocumentMeta;
      if (m?.complete) out[d.id as EtpDocumentType] = m;
    });
  } catch {
    // best-effort: an unreadable unit simply shows nothing uploaded
  }
  return out;
}

/** Live view of a unit's documents. */
export function subscribeDocuments(industryId: string, onData: (docs: Partial<Record<EtpDocumentType, EtpDocumentMeta>>) => void): Unsubscribe {
  return onSnapshot(
    collection(db, "industries", industryId, "docs"),
    (snap) => {
      const out: Partial<Record<EtpDocumentType, EtpDocumentMeta>> = {};
      snap.forEach((d) => {
        const m = d.data() as EtpDocumentMeta;
        if (m?.complete) out[d.id as EtpDocumentType] = m;
      });
      onData(out);
    },
    () => onData({}),
  );
}

/** Fetch and reassemble a stored PDF. Returns null when absent or unreadable. */
export async function fetchDocumentBlob(industryId: string, docType: EtpDocumentType): Promise<{ blob: Blob; meta: EtpDocumentMeta } | null> {
  try {
    const metaSnap = await getDoc(metaRef(industryId, docType));
    if (!metaSnap.exists()) return null;
    const meta = metaSnap.data() as EtpDocumentMeta;
    if (!meta.complete || !meta.uploadId) return null;

    const parts = await Promise.all(
      Array.from({ length: meta.chunkCount }, async (_, i) => {
        const c = await getDoc(doc(chunksCol(industryId, docType), `${meta.uploadId}-${i}`));
        const raw = c.exists() ? (c.data().data as Bytes | undefined) : undefined;
        return raw ? raw.toUint8Array() : null;
      }),
    );
    // A missing chunk means the stored file is incomplete — never serve a corrupt PDF.
    if (parts.some((p) => p == null)) return null;
    const bytes = joinChunks(parts as Uint8Array[]);
    return { blob: new Blob([bytes as unknown as BlobPart], { type: meta.contentType || "application/pdf" }), meta };
  } catch {
    return null;
  }
}

/** Remove a document and all of its chunks. */
export async function deleteDocument(industryId: string, docType: EtpDocumentType): Promise<boolean> {
  try {
    const snap = await getDoc(metaRef(industryId, docType));
    const meta = snap.exists() ? (snap.data() as EtpDocumentMeta) : null;
    await deleteDoc(metaRef(industryId, docType));
    if (meta?.uploadId) {
      await Promise.all(
        Array.from({ length: meta.chunkCount ?? 0 }, (_, i) =>
          deleteDoc(doc(chunksCol(industryId, docType), `${meta.uploadId}-${i}`)).catch(() => {}),
        ),
      );
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Open in a new tab (view) or save to disk (download). Mirrors the download helper in
 * `excel-export.ts` — body-append before click and a delayed revoke, which the older
 * CSV helpers get wrong.
 */
export function presentBlob(blob: Blob, filename: string, mode: "view" | "download") {
  const url = URL.createObjectURL(blob);
  if (mode === "view") {
    const w = window.open(url, "_blank", "noopener,noreferrer");
    // Popup blocked → fall back to a download so the click is never silently lost.
    if (!w) presentBlob(blob, filename, "download");
  } else {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

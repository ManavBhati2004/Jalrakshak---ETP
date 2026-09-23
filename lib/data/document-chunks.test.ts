import { describe, it, expect } from "vitest";
import {
  BATCH_MAX_OPS,
  CHUNK_BYTES,
  MAX_DOCUMENT_BYTES,
  checkPdfName,
  formatBytes,
  hasPdfMagic,
  joinChunks,
  planBatches,
  splitChunks,
} from "./document-chunks";

/** Deterministic pseudo-random bytes — no Math.random, so failures reproduce. */
const bytes = (n: number, seed = 7): Uint8Array => {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out[i] = x & 0xff;
  }
  return out;
};

describe("splitChunks / joinChunks — byte-exact round trip", () => {
  it("round-trips a file that is NOT a multiple of the chunk size", () => {
    const src = bytes(2500);
    const parts = splitChunks(src, 1000);
    expect(parts.map((p) => p.length)).toEqual([1000, 1000, 500]);
    expect(Array.from(joinChunks(parts))).toEqual(Array.from(src));
  });

  it("round-trips a file that is an exact multiple", () => {
    const src = bytes(3000);
    const parts = splitChunks(src, 1000);
    expect(parts).toHaveLength(3);
    expect(Array.from(joinChunks(parts))).toEqual(Array.from(src));
  });

  it("round-trips a file smaller than one chunk", () => {
    const src = bytes(17);
    const parts = splitChunks(src, 1000);
    expect(parts).toHaveLength(1);
    expect(Array.from(joinChunks(parts))).toEqual(Array.from(src));
  });

  it("an empty file still yields ONE chunk, never zero", () => {
    // chunkCount 0 would be indistinguishable from a torn upload on read.
    const parts = splitChunks(new Uint8Array(0), 1000);
    expect(parts).toHaveLength(1);
    expect(joinChunks(parts).length).toBe(0);
  });

  it("every chunk fits inside Firestore's 1 MiB document cap", () => {
    const parts = splitChunks(bytes(5_000_000), CHUNK_BYTES);
    expect(CHUNK_BYTES).toBeLessThan(1_048_576);
    expect(Math.max(...parts.map((p) => p.length))).toBeLessThanOrEqual(CHUNK_BYTES);
  });

  it("rejects a non-positive chunk size rather than looping forever", () => {
    expect(() => splitChunks(bytes(10), 0)).toThrow();
    expect(() => splitChunks(bytes(10), -1)).toThrow();
  });
});

describe("planBatches — stays under Firestore's commit limits", () => {
  it("groups small chunks up to the op limit", () => {
    const groups = planBatches(new Array(250).fill(1000));
    expect(Math.max(...groups.map((g) => g.length))).toBeLessThanOrEqual(BATCH_MAX_OPS);
    expect(groups.flat()).toHaveLength(250);
  });

  it("splits on the payload limit before the op limit", () => {
    // 10 chunks x 900 KB = 9 MB, over the 6 MB batch budget.
    const groups = planBatches(new Array(10).fill(900_000));
    expect(groups.length).toBeGreaterThan(1);
    for (const g of groups) expect(g.reduce((n, i) => n + 900_000, 0)).toBeLessThanOrEqual(6_000_000);
  });

  it("covers every chunk exactly once, in order", () => {
    const groups = planBatches([100, 200, 300, 400]);
    expect(groups.flat()).toEqual([0, 1, 2, 3]);
  });

  it("an oversized single chunk still gets its own batch", () => {
    const groups = planBatches([9_000_000]);
    expect(groups).toEqual([[0]]);
  });

  it("no chunks -> no batches", () => {
    expect(planBatches([])).toEqual([]);
  });
});

describe("PDF validation", () => {
  it("accepts a .pdf of sane size", () => {
    expect(checkPdfName("consent.pdf", 1234).ok).toBe(true);
    expect(checkPdfName("CONSENT.PDF", 1234).ok).toBe(true);
  });
  it("rejects a non-pdf extension", () => {
    const r = checkPdfName("notice.docx", 1234);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Only PDF/i);
  });
  it("rejects an empty file", () => {
    expect(checkPdfName("a.pdf", 0).ok).toBe(false);
  });
  it("rejects a file over the ceiling", () => {
    expect(checkPdfName("a.pdf", MAX_DOCUMENT_BYTES + 1).ok).toBe(false);
    expect(checkPdfName("a.pdf", MAX_DOCUMENT_BYTES).ok).toBe(true);
  });
  it("detects the %PDF signature and rejects a renamed file", () => {
    expect(hasPdfMagic(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe(true); // "%PDF-"
    expect(hasPdfMagic(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(false); // a zip / .docx
    expect(hasPdfMagic(new Uint8Array([]))).toBe(false);
  });
});

describe("formatBytes", () => {
  it("uses KB below a megabyte and MB above", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(512 * 1024)).toBe("512 KB");
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MB");
  });
  it("guards non-finite and non-positive input", () => {
    expect(formatBytes(0)).toBe("0 KB");
    expect(formatBytes(NaN)).toBe("0 KB");
    expect(formatBytes(-5)).toBe("0 KB");
  });
});

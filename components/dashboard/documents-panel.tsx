"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Upload, Eye, Download, CheckCircle2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ETP_DOCUMENT_TYPES, type EtpDocumentMeta, type EtpDocumentType } from "@/lib/types";
import { fetchDocumentBlob, formatBytes, presentBlob, subscribeDocuments, uploadDocument, MAX_DOCUMENT_BYTES } from "@/lib/data/documents";
import { formatDate } from "@/lib/utils";

/**
 * The four RSPCB compliance documents for one unit.
 *
 * Used by BOTH roles from the surface each already occupies — the operator's own
 * dashboard and the Monitoring Body's per-unit detail view — so no new route is
 * needed (and `canAccessPath`, which is exclusive in both directions, is never in
 * the way). `canUpload` is the only behavioural difference; tenant isolation itself
 * is enforced by firestore.rules, not by this prop.
 */
export function DocumentsPanel({
  industryId,
  industryName,
  canUpload,
  uid,
}: {
  industryId: string;
  industryName: string;
  canUpload: boolean;
  uid?: string | null;
}) {
  const [docs, setDocs] = useState<Partial<Record<EtpDocumentType, EtpDocumentMeta>>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<EtpDocumentType | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!industryId) return;
    setLoading(true);
    const unsub = subscribeDocuments(industryId, (d) => {
      setDocs(d);
      setLoading(false);
    });
    return () => unsub();
  }, [industryId]);

  const open = useCallback(
    async (docType: EtpDocumentType, mode: "view" | "download") => {
      setBusy(docType);
      try {
        const got = await fetchDocumentBlob(industryId, docType);
        if (!got) {
          toast.error("Could not open the document", { description: "It may still be uploading, or was removed." });
          return;
        }
        presentBlob(got.blob, got.meta.filename, mode);
      } finally {
        setBusy(null);
      }
    },
    [industryId],
  );

  const onPick = useCallback(
    async (docType: EtpDocumentType, file: File | undefined) => {
      if (!file || !uid) return;
      setBusy(docType);
      setProgress(0);
      const res = await uploadDocument({ industryId, docType, file, uploadedByUid: uid, onProgress: setProgress });
      setBusy(null);
      setProgress(0);
      if (!res.ok) toast.error("Upload failed", { description: res.error });
      else toast.success("Document uploaded", { description: `${res.meta.filename} · ${formatBytes(res.meta.size)}` });
    },
    [industryId, uid],
  );

  const uploadedCount = ETP_DOCUMENT_TYPES.filter((t) => docs[t.code]).length;

  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-display text-lg font-bold text-foreground">
            <FileText className="h-5 w-5 text-primary" /> Compliance Documents
          </h3>
          <p className="text-sm text-muted-foreground">
            {canUpload ? "Upload and keep this unit's statutory PDFs current." : `Statutory PDFs on file for ${industryName}.`}
          </p>
        </div>
        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
          {loading ? "Loading…" : `${uploadedCount} of ${ETP_DOCUMENT_TYPES.length} on file`}
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {ETP_DOCUMENT_TYPES.map((t) => (
          <DocumentSlot
            key={t.code}
            type={t}
            meta={docs[t.code]}
            loading={loading}
            busy={busy === t.code}
            progress={busy === t.code ? progress : 0}
            canUpload={canUpload}
            onOpen={(mode) => open(t.code, mode)}
            onPick={(f) => onPick(t.code, f)}
          />
        ))}
      </div>

      {canUpload ? (
        <p className="mt-3 text-[11px] text-muted-foreground">
          PDF only, up to {formatBytes(MAX_DOCUMENT_BYTES)}. Uploading again replaces the stored file; the previous one is kept until the new upload succeeds.
        </p>
      ) : null}
    </div>
  );
}

function DocumentSlot({
  type,
  meta,
  loading,
  busy,
  progress,
  canUpload,
  onOpen,
  onPick,
}: {
  type: { code: EtpDocumentType; label: string; hint: string };
  meta?: EtpDocumentMeta;
  loading: boolean;
  busy: boolean;
  progress: number;
  canUpload: boolean;
  onOpen: (mode: "view" | "download") => void;
  onPick: (file: File | undefined) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const uploaded = !!meta;

  return (
    <div className={`rounded-xl border p-3 transition-colors ${uploaded ? "border-primary/40 bg-primary/5" : "border-dashed border-border bg-muted/20"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{type.label}</p>
          <p className="truncate text-[11px] text-muted-foreground">{type.hint}</p>
        </div>
        {loading ? (
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">…</span>
        ) : uploaded ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-600">
            <CheckCircle2 className="h-3 w-3" /> Uploaded
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600">
            <TriangleAlert className="h-3 w-3" /> Not Uploaded
          </span>
        )}
      </div>

      <p className="mt-2 min-h-[2.25rem] text-[11px] text-muted-foreground">
        {loading ? (
          "Checking…"
        ) : meta ? (
          <>
            <span className="block truncate font-medium text-foreground">{meta.filename}</span>
            Last updated {formatDate(meta.uploadedAt)} · {formatBytes(meta.size)}
          </>
        ) : (
          "No file on record for this unit."
        )}
      </p>

      {busy && progress > 0 ? (
        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {uploaded ? (
          <>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => onOpen("view")} className="h-8 gap-1.5 rounded-lg">
              <Eye className="h-3.5 w-3.5" /> View
            </Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => onOpen("download")} className="h-8 gap-1.5 rounded-lg">
              <Download className="h-3.5 w-3.5" /> Download
            </Button>
          </>
        ) : null}
        {canUpload ? (
          <>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              aria-label={`Upload ${type.label}`}
              onChange={(e) => {
                onPick(e.target.files?.[0]);
                e.target.value = ""; // allow re-picking the same filename
              }}
            />
            <Button
              size="sm"
              variant={uploaded ? "outline" : "default"}
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              className="h-8 gap-1.5 rounded-lg"
            >
              <Upload className={`h-3.5 w-3.5${busy ? " animate-pulse" : ""}`} />
              {busy ? "Uploading…" : uploaded ? "Replace" : "Upload PDF"}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

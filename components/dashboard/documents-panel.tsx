"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Upload, Eye, Download, CheckCircle2, TriangleAlert, MessageSquare, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DOCUMENT_REVIEW_STATUSES,
  ETP_DOCUMENT_TYPES,
  REVIEWED_DOCUMENT_TYPES,
  type DocumentReviewStatus,
  type EtpDocumentMeta,
  type EtpDocumentReview,
  type EtpDocumentType,
} from "@/lib/types";
import {
  fetchDocumentBlob,
  formatBytes,
  presentBlob,
  saveDocumentRemark,
  saveDocumentReview,
  subscribeDocumentReviews,
  subscribeDocuments,
  uploadDocument,
  MAX_DOCUMENT_BYTES,
  MAX_REMARK_CHARS,
} from "@/lib/data/documents";
import { formatDate } from "@/lib/utils";

/**
 * The four RSPCB compliance documents for one unit.
 *
 * Used by BOTH roles: the operator's own dashboard, and the Monitoring Body's
 * per-unit detail view and Documents page. `canUpload` (the operator) and `canReview`
 * (the Monitoring Body, who sets the status and remark the unit then reads) are the
 * only behavioural differences; tenant isolation itself is enforced by firestore.rules,
 * not by these props.
 */
export function DocumentsPanel({
  industryId,
  industryName,
  canUpload,
  canReview = false,
  uid,
}: {
  industryId: string;
  industryName: string;
  canUpload: boolean;
  canReview?: boolean;
  uid?: string | null;
}) {
  const [docs, setDocs] = useState<Partial<Record<EtpDocumentType, EtpDocumentMeta>>>({});
  const [reviews, setReviews] = useState<Partial<Record<EtpDocumentType, EtpDocumentReview>>>({});
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<EtpDocumentType | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!industryId) return;
    setLoading(true);
    setFailed(false);
    const unsub = subscribeDocuments(
      industryId,
      (d) => {
        setDocs(d);
        setFailed(false);
        setLoading(false);
      },
      () => {
        setFailed(true);
        setLoading(false);
      },
    );
    const unsubReviews = subscribeDocumentReviews(industryId, setReviews);
    return () => {
      unsub();
      unsubReviews();
    };
  }, [industryId]);

  const open = useCallback(
    async (docType: EtpDocumentType, mode: "view" | "download") => {
      // Opened now, on the click: a popup blocker would stop a tab opened once the file has loaded.
      const tab = mode === "view" ? window.open("", "_blank") : null;
      setBusy(docType);
      try {
        const got = await fetchDocumentBlob(industryId, docType);
        if (!got) {
          tab?.close();
          toast.error("Could not open the document", { description: "It may still be uploading, or was removed." });
          return;
        }
        presentBlob(got.blob, got.meta.filename, tab);
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

  const onSaveRemark = useCallback(
    async (docType: EtpDocumentType, remark: string) => {
      if (!uid) return;
      const res = await saveDocumentRemark(industryId, docType, remark, uid);
      if (!res.ok) toast.error("Remark not saved", { description: res.error });
      else toast.success(remark.trim() ? "Remark saved" : "Remark cleared");
    },
    [industryId, uid],
  );

  const onSaveReview = useCallback(
    async (docType: EtpDocumentType, status: DocumentReviewStatus, remark: string) => {
      const res = await saveDocumentReview(industryId, docType, status, remark);
      if (!res.ok) toast.error("Status not saved", { description: res.error });
      else toast.success("Status saved", { description: "The unit now sees this status and remark." });
    },
    [industryId],
  );

  // A slot counts as "on file" only when it holds a PDF - a remark alone is not a document.
  const uploadedCount = ETP_DOCUMENT_TYPES.filter((t) => docs[t.code]?.complete).length;

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
          {loading ? "Loading…" : failed ? "Not loaded" : `${uploadedCount} of ${ETP_DOCUMENT_TYPES.length} on file`}
        </span>
      </div>

      {failed ? (
        <p className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700">
          Could not load documents. Check your connection and reload the page.
        </p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {ETP_DOCUMENT_TYPES.map((t) => (
            <DocumentSlot
              key={t.code}
              type={t}
              meta={docs[t.code]}
              review={reviews[t.code]}
              loading={loading}
              busy={busy === t.code}
              progress={busy === t.code ? progress : 0}
              canUpload={canUpload}
              canReview={canReview}
              onOpen={(mode) => open(t.code, mode)}
              onPick={(f) => onPick(t.code, f)}
              onSaveRemark={(r) => onSaveRemark(t.code, r)}
              onSaveReview={(s, r) => onSaveReview(t.code, s, r)}
            />
          ))}
        </div>
      )}

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
  review,
  loading,
  busy,
  progress,
  canUpload,
  canReview,
  onOpen,
  onPick,
  onSaveRemark,
  onSaveReview,
}: {
  type: { code: EtpDocumentType; label: string; hint: string };
  meta?: EtpDocumentMeta;
  review?: EtpDocumentReview;
  loading: boolean;
  busy: boolean;
  progress: number;
  canUpload: boolean;
  canReview: boolean;
  onOpen: (mode: "view" | "download") => void;
  onPick: (file: File | undefined) => void;
  onSaveRemark: (remark: string) => Promise<void>;
  onSaveReview: (status: DocumentReviewStatus, remark: string) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // A remark-only slot has metadata but no PDF, so the file controls key off `complete`.
  const uploaded = !!meta?.complete;
  const savedRemark = meta?.remark ?? "";
  const [remark, setRemark] = useState(savedRemark);
  const [savingRemark, setSavingRemark] = useState(false);
  // Re-sync when another device edits the same slot, but never clobber an in-progress edit.
  const lastSaved = useRef(savedRemark);
  useEffect(() => {
    if (savedRemark !== lastSaved.current) {
      lastSaved.current = savedRemark;
      setRemark(savedRemark);
    }
  }, [savedRemark]);
  const dirty = remark.trim() !== savedRemark.trim();

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
        ) : uploaded && meta ? (
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

      {REVIEWED_DOCUMENT_TYPES.includes(type.code) ? (
        // Keyed on the saved version, so a new save shows at once rather than the old typing.
        <ReviewBlock key={review?.at ?? "none"} label={type.label} review={review} canReview={canReview} onSave={onSaveReview} />
      ) : null}

      {/* Remark — status, validity, pending requirements, notice details. Deliberately usable on
          a slot with no PDF yet, which is exactly when "renewal pending" needs recording. */}
      <div className="mt-3 border-t border-border/60 pt-3">
        <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <MessageSquare className="h-3 w-3" /> {canUpload ? "Remark" : "Unit's remark"}
        </p>
        {canUpload ? (
          <>
            <textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value.slice(0, MAX_REMARK_CHARS))}
              rows={2}
              aria-label={`Remark for ${type.label}`}
              placeholder="Status, validity, pending requirements, notice details…"
              className="w-full resize-y rounded-lg border border-border bg-background px-2 py-1.5 text-xs outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50"
            />
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="text-[10px] text-muted-foreground">
                {meta?.remarkAt ? `Updated ${formatDate(meta.remarkAt)}` : "Not set"}
              </span>
              {/* Only on an actual change — saving per keystroke would write to Firestore per character. */}
              {dirty ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={savingRemark}
                  onClick={async () => {
                    setSavingRemark(true);
                    try {
                      await onSaveRemark(remark);
                    } finally {
                      setSavingRemark(false);
                    }
                  }}
                  className="h-7 gap-1.5 rounded-lg"
                >
                  <Save className="h-3 w-3" /> {savingRemark ? "Saving…" : "Save Remark"}
                </Button>
              ) : null}
            </div>
          </>
        ) : savedRemark ? (
          <p className="whitespace-pre-wrap text-xs text-foreground">
            {savedRemark}
            {meta?.remarkAt ? <span className="mt-1 block text-[10px] text-muted-foreground">Updated {formatDate(meta.remarkAt)}</span> : null}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">No remark recorded.</p>
        )}
      </div>
    </div>
  );
}

/**
 * The Monitoring Body's status and remark on one consent or authorization: a form for the Monitoring
 * Body, the latest values for the unit. Usable with no PDF on file, since "Applied" often means that.
 */
function ReviewBlock({
  label,
  review,
  canReview,
  onSave,
}: {
  label: string;
  review?: EtpDocumentReview;
  canReview: boolean;
  onSave: (status: DocumentReviewStatus, remark: string) => Promise<void>;
}) {
  const [status, setStatus] = useState<DocumentReviewStatus | "">(review?.status ?? "");
  const [remark, setRemark] = useState(review?.remark ?? "");
  const [saving, setSaving] = useState(false);
  const dirty = status !== (review?.status ?? "") || remark.trim() !== (review?.remark ?? "");
  const shown = DOCUMENT_REVIEW_STATUSES.find((s) => s.code === review?.status)?.label;

  return (
    <div className="mt-3 border-t border-border/60 pt-3">
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <ShieldCheck className="h-3 w-3" /> Monitoring Body status
      </p>
      {canReview ? (
        <>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as DocumentReviewStatus | "")}
            aria-label={`Status of ${label}`}
            className="h-8 w-full rounded-lg border border-border bg-background px-2 text-xs outline-none focus:border-primary/50"
          >
            <option value="">Choose a status…</option>
            {DOCUMENT_REVIEW_STATUSES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.label}
              </option>
            ))}
          </select>
          <textarea
            value={remark}
            onChange={(e) => setRemark(e.target.value.slice(0, MAX_REMARK_CHARS))}
            rows={2}
            aria-label={`Monitoring Body remark for ${label}`}
            placeholder="Remark for the unit…"
            className="mt-1.5 w-full resize-y rounded-lg border border-border bg-background px-2 py-1.5 text-xs outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50"
          />
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="text-[10px] text-muted-foreground">{review?.at ? `Updated ${formatDate(review.at)}` : "Not set"}</span>
            {dirty && status ? (
              <Button
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await onSave(status, remark);
                  } finally {
                    setSaving(false);
                  }
                }}
                className="h-7 gap-1.5 rounded-lg"
              >
                <Save className="h-3 w-3" /> {saving ? "Saving…" : "Save Status"}
              </Button>
            ) : null}
          </div>
        </>
      ) : shown ? (
        <div className="text-xs text-foreground">
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
              review?.status === "APPLIED" ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"
            }`}
          >
            {shown}
          </span>
          {review?.remark ? <p className="mt-1 whitespace-pre-wrap">{review.remark}</p> : null}
          {review?.at ? <span className="mt-1 block text-[10px] text-muted-foreground">Updated {formatDate(review.at)}</span> : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No status set yet.</p>
      )}
    </div>
  );
}

import { describe, it, expect } from "vitest";
import {
  approveCandidatesInSlice,
  decidedApproval,
  eligibleApprovalCandidates,
  isPendingStage,
  entryRevision,
  type ApprovalCandidate,
} from "./approval-decisions";
import type { Approval, EtpEntry } from "@/lib/types";

const entry = (id: string, over: Partial<EtpEntry> = {}): EtpEntry => ({
  id, industryId: "IND-1", industryName: "X", date: "2026-10-01",
  freshWaterConsumption: 0, etpInlet: 0, etpOutlet: 0, etpReuse: 0, roInlet: 0, roReject: 0, roPermeate: 0,
  sludgeToTSDF: 0, totalWaterIntake: 0, unit: "KL", status: "pending", submittedAt: "2026-10-01T09:00:00.000Z",
  entryStatus: "SUBMITTED",
  ...over,
});

const approval = (id: string, readingId: string, over: Partial<Approval> = {}): Approval => ({
  id, readingId, industryId: "IND-1", industryName: "X", cetpId: null, meterPoint: "ETP Water Balance",
  difference: 0, unit: "KL", hasPhoto: true, remarks: "", stage: "submitted",
  submittedAt: "2026-10-01T09:00:00.000Z", reviewedAt: null, reviewer: null, alerts: [],
  timeline: [
    { stage: "submitted", label: "Submitted", at: "2026-10-01T09:00:00.000Z", by: "Operator", done: true },
    { stage: "verification", label: "Under Verification", at: null, by: null, done: false },
    { stage: "approved", label: "Approved", at: null, by: null, done: false },
  ],
  ...over,
});

/** The candidate exactly as the dialog would snapshot it, from the entry the officer saw. */
const cand = (a: Approval, entries: EtpEntry[] = []): ApprovalCandidate => {
  const e = entries.find((x) => x.id === a.readingId);
  return { industryId: a.industryId, approvalId: a.id, submittedAt: a.submittedAt, revision: e ? entryRevision(e) : "" };
};
const AT = "2026-10-15T10:00:00.000Z";

describe("decidedApproval — the single shared definition", () => {
  it("stamps stage, reviewer, time and the full timeline", () => {
    const d = decidedApproval(approval("A-1", "E-1"), "approved", "Monitoring Body", AT);
    expect(d.stage).toBe("approved");
    expect(d.reviewer).toBe("Monitoring Body");
    expect(d.reviewedAt).toBe(AT);
    expect(d.timeline.map((s) => [s.stage, s.done, s.at])).toEqual([
      ["submitted", true, "2026-10-01T09:00:00.000Z"],
      ["verification", true, AT],
      ["approved", true, AT],
    ]);
  });
});

describe("eligibleApprovalCandidates — what Approve All offers", () => {
  it("includes only pending ETP-entry approvals", () => {
    const entries = [entry("E-1"), entry("E-2")];
    const approvals = [
      approval("A-1", "E-1"),
      approval("A-2", "E-2", { stage: "verification" }),
      approval("A-3", "E-1", { stage: "approved" }), // already decided
      approval("A-4", "E-1", { stage: "rejected" }),
      approval("A-5", "R-0001"), // a flow-meter reading, a different category
    ];
    expect(eligibleApprovalCandidates(approvals, entries).map((c) => c.approvalId)).toEqual(["A-1", "A-2"]);
  });

  it("pending means submitted or verification, nothing else", () => {
    expect(isPendingStage("submitted")).toBe(true);
    expect(isPendingStage("verification")).toBe(true);
    expect(isPendingStage("approved")).toBe(false);
    expect(isPendingStage("rejected")).toBe(false);
  });
});

describe("approveCandidatesInSlice — re-checked at write time", () => {
  it("approves exactly the confirmed candidates and flips their entries", () => {
    const slice = { approvals: [approval("A-1", "E-1"), approval("A-2", "E-2")], etpEntries: [entry("E-1"), entry("E-2")] };
    const r = approveCandidatesInSlice(slice, [cand(slice.approvals[0], slice.etpEntries)], "Monitoring Body", AT);
    expect(r.outcomes).toEqual([{ approvalId: "A-1", industryId: "IND-1", result: "approved" }]);
    expect(r.approvals.find((a) => a.id === "A-1")?.stage).toBe("approved");
    expect(r.approvals.find((a) => a.id === "A-2")?.stage).toBe("submitted"); // not confirmed -> untouched
    expect(r.etpEntries.find((e) => e.id === "E-1")?.status).toBe("approved");
    expect(r.etpEntries.find((e) => e.id === "E-2")?.status).toBe("pending");
  });

  it("skips an approval another officer already decided", () => {
    const a = approval("A-1", "E-1");
    const slice = { approvals: [{ ...a, stage: "rejected" as const }], etpEntries: [entry("E-1")] };
    const r = approveCandidatesInSlice(slice, [cand(a)], "Monitoring Body", AT);
    expect(r.outcomes[0]).toMatchObject({ result: "skipped" });
    expect(r.changed).toBe(false);
    expect(r.approvals[0].stage).toBe("rejected"); // never overwritten
  });

  it("skips an entry re-submitted after confirmation (its approval id is new)", () => {
    const confirmed = approval("A-OLD", "E-1");
    const slice = { approvals: [approval("A-NEW", "E-1", { submittedAt: "2026-10-01T11:00:00.000Z" })], etpEntries: [entry("E-1", { submittedAt: "2026-10-01T11:00:00.000Z" })] };
    const r = approveCandidatesInSlice(slice, [cand(confirmed)], "Monitoring Body", AT);
    expect(r.outcomes[0]).toMatchObject({ result: "skipped" });
    expect(r.approvals[0].stage).toBe("submitted"); // the unseen revision is NOT approved
  });

  it("skips a candidate whose version changed under the same id", () => {
    const a = approval("A-1", "E-1");
    const slice = { approvals: [{ ...a, submittedAt: "2026-10-01T12:00:00.000Z" }], etpEntries: [entry("E-1", { submittedAt: "2026-10-01T12:00:00.000Z" })] };
    const r = approveCandidatesInSlice(slice, [cand(a)], "Monitoring Body", AT);
    expect(r.outcomes[0]).toMatchObject({ result: "skipped" });
  });

  it("skips an entry that is no longer submitted", () => {
    const a = approval("A-1", "E-1");
    const slice = { approvals: [a], etpEntries: [entry("E-1", { entryStatus: "DRAFT" })] };
    expect(approveCandidatesInSlice(slice, [cand(a)], "Monitoring Body", AT).outcomes[0]).toMatchObject({ result: "skipped" });
  });

  it("never approves a non-ETP (flow-meter) approval", () => {
    const a = approval("A-1", "R-0001");
    const slice = { approvals: [a], etpEntries: [entry("E-1")] };
    expect(approveCandidatesInSlice(slice, [cand(a)], "Monitoring Body", AT).outcomes[0]).toMatchObject({ result: "skipped" });
  });

  it("is idempotent: a retry over an approved slice changes nothing", () => {
    const a = approval("A-1", "E-1");
    const es = [entry("E-1")];
    const first = approveCandidatesInSlice({ approvals: [a], etpEntries: es }, [cand(a, es)], "Monitoring Body", AT);
    const again = approveCandidatesInSlice({ approvals: first.approvals, etpEntries: first.etpEntries }, [cand(a, es)], "Monitoring Body", "2026-10-15T11:00:00.000Z");
    expect(again.changed).toBe(false);
    // the original approval time is NOT re-stamped by the retry
    expect(again.approvals[0].reviewedAt).toBe(AT);
  });

  it("preserves array order so the slice re-serialises in the same shape", () => {
    const slice = { approvals: [approval("A-1", "E-1"), approval("A-2", "E-2"), approval("A-3", "E-3")], etpEntries: [entry("E-1"), entry("E-2"), entry("E-3")] };
    const r = approveCandidatesInSlice(slice, [cand(slice.approvals[1], slice.etpEntries)], "Monitoring Body", AT);
    expect(r.approvals.map((a) => a.id)).toEqual(["A-1", "A-2", "A-3"]);
  });
});

describe("Approve All never approves an unseen revision", () => {
  it("skips an entry amended after confirmation, even though submittedAt and status are unchanged", () => {
    const a = approval("A-1", "E-1");
    const seen = entry("E-1", { sludge: { opening: 0, generation: 100, dateOfDisposal: "", dispatch: 0, manifestNo: "", closing: 100, remark: "" } });
    const c = cand(a, [seen]);
    // A Sludge & Salt amendment lands while the dialog is open: same id, same submittedAt, same status.
    const amended: EtpEntry = { ...seen, sludge: { ...seen.sludge!, generation: 120, closing: 120 }, ledgerEdits: [{ at: AT, byUid: "op", kind: "edit", changes: [] }] };
    expect(amended.submittedAt).toBe(seen.submittedAt);
    const r = approveCandidatesInSlice({ approvals: [a], etpEntries: [amended] }, [c], "Monitoring Body", AT);
    expect(r.outcomes[0]).toMatchObject({ result: "skipped" });
    expect(r.approvals[0].stage).toBe("submitted");
    expect(r.etpEntries[0].status).toBe("pending");
  });

  it("the revision ignores status, so it survives the approval itself", () => {
    const e = entry("E-1");
    expect(entryRevision({ ...e, status: "approved" })).toBe(entryRevision(e));
  });

  it("the revision is independent of key order", () => {
    const e = entry("E-1");
    const reordered = Object.fromEntries(Object.entries(e).reverse()) as EtpEntry;
    expect(entryRevision(reordered)).toBe(entryRevision(e));
  });

  it("the offered count uses the same test as the write: a non-pending entry is not offered", () => {
    const entries = [entry("E-1", { status: "approved" }), entry("E-2", { entryStatus: "DRAFT" }), entry("E-3")];
    const approvals = [approval("A-1", "E-1"), approval("A-2", "E-2"), approval("A-3", "E-3")];
    expect(eligibleApprovalCandidates(approvals, entries).map((c) => c.approvalId)).toEqual(["A-3"]);
  });
});

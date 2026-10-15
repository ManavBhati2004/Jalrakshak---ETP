import { describe, it, expect, beforeEach } from "vitest";
import { useDataStore } from "./data";
import { remoteApply, shardByIndustry, type IndustrySlice, type StoreData } from "@/lib/data/firestore-storage";
import type { Alert } from "@/lib/types";

const alert = (id: string, industryId: string, over: Partial<Alert> = {}): Alert =>
  ({
    id, industryId, industryName: industryId, type: "help_request", severity: "low", cetpId: null,
    title: "t", message: "m", createdAt: "2026-10-15T00:00:00.000Z", status: "active", ...over,
  }) as Alert;

/** Exactly what the persist adapter would serialise for one unit on the next store write. */
const nextWriteFor = (id: string) => {
  const { industries, readings, etpEntries, approvals, alerts, compliance } = useDataStore.getState();
  const persisted = JSON.parse(JSON.stringify({ state: { industries, readings, etpEntries, approvals, alerts, compliance } })).state as StoreData;
  return JSON.stringify(shardByIndustry(persisted).get(id));
};

describe("applyCommittedSlice — a committed transaction lands in place", () => {
  beforeEach(() => {
    useDataStore.setState({
      industries: [],
      readings: [],
      etpEntries: [],
      approvals: [],
      compliance: [],
      // two units interleaved, as an unsorted list the UI shows in array order
      alerts: [alert("AL-1", "IND-A"), alert("AL-2", "IND-B"), alert("AL-3", "IND-A"), alert("AL-4", "IND-B")],
    });
  });

  it("replaces the unit's rows where they are, keeps other units untouched, appends only new rows", () => {
    const committed: IndustrySlice = {
      industry: null, readings: [], etpEntries: [], approvals: [], compliance: null,
      alerts: [alert("AL-3", "IND-A", { status: "resolved" }), alert("AL-1", "IND-A", { status: "resolved" }), alert("AL-5", "IND-A")],
    };
    useDataStore.getState().applyCommittedSlice("IND-A", committed);
    const ids = useDataStore.getState().alerts.map((a) => `${a.id}:${a.status}`);
    expect(ids).toEqual(["AL-1:resolved", "AL-2:active", "AL-3:resolved", "AL-4:active", "AL-5:active"]);
  });

  it("drops the unit's rows that the commit no longer has", () => {
    const committed: IndustrySlice = { industry: null, readings: [], etpEntries: [], approvals: [], compliance: null, alerts: [alert("AL-3", "IND-A")] };
    useDataStore.getState().applyCommittedSlice("IND-A", committed);
    expect(useDataStore.getState().alerts.map((a) => a.id)).toEqual(["AL-2", "AL-3", "AL-4"]);
  });

  it("is applied as a remote change: persistence is suppressed during, and restored after", () => {
    let seen: boolean | null = null;
    const unsub = useDataStore.subscribe(() => {
      seen = remoteApply.active;
    });
    useDataStore.getState().applyCommittedSlice("IND-A", { industry: null, readings: [], etpEntries: [], approvals: [], compliance: null, alerts: [] });
    unsub();
    expect(seen).toBe(true);
    expect(remoteApply.active).toBe(false);
  });

  it("what the next store write would send for the unit is exactly what the caller caches", () => {
    useDataStore.getState().applyCommittedSlice("IND-A", {
      industry: null, readings: [], etpEntries: [], approvals: [], compliance: null,
      alerts: [alert("AL-3", "IND-A", { status: "resolved" }), alert("AL-1", "IND-A")],
    });
    // tenant-tx caches JSON.stringify(shardByIndustry(store).get(id)); the persist path serialises
    // the same state through a JSON round trip. They must agree, or the next unrelated change would
    // re-send (and could revert) the committed document.
    expect(JSON.stringify(shardByIndustry(useDataStore.getState()).get("IND-A"))).toBe(nextWriteFor("IND-A"));
  });
});

"use client";

import { useEffect, useState } from "react";
import { subscribeMeterIssues } from "@/lib/data/meter-issues";
import type { MeterIssue } from "@/lib/types";

type State = { key: string; byUnit: Record<string, MeterIssue[]>; failed: string[] };

/**
 * Live meter issues for the given units.
 *
 * `loaded` turns true once every unit has answered - with data or with an error - so a caller can
 * hold back anything that depends on baselines until then. `error` means some unit's issues could
 * not be read at all (for example, rules that allow them are not deployed yet); callers say so
 * rather than presenting it as "no issues".
 */
export function useMeterIssues(unitIds: readonly string[]) {
  const key = unitIds.join("|");
  const [state, setState] = useState<State>({ key: "", byUnit: {}, failed: [] });

  useEffect(() => {
    if (!key) return;
    // Answers are tagged with the unit set they belong to, so a late answer for a previous set is
    // never mixed into the current one.
    const put = (id: string, list: MeterIssue[], failed: boolean) =>
      setState((s) => {
        const base = s.key === key ? s : { key, byUnit: {}, failed: [] };
        return {
          key,
          byUnit: { ...base.byUnit, [id]: list },
          failed: failed ? (base.failed.includes(id) ? base.failed : [...base.failed, id]) : base.failed.filter((f) => f !== id),
        };
      });
    const unsubs = key.split("|").map((id) =>
      subscribeMeterIssues(
        id,
        (list) => put(id, list, false),
        () => put(id, [], true),
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, [key]);

  const current = state.key === key ? state : { byUnit: {} as Record<string, MeterIssue[]>, failed: [] as string[] };
  return {
    byUnit: current.byUnit,
    loaded: key === "" || key.split("|").every((id) => id in current.byUnit),
    error: current.failed.length > 0,
  };
}

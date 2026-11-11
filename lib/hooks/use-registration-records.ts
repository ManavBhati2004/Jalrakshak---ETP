"use client";

import { useEffect, useState } from "react";
import { subscribeRegistrationDrafts, subscribeRegistrationReviews } from "@/lib/data/registration-ops";
import type { RegistrationDraft, RegistrationReview } from "@/lib/types";

/**
 * Live registration drafts (Monitoring Body). `loaded` turns true on the first answer, with data or
 * an error; `error` means they could not be read, so a caller says so rather than "no drafts".
 */
export function useRegistrationDrafts() {
  const [state, setState] = useState<{ drafts: RegistrationDraft[]; loaded: boolean; error: boolean }>({ drafts: [], loaded: false, error: false });
  useEffect(
    () =>
      subscribeRegistrationDrafts(
        (drafts) => setState({ drafts, loaded: true, error: false }),
        () => setState((s) => ({ ...s, loaded: true, error: true })),
      ),
    [],
  );
  return state;
}

/**
 * Live registration decisions for every unit (Monitoring Body). Until `loaded`, statuses must not be
 * shown: a unit with a decision on record would briefly look undecided.
 */
export function useRegistrationReviews() {
  const [state, setState] = useState<{ byUnit: Record<string, RegistrationReview>; loaded: boolean; error: boolean }>({ byUnit: {}, loaded: false, error: false });
  useEffect(
    () =>
      subscribeRegistrationReviews(
        (byUnit) => setState({ byUnit, loaded: true, error: false }),
        () => setState((s) => ({ ...s, loaded: true, error: true })),
      ),
    [],
  );
  return state;
}

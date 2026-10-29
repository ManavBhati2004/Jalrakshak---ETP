"use client";

import { useState } from "react";
import { Eye, EyeOff, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { deleteUnit } from "@/lib/data/tenant-ops";
import { deleteUnitWithLogin } from "@/lib/store/accounts";
import { useDataStore } from "@/lib/store/data";
import { cn } from "@/lib/utils";
import type { Industry } from "@/lib/types";

const inputCls =
  "h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50";

/**
 * Monitoring Body: delete one ETP unit for good. With its login (that login's current password is
 * needed, as for a password reset) - or, for a unit with no login or an unknown password, the unit
 * only. Typing the unit's id arms the button.
 */
export function DeleteUnitDialog({ industry, onClose }: { industry: Industry; onClose: () => void }) {
  const entryCount = useDataStore((s) => s.etpEntries.filter((e) => e.industryId === industry.id).length);
  const [email, setEmail] = useState(industry.email ?? "");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [unitOnly, setUnitOnly] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  const idMatches = typed.trim().toUpperCase() === industry.id.toUpperCase();
  const canDelete = idMatches && (unitOnly || (email.trim() !== "" && password !== "")) && !busy;

  const submit = async () => {
    if (!canDelete) return;
    setBusy(true);
    const removeUnit = () => deleteUnit(industry.id, industry.name);
    const res = unitOnly
      ? await removeUnit()
      : await deleteUnitWithLogin({ industryId: industry.id, email, password, deleteUnit: removeUnit });
    setBusy(false);
    if (!res.ok) {
      toast.error("Unit not deleted", { description: res.error });
      return;
    }
    const login = email.trim();
    if (!("loginRemoved" in res)) {
      toast.success(`${industry.name} deleted`, { description: `${industry.id} is retired. Its login, if any, was left in place.` });
    } else if (res.loginRemoved) {
      toast.success(`${industry.name} deleted`, { description: `${industry.id} is retired and the login ${login} was removed.` });
    } else {
      toast.warning(`${industry.name} deleted, but its login was not removed`, {
        description: `Remove ${login} in Firebase Console → Authentication.`,
      });
    }
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {industry.name}?</DialogTitle>
          <DialogDescription>
            {industry.id}
            {industry.area ? ` · ${industry.area}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2.5 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            This permanently deletes the unit and everything filed under it — {entryCount} daily entr{entryCount === 1 ? "y" : "ies"}, its approvals,
            alerts, compliance record and uploaded documents. Its ID {industry.id} is retired and never given to another unit. This cannot be undone.
          </p>
        </div>

        <div className="space-y-2.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Unit login</p>
          {unitOnly ? (
            <p className="text-xs text-muted-foreground">
              The unit&apos;s login, if it has one, stays: it can still sign in but sees no unit. To use its email for a new unit, remove it in Firebase
              Console → Authentication.
            </p>
          ) : (
            <>
              <div>
                <label htmlFor="delete-email" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Login email
                </label>
                <input id="delete-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label htmlFor="delete-password" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Login password — the one set at registration, or last set with Reset login password
                </label>
                <div className="relative">
                  <input
                    id="delete-password"
                    type={showPw ? "text" : "password"}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={cn(inputCls, "pr-10")}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPw((s) => !s)}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground"
                    aria-label={showPw ? "Hide password" : "Show password"}
                  >
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </>
          )}
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={unitOnly} onChange={(e) => setUnitOnly(e.target.checked)} className="mt-0.5" />
            This unit has no login, or I don&apos;t have its password — delete the unit only
          </label>
        </div>

        <div>
          <label htmlFor="delete-confirm" className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Type <span className="font-mono font-semibold text-foreground">{industry.id}</span> to confirm
          </label>
          <input id="delete-confirm" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={industry.id} className={inputCls} />
        </div>

        <DialogFooter>
          <Button variant="outline" className="rounded-lg" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button className="gap-2 rounded-lg bg-red-600 text-white hover:bg-red-600/90" disabled={!canDelete} onClick={submit}>
            <Trash2 className="h-4 w-4" /> {busy ? "Deleting…" : "Delete unit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

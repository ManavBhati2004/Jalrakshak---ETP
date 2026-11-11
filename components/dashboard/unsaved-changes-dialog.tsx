"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Asks before leaving a form with unsaved changes. With `onSaveAndLeave`, it also offers to save
 * a draft first; that leaves only once the draft is saved.
 */
export function UnsavedChangesDialog({
  open,
  onStay,
  onLeave,
  onSaveAndLeave,
}: {
  open: boolean;
  onStay: () => void;
  onLeave: () => void;
  onSaveAndLeave?: () => Promise<boolean>;
}) {
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onStay()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <TriangleAlert className="h-5 w-5 text-amber-500" /> Unsaved changes
          </DialogTitle>
          <DialogDescription>
            {onSaveAndLeave
              ? "This form has changes that are not saved. Save it as a draft before leaving, or leave without saving."
              : "This form has changes that are not saved. If you leave now, they are lost."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:flex-wrap sm:gap-2">
          <Button variant="outline" className="rounded-lg" disabled={saving} onClick={onStay}>
            Stay
          </Button>
          <Button variant="outline" className="rounded-lg text-red-600 hover:text-red-600" disabled={saving} onClick={onLeave}>
            Leave without saving
          </Button>
          {onSaveAndLeave ? (
            <Button
              className="rounded-lg"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  if (await onSaveAndLeave()) onLeave();
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? "Saving…" : "Save draft and leave"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { LifeBuoy, Send, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/lib/store/auth";
import { useDataStore } from "@/lib/store/data";
import { formatDate } from "@/lib/utils";

const CATEGORIES = ["Data entry", "Meter / hardware", "Compliance", "Account / access", "Other"];

export default function HelpCenterPage() {
  const industryId = useAuthStore((s) => s.industryId);
  const industries = useDataStore((s) => s.industries);
  const alerts = useDataStore((s) => s.alerts);
  const reportIssue = useDataStore((s) => s.reportIssue);
  const industry = industries.find((i) => i.id === industryId);

  const [category, setCategory] = useState(CATEGORIES[0]);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const myReports = useMemo(
    () =>
      alerts
        .filter((a) => a.type === "help-request" && a.industryId === industryId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [alerts, industryId],
  );

  if (!industry) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <p className="text-lg font-semibold text-foreground">No ETP unit linked to this session</p>
        <Link href="/login" className="text-sm font-semibold text-primary hover:underline">Sign in to your unit</Link>
      </div>
    );
  }

  const submit = () => {
    if (!industryId || !message.trim()) return;
    setSubmitting(true);
    reportIssue(industryId, category, message.trim());
    toast.success("Issue reported", { description: "The Monitoring Body has been notified." });
    setMessage("");
    setSubmitting(false);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="ETP · Support"
        title="Help Center"
        description="Report an issue to the Monitoring Body. Your message reaches the regulator's Alert Center, and any reply or notice appears in your Alerts."
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        {/* report form */}
        <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
          <h3 className="flex items-center gap-2 border-b border-border pb-3 font-display text-sm font-bold uppercase tracking-wide text-foreground">
            <LifeBuoy className="h-4 w-4 text-primary" /> Report an issue
          </h3>
          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="h-10 w-full rounded-xl border border-border bg-muted/30 px-3 text-sm outline-none transition-colors focus:border-primary/50 focus:bg-background"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Describe the issue</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={5}
                placeholder="What went wrong, or what do you need help with?"
                className="w-full rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50 focus:bg-background"
              />
            </div>
            <Button onClick={submit} disabled={submitting || !message.trim()} className="h-11 w-full gap-2 rounded-xl text-base font-semibold">
              <Send className="h-4 w-4" />
              {submitting ? "Sending…" : "Send to Monitoring Body"}
            </Button>
          </div>
        </div>

        {/* my reports */}
        <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
          <h3 className="flex items-center gap-2 border-b border-border pb-3 font-display text-sm font-bold uppercase tracking-wide text-foreground">
            <MessageSquare className="h-4 w-4 text-primary" /> Your reported issues
          </h3>
          <div className="mt-4 space-y-3">
            {myReports.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No issues reported yet.</p>
            ) : (
              myReports.map((a) => (
                <div key={a.id} className="rounded-xl border border-border bg-muted/20 p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground">{a.title}</p>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{formatDate(a.createdAt, true)}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{a.message}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

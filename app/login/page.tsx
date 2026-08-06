"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, ShieldCheck, Activity, Lock, Droplets, Mail, KeyRound, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JalRakshakLogo } from "@/components/shared/logo";
import { useAuthStore } from "@/lib/store/auth";
import { useAccountsStore } from "@/lib/store/accounts";
import type { RoleId } from "@/lib/types";

const HIGHLIGHTS = [
  { icon: Activity, text: "Live flow & energy monitoring" },
  { icon: ShieldCheck, text: "Automated compliance & alerts" },
  { icon: Droplets, text: "ZLD water-recovery oversight" },
];

export default function LoginPage() {
  const router = useRouter();
  const login = useAuthStore((s) => s.login);
  const authenticate = useAccountsStore((s) => s.authenticate);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [entering, setEntering] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const go = (role: RoleId, industryId: string | null) => {
    setEntering(true);
    login(role, industryId);
    setTimeout(() => router.push("/dashboard"), 500);
  };

  const signIn = async () => {
    setError("");
    setEntering(true);
    const user = await authenticate(email, password);
    if (!user) {
      setError("Invalid email or password.");
      setEntering(false);
      return;
    }
    go(user.role, user.industryId);
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[0.95fr_1.05fr]">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-indigo-600 via-violet-600 to-blue-700 p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute inset-0 bg-grid-cyan opacity-25" />
        <div
          className="pointer-events-none absolute -bottom-24 -left-24 h-96 w-96 rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(139,92,246,0.55), transparent 70%)" }}
        />
        <div className="relative z-10">
          <JalRakshakLogo tone="light" size={40} />
        </div>
        <div className="relative z-10">
          <h1 className="font-display text-4xl font-extrabold leading-tight">
            Water Monitoring
            <br />
            Command Center
          </h1>
          <p className="mt-4 max-w-sm text-white/80">
            Sign in to monitor textile wastewater treatment, compliance and water
            recovery across every ETP unit.
          </p>
          <div className="mt-8 space-y-3">
            {HIGHLIGHTS.map((h) => (
              <div key={h.text} className="flex items-center gap-3 text-sm text-white/90">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
                  <h.icon className="h-4 w-4" />
                </span>
                {h.text}
              </div>
            ))}
          </div>
        </div>
        <div className="relative z-10 text-xs text-white/60">
          © {new Date().getFullYear()} JalRakshak — ETP Monitoring
        </div>
      </div>

      {/* Auth panel */}
      <div className="relative flex flex-col bg-gradient-to-b from-white via-indigo-50/40 to-violet-50/60 px-5 py-8 sm:px-10">
        <div className="flex items-center justify-between">
          <Button asChild variant="ghost" size="sm" className="h-9 gap-1.5 px-3 text-slate-500">
            <Link href="/">
              <ArrowLeft className="h-4 w-4" />
              Home
            </Link>
          </Button>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-100 px-3 py-1.5 text-xs font-medium text-indigo-700">
            <Lock className="h-3.5 w-3.5" />
            Secure sign-in
          </span>
        </div>

        <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center py-6">
          <div className="lg:hidden">
            <JalRakshakLogo size={36} />
          </div>

          <h2 className="mt-4 font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Welcome back</h2>
          <p className="mt-1.5 text-sm text-slate-500">Sign in to your monitoring or textile-unit account.</p>

          {/* credentials — wrapped in a form so Enter submits */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              signIn();
            }}
          >
            <div className="mt-6 space-y-4">
              <LField label="Email" icon={<Mail className="h-4 w-4" />}>
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className={inputCls} placeholder="you@unit.in" autoComplete="email" />
              </LField>
              <LField label="Password" icon={<KeyRound className="h-4 w-4" />}>
                <div className="relative">
                  <input value={password} onChange={(e) => setPassword(e.target.value)} type={showPw ? "text" : "password"} className={inputCls + " pr-10"} placeholder="••••••••" autoComplete="current-password" />
                  <button type="button" tabIndex={-1} onClick={() => setShowPw((s) => !s)} className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600" aria-label={showPw ? "Hide password" : "Show password"}>
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </LField>
            </div>

            {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-600">{error}</p>}

            <Button
              type="submit"
              disabled={entering}
              size="lg"
              className="mt-6 h-12 w-full gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-base font-semibold text-white hover:from-indigo-600/90 hover:to-violet-600/90"
            >
              {entering ? "Entering…" : "Sign In"}
              {!entering && <ArrowRight className="h-4 w-4" />}
            </Button>
          </form>

          <div className="mt-4 space-y-1.5 rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-500">
            <p className="font-semibold text-slate-700">Sign-in accounts</p>
            <p>
              <span className="font-semibold text-slate-600">Monitoring Body</span> — <span className="text-slate-400">Email:</span> admin@rspcb.in · <span className="text-slate-400">Password:</span> rspcb123
            </p>
            <p>
              <span className="font-semibold text-slate-600">ETP Unit</span> — <span className="text-slate-400">Email:</span> etp@demo.in · <span className="text-slate-400">Password:</span> demo123
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-indigo-400";

function LField({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-600">
        {icon && <span className="text-slate-400">{icon}</span>}
        {label}
      </label>
      {children}
    </div>
  );
}

import { NextResponse } from "next/server";
import { AdminNotConfigured, adminServices } from "@/lib/server/firebase-admin";
import { passwordMeetsRules } from "@/lib/password-rules";

export const runtime = "nodejs";

const fail = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });

/** The unit's registered email, from its stored slice (the login of a unit registered before ownerUid). */
function unitEmail(json: unknown): string | null {
  if (typeof json !== "string") return null;
  try {
    const email = (JSON.parse(json) as { industry?: { email?: unknown } }).industry?.email;
    return typeof email === "string" && email.trim() ? email.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * POST { industryId, newPassword } - the Monitoring Body sets a new password for an ETP unit's login.
 *
 * The browser cannot set another account's password, so this one step runs here with the Admin SDK.
 * The caller must present a valid Firebase ID token whose profile is `monitoring-admin`, and the
 * account changed must be the unit's own `etp` login - never an officer's.
 */
export async function POST(req: Request) {
  let svc: ReturnType<typeof adminServices>;
  try {
    svc = adminServices();
  } catch (e) {
    if (e instanceof AdminNotConfigured) return fail(503, "Password reset is not set up on this site yet.");
    throw e;
  }

  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!token) return fail(401, "Sign in again to reset a password.");
  let callerUid: string;
  try {
    callerUid = (await svc.auth.verifyIdToken(token, true)).uid;
  } catch {
    return fail(401, "Your session has expired. Sign in again.");
  }

  try {
    const caller = await svc.db.doc(`users/${callerUid}`).get();
    if (caller.get("role") !== "monitoring-admin") return fail(403, "Only the Monitoring Body can reset a unit's password.");

    let body: { industryId?: unknown; newPassword?: unknown };
    try {
      body = await req.json();
    } catch {
      return fail(400, "Bad request.");
    }
    const industryId = typeof body.industryId === "string" ? body.industryId : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
    if (!/^IND-\d{1,6}$/.test(industryId)) return fail(400, "Unknown unit.");
    if (!passwordMeetsRules(newPassword)) return fail(400, "The new password does not meet the password rules.");

    const unit = await svc.db.doc(`industries/${industryId}`).get();
    if (!unit.exists) return fail(404, "That unit no longer exists.");
    // The unit's login: the account registration stamped as its owner - or, for a unit registered
    // before that stamp existed, the account under the unit's email.
    const ownerUid = typeof unit.get("ownerUid") === "string" ? (unit.get("ownerUid") as string) : null;
    let targetUid = ownerUid;
    if (!targetUid) {
      const email = unitEmail(unit.get("json"));
      if (email) targetUid = await svc.auth.getUserByEmail(email).then((u) => u.uid, () => null);
    }
    if (!targetUid) return fail(404, "This unit has no login to reset.");

    // Only an ETP login linked to this unit - or stamped as its owner while the link is still unset.
    const profile = await svc.db.doc(`users/${targetUid}`).get();
    const linked = profile.get("industryId") ?? null;
    if (profile.get("role") !== "etp" || !(linked === industryId || (linked === null && ownerUid === targetUid))) {
      return fail(409, "This unit's login could not be confirmed, so nothing was changed.");
    }

    await svc.auth.updateUser(targetUid, { password: newPassword });
    // The unit's other sessions are signed out; it signs in again with the new password.
    await svc.auth.revokeRefreshTokens(targetUid);
    const user = await svc.auth.getUser(targetUid);
    return NextResponse.json({ ok: true, email: user.email ?? null });
  } catch {
    return fail(500, "Could not change the password. Try again.");
  }
}

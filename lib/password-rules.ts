/**
 * The rules for a unit login password set by the Monitoring Body - shared by the reset form's live
 * checklist and the server that applies the reset, so the two can never disagree.
 */
export const PASSWORD_RULES: readonly { label: string; ok: (pw: string) => boolean }[] = [
  { label: "At least 8 characters", ok: (pw) => pw.length >= 8 },
  { label: "Contains a letter", ok: (pw) => /[A-Za-z]/.test(pw) },
  { label: "Contains a number", ok: (pw) => /[0-9]/.test(pw) },
  { label: "Contains a special character", ok: (pw) => /[^A-Za-z0-9]/.test(pw) },
];

/** A ceiling only the server needs: no one types a longer password, and it bounds the request. */
export const MAX_PASSWORD_LENGTH = 128;

export const passwordMeetsRules = (pw: string) => pw.length <= MAX_PASSWORD_LENGTH && PASSWORD_RULES.every((r) => r.ok(pw));

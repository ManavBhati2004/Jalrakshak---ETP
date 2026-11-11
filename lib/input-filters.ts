/* Keystroke filters for form inputs: each returns the cleaned value to put back in the field. */

/** Letters and spaces only. */
export const alphaOnly = (v: string) => v.replace(/[^A-Za-z ]/g, "");

/** Digits only, at most 10 (a mobile number). */
export const digitsOnly = (v: string) => v.replace(/\D/g, "").slice(0, 10);

/** First letter in capitals. */
export const capFirst = (v: string) => (v ? v.charAt(0).toUpperCase() + v.slice(1) : v);

/**
 * A non-negative decimal under the numeric standard: digits and one point, at most `intDigits`
 * digits before it and 2 after. Same behaviour as the daily entry's number filter.
 */
export function decimalFilter(s: string, intDigits = 7): string {
  let v = s.replace(/[^0-9.]/g, "");
  const dot = v.indexOf(".");
  if (dot !== -1) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, "");
  const [int = "", dec = ""] = v.split(".");
  const capInt = int.slice(0, intDigits);
  return v.includes(".") ? `${capInt}.${dec.slice(0, 2)}` : capInt;
}

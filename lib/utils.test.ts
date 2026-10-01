import { describe, it, expect, afterEach } from "vitest";
import { parseDisplayDate, formatDate } from "./utils";

/* ============================================================================
   A date-only string names a CALENDAR DAY, not an instant, and must render as
   that day in every timezone.

   `new Date("2026-09-30")` is parsed as UTC midnight per spec, so in any
   negative-offset zone it is 29 Sep locally — a reading filed for the 30th
   would display as the 29th, and one filed on the 1st would display in the
   previous month. These tests switch the process timezone at runtime, because
   a `TZ=` shell prefix has no effect on Windows and would pass vacuously.
   ========================================================================== */

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

/** Zones west of UTC are where a UTC-midnight parse slips to the previous day. */
const NEGATIVE_OFFSET_ZONES = ["America/New_York", "America/Los_Angeles", "Pacific/Honolulu", "Pacific/Midway"];
const ALL_ZONES = ["Asia/Kolkata", "UTC", ...NEGATIVE_OFFSET_ZONES];

describe("formatDate renders a date-only string on the day it names", () => {
  for (const tz of ALL_ZONES) {
    it(`keeps 2026-09-30 on the 30th in ${tz}`, () => {
      process.env.TZ = tz;
      const out = formatDate("2026-09-30");
      expect(out).toContain("30");
      expect(out).toMatch(/Sep/);
    });
  }

  for (const tz of NEGATIVE_OFFSET_ZONES) {
    it(`does not slip 2026-10-01 into September in ${tz}`, () => {
      // The 1st is where the old UTC-midnight parse crossed a month boundary.
      process.env.TZ = tz;
      const out = formatDate("2026-10-01");
      expect(out).toContain("01");
      expect(out).toMatch(/Oct/);
      expect(out).not.toMatch(/Sep/);
    });

    it(`does not slip 2026-01-01 into the previous year in ${tz}`, () => {
      process.env.TZ = tz;
      const out = formatDate("2026-01-01");
      expect(out).toContain("2026");
      expect(out).not.toContain("2025");
    });
  }

  it("keeps a leap day intact west of UTC", () => {
    process.env.TZ = "America/Los_Angeles";
    const out = formatDate("2028-02-29");
    expect(out).toContain("29");
    expect(out).toMatch(/Feb/);
  });
});

describe("formatDate leaves instants alone", () => {
  it("renders a full ISO timestamp in local time, not coerced to its UTC day", () => {
    // 02:30Z on 1 Oct is still 30 Sep in New York — correct for an instant, and the
    // behaviour must be identical to a plain `new Date(iso)`.
    process.env.TZ = "America/New_York";
    const iso = "2026-10-01T02:30:00.000Z";
    expect(formatDate(iso)).toBe(
      new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
    );
  });

  it("still renders a time when asked", () => {
    expect(formatDate("2026-09-30T18:45:00.000Z", true)).toMatch(/\d{1,2}:\d{2}/);
  });
});

describe("parseDisplayDate", () => {
  it("parses a date-only string at LOCAL midnight", () => {
    const parsed = parseDisplayDate("2026-09-30");
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth() + 1).toBe(9);
    expect(parsed.getDate()).toBe(30);
    expect(parsed.getHours()).toBe(0);
  });

  it("hands a full ISO timestamp to the native parser unchanged", () => {
    const iso = "2026-09-30T18:45:00.000Z";
    expect(parseDisplayDate(iso).getTime()).toBe(new Date(iso).getTime());
  });
});

describe("formatDate edge cases", () => {
  it("returns a dash for no date", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate("")).toBe("—");
  });

  it("echoes a value it cannot parse rather than rendering Invalid Date", () => {
    expect(formatDate("not-a-date")).toBe("not-a-date");
  });

  it("documents that JS rolls a non-existent day over — validateEntryDate is what prevents storing one", () => {
    expect(formatDate("2026-02-30")).toMatch(/Mar/);
  });
});

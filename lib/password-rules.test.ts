import { describe, it, expect } from "vitest";
import { PASSWORD_RULES, MAX_PASSWORD_LENGTH, passwordMeetsRules } from "./password-rules";

describe("password rules (shared by the reset form and the server)", () => {
  it("accepts a password meeting every rule", () => {
    expect(passwordMeetsRules("Secret#123")).toBe(true);
  });

  it.each([
    ["Sh0rt!x", "too short"],
    ["12345678!", "no letter"],
    ["Password!", "no number"],
    ["Password1", "no special character"],
    ["", "empty"],
  ])("refuses %j (%s)", (pw) => {
    expect(passwordMeetsRules(pw)).toBe(false);
  });

  it("refuses anything over the length ceiling", () => {
    expect(passwordMeetsRules("Aa1!".padEnd(MAX_PASSWORD_LENGTH, "x"))).toBe(true);
    expect(passwordMeetsRules("Aa1!".padEnd(MAX_PASSWORD_LENGTH + 1, "x"))).toBe(false);
  });

  it("are the four rules the form's checklist shows", () => {
    expect(PASSWORD_RULES.map((r) => r.label)).toEqual(["At least 8 characters", "Contains a letter", "Contains a number", "Contains a special character"]);
  });
});

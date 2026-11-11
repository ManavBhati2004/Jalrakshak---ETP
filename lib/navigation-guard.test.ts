import { describe, it, expect, vi } from "vitest";
import { guardedNavigate, setNavigationGuard, shouldGuardClick } from "@/lib/navigation-guard";

const HERE = "http://localhost:3001/dashboard/industries/register?draft=abc";
const click = (over: Partial<Parameters<typeof shouldGuardClick>[0]> = {}) => ({
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  defaultPrevented: false,
  ...over,
});
const link = (href: string, over: Partial<Parameters<typeof shouldGuardClick>[1]> = {}) => ({ href, target: "", download: false, ...over });

describe("shouldGuardClick — which link clicks would lose the form", () => {
  it("a plain click to another page of the app", () => {
    expect(shouldGuardClick(click(), link("http://localhost:3001/dashboard/industries"), HERE)).toBe(true);
    expect(shouldGuardClick(click(), link("/dashboard/profile"), HERE)).toBe(true);
    expect(shouldGuardClick(click(), link("/dashboard/industries/register"), HERE)).toBe(true); // a different query is another page
  });

  it("not the page itself, or a jump within it", () => {
    expect(shouldGuardClick(click(), link(HERE), HERE)).toBe(false);
    expect(shouldGuardClick(click(), link(`${HERE}#hwm`), HERE)).toBe(false);
  });

  it("not a new tab, a download, another site or a mail link", () => {
    expect(shouldGuardClick(click({ ctrlKey: true }), link("/dashboard"), HERE)).toBe(false);
    expect(shouldGuardClick(click({ metaKey: true }), link("/dashboard"), HERE)).toBe(false);
    expect(shouldGuardClick(click({ shiftKey: true }), link("/dashboard"), HERE)).toBe(false);
    expect(shouldGuardClick(click({ button: 1 }), link("/dashboard"), HERE)).toBe(false);
    expect(shouldGuardClick(click(), link("/dashboard", { target: "_blank" }), HERE)).toBe(false);
    expect(shouldGuardClick(click(), link("/file.pdf", { download: true }), HERE)).toBe(false);
    expect(shouldGuardClick(click(), link("https://example.com/"), HERE)).toBe(false);
    expect(shouldGuardClick(click(), link("mailto:x@y.z"), HERE)).toBe(false);
  });

  it("not a click something else already handled", () => {
    expect(shouldGuardClick(click({ defaultPrevented: true }), link("/dashboard"), HERE)).toBe(false);
  });
});

describe("guardedNavigate", () => {
  it("goes at once when no form is guarding, and asks first when one is", () => {
    const go = vi.fn();
    guardedNavigate(go);
    expect(go).toHaveBeenCalledTimes(1);

    let held: (() => void) | null = null;
    setNavigationGuard((proceed) => {
      held = proceed;
    });
    guardedNavigate(go);
    expect(go).toHaveBeenCalledTimes(1);
    (held as unknown as () => void)();
    expect(go).toHaveBeenCalledTimes(2);
    setNavigationGuard(null);
  });
});

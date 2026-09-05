import { describe, expect, it, vi } from "vite-plus/test";
import {
  evaluateGate,
  satisfyAllReactVersions,
  satisfiesReactVersion,
} from "../src/react-version.js";

const version = "18.0.0";

describe("upstream React version pragma behavior", () => {
  it("reactVersion flag is on >=", () => {
    expect(satisfiesReactVersion(version, ">= 17.9")).toBe(true);
  });
  it("reactVersion flag is off >=", () => {
    expect(satisfiesReactVersion(version, ">= 18.1")).toBe(false);
  });
  it("reactVersion flag is on <=", () => {
    expect(satisfiesReactVersion(version, "<= 18.1")).toBe(true);
  });
  it("reactVersion flag is off <=", () => {
    expect(satisfiesReactVersion(version, "<= 17.9")).toBe(false);
  });
  it("reactVersion flag is on >", () => {
    expect(satisfiesReactVersion(version, "> 17.9")).toBe(true);
  });
  it("reactVersion flag is off >", () => {
    expect(satisfiesReactVersion(version, "> 18.1")).toBe(false);
  });
  it("reactVersion flag is on <", () => {
    expect(satisfiesReactVersion(version, "< 18.1")).toBe(true);
  });
  it("reactVersion flag is off <", () => {
    expect(satisfiesReactVersion(version, "< 17.0.0")).toBe(false);
  });
  it("reactVersion flag is on =", () => {
    expect(satisfiesReactVersion(version, "= 18.0")).toBe(true);
  });
  it("reactVersion flag is off =", () => {
    expect(satisfiesReactVersion(version, "= 18.1")).toBe(false);
  });
  it("reactVersion fit", () => {
    expect(satisfiesReactVersion(version, ">= 18.1")).toBe(false);
  });
  it("reactVersion test.only", () => {
    expect(satisfiesReactVersion(version, "<= 18.1")).toBe(true);
  });
  it("reactVersion multiple pragmas fail", () => {
    expect(satisfyAllReactVersions(version, ["<= 18.1", "<= 17.1"])).toBe(false);
  });
  it("reactVersion multiple pragmas pass", () => {
    expect(satisfyAllReactVersions(version, ["<= 18.1", ">= 17.1"])).toBe(true);
  });
  it("reactVersion focused multiple pragmas fail", () => {
    expect(satisfyAllReactVersions(version, ["<= 18.1", "<= 17.1"])).toBe(false);
  });
  it("reactVersion focused multiple pragmas pass", () => {
    expect(satisfyAllReactVersions(version, ["<= 18.1", ">= 17.1"])).toBe(true);
  });
});

describe("upstream gate behavior", () => {
  it("should expect an error for this test", () => {
    expect(() =>
      evaluateGate(false, () => {
        throw new Error("expected");
      }),
    ).not.toThrow();
  });
  it("should not an error for this test", () => {
    const callback = vi.fn();
    evaluateGate(true, callback);
    expect(callback).toHaveBeenCalledOnce();
  });
});

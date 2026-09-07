import { hashKey as tanstackHashKey } from "@tanstack/react-query";
import { describe, expect, it } from "vite-plus/test";
import { toCapturedValue } from "../src/harness/query-cache.js";
import {
  EMPTY_OBSERVATIONS,
  getOpaqueCaptureDescription,
  hashKey,
  opaqueCapture,
  readObservationsJson,
} from "../src/observations.js";
import { describeFixtureRun, listFixtures, runFixture } from "./helpers/fixture-runner.js";

class Session {
  constructor(public token: string) {}
}

describe("runtime observations", () => {
  it("serializes plain data and marks everything else opaque", () => {
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic.self = cyclic;
    const captured = toCapturedValue({
      list: [1, "two", null, undefined, true],
      nested: { count: 0, ratio: 0.5 },
      notANumber: Number.NaN,
      callback: () => null,
      when: new Date(0),
      session: new Session("secret"),
      cyclic,
      failure: Object.assign(new Error("boom"), { status: 404 }),
      dropped: undefined,
    });
    expect(captured).toEqual({
      list: [1, "two", null, null, true],
      nested: { count: 0, ratio: 0.5 },
      notANumber: opaqueCapture("NaN"),
      callback: opaqueCapture("function callback"),
      when: opaqueCapture("Date"),
      session: opaqueCapture("Session"),
      cyclic: { name: "loop", self: opaqueCapture("cycle") },
      failure: { name: "Error", message: "boom", status: 404 },
    });
    expect(getOpaqueCaptureDescription(opaqueCapture("Date"))).toBe("Date");
    expect(getOpaqueCaptureDescription({ $bippyOpaque: "Date", extra: 1 })).toBeNull();
    expect(getOpaqueCaptureDescription({ name: "x" })).toBeNull();
  });

  it("reads saved observations and drops malformed entries", () => {
    const query = {
      queryHash: '["todos"]',
      status: "success",
      fetchStatus: "idle",
      data: { items: [] },
      error: null,
      dataUpdateCount: 1,
      dataUpdatedAt: 10,
      errorUpdateCount: 0,
      errorUpdatedAt: 0,
      fetchFailureCount: 0,
      fetchFailureReason: null,
      isInvalidated: false,
      isStale: false,
    };
    const mutation = {
      mutationHash: null,
      status: "success",
      data: { ok: true },
      error: null,
      failureCount: 0,
      failureReason: null,
      isPaused: false,
      submittedAt: 20,
    };
    expect(readObservationsJson(undefined)).toEqual(EMPTY_OBSERVATIONS);
    expect(
      readObservationsJson({
        globals: { config: { user: null }, broken: undefined },
        queries: [query, { queryHash: 1 }, { ...query, status: "loading" }],
      }),
    ).toEqual({ globals: { config: { user: null } }, queries: [query] });
    expect(
      readObservationsJson({
        globals: {},
        queries: [],
        mutations: [mutation, { ...mutation, mutationHash: 1 }, { ...mutation, status: "loading" }],
      }),
    ).toEqual({ globals: {}, queries: [], mutations: [mutation] });
    const page = { cookie: "", localStorage: {}, sessionStorage: {} };
    expect(readObservationsJson({ globals: {}, queries: [], page })).toEqual({
      globals: {},
      queries: [],
      page,
    });
    expect(
      readObservationsJson({ globals: {}, queries: [], page: { ...page, name: "cal-embed=x" } }),
    ).toEqual({ globals: {}, queries: [], page: { ...page, name: "cal-embed=x" } });
    expect(readObservationsJson({ globals: {}, queries: [], page: { ...page, name: 1 } })).toEqual({
      globals: {},
      queries: [],
    });
  });

  it("hashes query keys exactly like @tanstack/query-core", () => {
    const keys = [
      ["todos"],
      ["todos", { status: "open", page: 1 }],
      ["/api/0/organizations/", { query: { member: "1" }, host: undefined }, { infinite: false }],
      [null, 1, true, [{ zebra: 1, apple: [{ b: 1, a: 2 }] }]],
    ];
    for (const key of keys) {
      expect(hashKey(key)).toBe(tanstackHashKey(key));
    }
  });

  for (const name of [
    "tanstack-query-observed",
    "tanstack-mutation-observed",
    "lingui-catalog-observed",
    "react-router-observed",
  ]) {
    it(`leaves the ${name} outcome uncertain without observations`, async () => {
      const fixture = listFixtures().find((candidate) => candidate.name === name);
      if (!fixture) throw new Error(`missing ${name} fixture`);
      const run = await runFixture({
        ...fixture,
        manifest: { ...fixture.manifest, observations: undefined, skipRuntime: true },
      });
      const detail = describeFixtureRun(fixture, run);
      expect(run.staticResult.stats.branchCount, detail).toBeGreaterThan(0);
    });
  }

  it("ignores router state captured for another url", async () => {
    const fixture = listFixtures().find((candidate) => candidate.name === "react-router-observed");
    if (!fixture?.manifest.observations?.router) throw new Error("missing router fixture");
    const { router } = fixture.manifest.observations;
    const run = await runFixture({
      ...fixture,
      manifest: {
        ...fixture.manifest,
        observations: {
          ...fixture.manifest.observations,
          router: { ...router, location: { ...router.location, pathname: "/posts/other" } },
        },
        skipRuntime: true,
      },
    });
    const detail = describeFixtureRun(fixture, run);
    expect(run.staticResult.stats.branchCount, detail).toBeGreaterThan(0);
  });

  it("keeps a mutation uncertain when captures predate mutation recording", async () => {
    const fixture = listFixtures().find(
      (candidate) => candidate.name === "tanstack-mutation-observed",
    );
    if (!fixture) throw new Error("missing tanstack-mutation-observed fixture");
    const run = await runFixture({
      ...fixture,
      manifest: {
        ...fixture.manifest,
        observations: { globals: {}, queries: [] },
        skipRuntime: true,
      },
    });
    const detail = describeFixtureRun(fixture, run);
    expect(run.staticResult.stats.branchCount, detail).toBeGreaterThan(0);
  });
});

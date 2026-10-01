import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { formatPattern, getRenderPattern } from "../src/harness/index.js";
import { startSsaProfile, stopSsaProfile, type SsaProfile } from "../src/evaluate/ssa-profile.js";
import type { StaticRenderResult } from "../src/index.js";
import {
  createComponentRenderer,
  listComponentFixtures,
  type ComponentFixture,
} from "./helpers/component-runner.js";
import { createFixtureRenderer, listFixtures, type FixtureCase } from "./helpers/fixture-runner.js";
import { createSsaReportBuilder, formatSsaReport } from "./helpers/ssa-fixture-report.js";

interface RenderStatic {
  (): Promise<StaticRenderResult>;
}

interface ReportTarget {
  name: string;
  createRender: () => Promise<RenderStatic>;
}

interface TimedRender {
  result: StaticRenderResult;
  milliseconds: number;
}

interface ProfiledRender extends TimedRender {
  profile: SsaProfile;
}

const PROFILE_PARITY_TARGETS = [
  "components/array-reduce-closure.tsx",
  "components/loop-completion-catch.tsx",
  "fixtures/conditionals-lists",
];
const reportDirectory = process.env.BIPPY_SSA_REPORT;
const reportFilter = process.env.BIPPY_SSA_REPORT_FILTER;
const warmRepeats = Number(process.env.BIPPY_SSA_REPORT_REPEATS ?? 5);

const getComponentTarget = (fixture: ComponentFixture): ReportTarget => ({
  name: `components/${fixture.name}`,
  createRender: async () => {
    const renderer = await createComponentRenderer();
    return () => renderer.renderComponent(fixture.filePath);
  },
});

const getAppTarget = (fixture: FixtureCase): ReportTarget => ({
  name: `fixtures/${fixture.name}`,
  createRender: async () => {
    const renderer = await createFixtureRenderer(fixture);
    return () => renderer.render();
  },
});

const getReportTargets = (): ReportTarget[] => [
  ...listComponentFixtures().map(getComponentTarget),
  ...listFixtures().map(getAppTarget),
];

const timeRender = async (render: RenderStatic): Promise<TimedRender> => {
  const startedAt = performance.now();
  const result = await render();
  return { result, milliseconds: performance.now() - startedAt };
};

const profileRender = async (render: RenderStatic): Promise<ProfiledRender> => {
  const profile = startSsaProfile();
  try {
    return { ...(await timeRender(render)), profile };
  } finally {
    stopSsaProfile(profile);
  }
};

const getObservableRender = (result: StaticRenderResult) => ({
  pattern: formatPattern(getRenderPattern(result)),
  diagnostics: result.diagnostics,
  stats: result.stats,
});

describe("SSA profiling", () => {
  const targets = getReportTargets().filter(({ name }) => PROFILE_PARITY_TARGETS.includes(name));

  it("finds every parity target", () => {
    expect(targets.map(({ name }) => name).sort()).toEqual([...PROFILE_PARITY_TARGETS].sort());
  });

  it.each(targets.map((target) => ({ name: target.name, target })))(
    "leaves the static render and diagnostics of $name unchanged",
    async ({ target }) => {
      const unprofiled = await (await target.createRender())();
      const profiled = await profileRender(await target.createRender());
      expect(getObservableRender(profiled.result)).toEqual(getObservableRender(unprofiled));
      expect(profiled.profile.functions.size).toBeGreaterThan(0);
    },
  );
});

describe.runIf(reportDirectory)("SSA fixture report", () => {
  it("profiles every fixture", { timeout: 0 }, async () => {
    const builder = createSsaReportBuilder();
    const targets = getReportTargets().filter(
      ({ name }) => !reportFilter || name.includes(reportFilter),
    );
    for (const target of targets) {
      const setupStartedAt = performance.now();
      const render = await target.createRender();
      const setupMilliseconds = performance.now() - setupStartedAt;
      const cold = await profileRender(render);
      const heapUsedBytes = process.memoryUsage().heapUsed;
      const warm: TimedRender[] = [];
      const warmProfiled: ProfiledRender[] = [];
      for (let repeat = 0; repeat < warmRepeats; repeat++) {
        warm.push(await timeRender(render));
        warmProfiled.push(await profileRender(render));
      }
      builder.addFixture({
        name: target.name,
        setupMilliseconds,
        coldMilliseconds: cold.milliseconds,
        warmMilliseconds: warm.map(({ milliseconds }) => milliseconds),
        warmProfiledMilliseconds: warmProfiled.map(({ milliseconds }) => milliseconds),
        heapUsedBytes,
        cold: cold.profile,
        warm: warmProfiled.map(({ profile }) => profile),
      });
    }
    const report = builder.build();
    const directory = reportDirectory ?? "";
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "ssa-fixture-report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    writeFileSync(join(directory, "ssa-fixture-report.md"), `${formatSsaReport(report)}\n`);
    process.stdout.write(`SSA fixture report: ${join(directory, "ssa-fixture-report.md")}\n`);
    expect(report.totals.fixtures).toBe(targets.length);
  });
});

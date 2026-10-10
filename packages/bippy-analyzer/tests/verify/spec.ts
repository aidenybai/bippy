import { join } from "node:path";
import { test as base, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { CACHE_DIRECTORY, loadRepos } from "../../conformance/runner/repos.js";
import { analyzeProject } from "../../src/core/entrypoint/analyze-project.js";
import type { AnalyzedComponent, Sample } from "../../src/core/inference/types.js";
import { getDefaultProps } from "./driver.js";
import type { Observation } from "./driver.js";
import { matchesExpected, normalizeShapes, toExpected } from "./match.js";
import { collectMutationProbes } from "./mutation.js";
import { collectProbes, countWrongClaims, scoreComponent } from "./score.js";
import type { ComponentVerdict } from "./score.js";
import { readHarnessSetup, startHarness } from "./server.js";
import type { Capture, MountRequest } from "./types.js";
import { openPage } from "./verify.js";

interface VerifyProject {
  url: string;
  components: AnalyzedComponent[];
  knownComponents: Map<string, string>;
  getModuleUrl: (file: string) => string;
}

interface MountOptions {
  props?: Record<string, unknown>;
  scenario?: [name: string, ...args: unknown[]];
}

interface MountedComponent {
  page: Page;
  click: (label: string) => Promise<void>;
  observe: () => Promise<void>;
  expectState: (label: string) => void;
}

interface Session {
  component: AnalyzedComponent;
  observations: Observation[];
}

interface VerifyFixtures {
  mountComponent: (componentName: string, options?: MountOptions) => Promise<MountedComponent>;
}

interface VerifyWorkerFixtures {
  repo: string;
  project: VerifyProject;
}

const toSample = (value: unknown): Sample => {
  if (value === undefined) return { kind: "Undefined" };
  if (typeof value === "function") return { kind: "Function" };
  if (Array.isArray(value)) return { kind: "Array", items: value.map(toSample) };
  if (value !== null && typeof value === "object")
    return {
      kind: "Object",
      fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toSample(item)])),
    };
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return { kind: "Value", value };
  throw new Error(`Can't pass ${typeof value} as a prop`);
};

const formatWrongClaims = (verdict: ComponentVerdict): string[] => [
  ...verdict.wrongStates.map(
    (wrong) => `unpredicted state after [${wrong.path.join(" → ")}]: ${wrong.rendered}`,
  ),
  ...verdict.wrongEdges.map(
    (wrong) =>
      `${wrong.reason}: ${wrong.action} went ${wrong.fromStates.map((state) => `S${state + 1}`).join("|")} → ${wrong.toStates.map((state) => `S${state + 1}`).join("|")}`,
  ),
  ...verdict.wrongValues.map(
    (wrong) => `${wrong.place} = ${wrong.value}, predicted ${wrong.predicted.join(" | ")}`,
  ),
  ...verdict.refutedDeadClaims.map((claim) => `dead branch was reached: ${claim}`),
  ...verdict.refutedWarnings.map((warning) => `mutation warning refuted: ${warning}`),
];

/**
 * Playwright fixtures for hand-written scenarios. A spec names its repo with
 * `test.use({ repo })`, mounts components in the harness, drives them, and asserts the
 * states it expects. Everything a test observes is scored against the analyzer's claims
 * when it ends, so a scenario fails on any wrong claim it runs into.
 */
export const test = base.extend<VerifyFixtures, VerifyWorkerFixtures>({
  repo: ["", { scope: "worker", option: true }],
  project: [
    async ({ repo: repoId }, use) => {
      const [repo] = loadRepos([repoId]);
      if (!repo) throw new Error(`Unknown repo ${repoId}`);
      const appDirectory = join(CACHE_DIRECTORY, repo.id, repo.workingDirectory);
      const { components } = analyzeProject(join(appDirectory, repo.tsconfig));
      const exported = components.filter(({ analysis }) => analysis.exportName);
      const harness = await startHarness(
        appDirectory,
        exported.flatMap(({ analysis }) => [
          ...collectProbes(analysis),
          ...collectMutationProbes(analysis),
        ]),
        [...new Set(exported.map(({ analysis }) => analysis.file))],
        readHarnessSetup(repo.setupDirectory ?? null),
      );
      await use({
        url: harness.url,
        components,
        knownComponents: new Map(
          components.map(({ analysis }) => [
            analysis.declaration,
            analysis.displayName ?? analysis.name,
          ]),
        ),
        getModuleUrl: harness.getModuleUrl,
      });
      await harness.close();
    },
    { scope: "worker" },
  ],
  mountComponent: async ({ browser, project }, use) => {
    const sessions: Session[] = [];
    const page = await openPage(browser, project.url);
    await use(async (componentName, options = {}) => {
      const component = project.components.find(
        ({ analysis }) => analysis.name === componentName && analysis.exportName,
      );
      const exportName = component?.analysis.exportName;
      if (!component || !exportName)
        throw new Error(`No exported component named ${componentName}`);
      const { analysis, report } = component;
      const props = {
        ...getDefaultProps(analysis),
        ...Object.fromEntries(
          Object.entries(options.props ?? {}).map(([name, value]) => [name, toSample(value)]),
        ),
      };
      const request: MountRequest = {
        moduleUrl: project.getModuleUrl(analysis.file),
        exportName,
        props,
        scenario: options.scenario
          ? { name: options.scenario[0], args: options.scenario.slice(1) }
          : null,
      };
      const session: Session = { component, observations: [] };
      sessions.push(session);
      let current: Capture = await page.evaluate(
        (mountRequest) => window.__verify.mount(mountRequest),
        request,
      );
      expect(current.error, `${componentName} failed to render`).toBeNull();
      session.observations.push({ props, path: [], action: null, before: null, after: current });
      let path: string[] = [];

      return {
        page,
        click: async (label) => {
          const actions = await page.evaluate(() => window.__verify.actions());
          const action = actions.find(
            (candidate) => candidate.kind === "click" && candidate.label === label,
          );
          if (!action)
            throw new Error(
              `Nothing clickable labelled "${label}" in ${componentName}: ${actions.map((candidate) => candidate.label).join(", ")}`,
            );
          const after = await page.evaluate((key) => window.__verify.perform(key), action.key);
          if (!after) throw new Error(`Clicking "${label}" failed`);
          path = [...path, action.key];
          session.observations.push({ props, path, action, before: current, after });
          current = after;
        },
        observe: async () => {
          current = await page.evaluate(() => window.__verify.observe());
          session.observations.push({ props, path, action: null, before: null, after: current });
        },
        expectState: (label) => {
          const states = report.states.filter(
            (state) => (state.assumptions.join(" ∧ ") || "always") === label,
          );
          expect(
            states.length,
            `${componentName} has no state labelled "${label}". Its states are:\n${report.states.map((state) => state.assumptions.join(" ∧ ") || "always").join("\n")}`,
          ).toBeGreaterThan(0);
          const shapes = normalizeShapes(current.shapes);
          expect(
            states.some((state) =>
              matchesExpected(toExpected(state.render, project.knownComponents), shapes),
            ),
            `${componentName} isn't showing "${label}"`,
          ).toBe(true);
        },
      };
    });
    await page.close();
    for (const session of sessions) {
      const verdict = scoreComponent(
        session.component.analysis,
        session.component.report,
        session.observations,
        project.knownComponents,
      );
      expect(formatWrongClaims(verdict), `${verdict.name} made wrong claims`).toEqual([]);
      expect(countWrongClaims(verdict)).toBe(0);
    }
  },
});

export { expect };

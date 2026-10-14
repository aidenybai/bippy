import { join } from "node:path";
import playwrightTest, { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { CACHE_DIRECTORY, loadRepos } from "../runner/repos";
import { analyzeProject } from "../../../src/core/analyze-project";
import type { AnalyzedComponent, Sample, State } from "../../../src/core/types";
import { listActionsInPage, mountInPage, performInPage, resolveWrappers } from "./driver";
import { getDefaultProps } from "./props";
import type { Observation } from "./driver";
import { matchesExpected, normalizeShapes, toExpected } from "./match";
import { formatCounterexamples, scoreComponent } from "./score";
import type { Capture, MountRequest } from "./types";
import { openPage, startProjectHarness } from "./verify";
import type { ProjectHarness } from "./verify";
import { CONDITION_SEPARATOR, UNCONDITIONAL_LABEL } from "../../../src/core/format";

interface VerifyProject extends ProjectHarness {
  components: AnalyzedComponent[];
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

const getStateLabel = (state: State): string =>
  state.conditions.join(CONDITION_SEPARATOR) || UNCONDITIONAL_LABEL;

const toSample = (value: unknown): Sample => {
  if (value === undefined) return { kind: "Undefined" };
  if (typeof value === "function") return { kind: "Function", returns: null };
  if (Array.isArray(value)) return { kind: "Array", items: value.map(toSample) };
  if (value !== null && typeof value === "object")
    return {
      kind: "Object",
      fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toSample(item)])),
      isOpen: false,
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

export const test = playwrightTest.extend<VerifyFixtures, VerifyWorkerFixtures>({
  repo: ["", { scope: "worker", option: true }],
  project: [
    async ({ repo: repoId }, use) => {
      const [repo] = loadRepos([repoId]);
      if (!repo) throw new Error(`Unknown repo ${repoId}`);
      const appDirectory = join(CACHE_DIRECTORY, repo.id, repo.workingDirectory);
      const { components } = analyzeProject(join(appDirectory, repo.tsconfig));
      const harness = await startProjectHarness(
        appDirectory,
        components,
        components,
        repo.setupDirectory,
      );
      await use({ ...harness, components });
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
        module: project.getComponentModule(analysis.file),
        exportName,
        props,
        scenario: options.scenario
          ? { name: options.scenario[0], args: options.scenario.slice(1) }
          : null,
        wrappers: [],
      };
      ({ wrappers: request.wrappers } = await resolveWrappers(
        page,
        { ...request, scenario: null },
        analysis,
        project.projectIndex,
      ));
      const session: Session = { component, observations: [] };
      sessions.push(session);
      let current: Capture = await mountInPage(page, request);
      expect(current.error, `${componentName} failed to render`).toBeNull();
      session.observations.push({ props, path: [], action: null, before: null, after: current });
      let path: string[] = [];

      return {
        page,
        click: async (label) => {
          const actions = await listActionsInPage(page);
          const action = actions.find(
            (candidate) => candidate.kind === "click" && candidate.label === label,
          );
          if (!action)
            throw new Error(
              `Nothing clickable labelled "${label}" in ${componentName}: ${actions.map((candidate) => candidate.label).join(", ")}`,
            );
          const after = await performInPage(page, action.key);
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
          const states = report.states.filter((state) => getStateLabel(state) === label);
          expect(
            states.length,
            `${componentName} has no state labelled "${label}". Its states are:\n${report.states.map(getStateLabel).join("\n")}`,
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
      expect(formatCounterexamples(verdict), `${verdict.name} has counterexamples`).toEqual([]);
    }
  },
});

export { expect };

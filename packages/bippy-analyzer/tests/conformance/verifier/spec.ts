import { join } from "node:path";
import playwrightTest, { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { CACHE_DIRECTORY, loadRepos } from "../runner/repos";
import { analyzeProject } from "../../../src/core/analyze-project";
import type { AnalyzedComponent, ComponentAnalysis, Sample, State } from "../../../src/core/types";
import { listActionsInPage, mountInPage, performInPage, resolveWrappers } from "./driver";
import { getDefaultProps } from "./props";
import type { Observation } from "./driver";
import { matchesExpected, normalizeShapes, toExpected } from "./match";
import { formatCounterexamples, scoreComponent } from "./score";
import type { Action, Capture, MountRequest, Scenario } from "./types";
import { openPage, startProjectHarness } from "./verify";
import type { ProjectHarness } from "./verify";
import { CONDITION_SEPARATOR, UNCONDITIONAL_LABEL } from "../../../src/core/format";

interface VerifyProject extends ProjectHarness {
  components: AnalyzedComponent[];
}

interface MountOptions {
  props?: Record<string, unknown>;
  scenario?: Scenario;
}

interface ComponentFixture {
  page: Page;
  click: (label: string) => Promise<void>;
  observe: () => Promise<void>;
  expectState: (label: string) => void;
}

interface ExportedComponent {
  component: AnalyzedComponent;
  exportName: string;
}

interface Session {
  component: AnalyzedComponent;
  observations: Observation[];
}

interface VerifyFixtures {
  mountComponent: (componentName: string, options?: MountOptions) => Promise<ComponentFixture>;
}

interface VerifyWorkerFixtures {
  repo: string;
  project: VerifyProject;
}

interface FixtureContext {
  page: Page;
  project: VerifyProject;
  session: Session;
  props: Record<string, Sample>;
  initialCapture: Capture;
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

const findClickAction = async (
  page: Page,
  label: string,
  componentName: string,
): Promise<Action> => {
  const actions = await listActionsInPage(page);
  const action = actions.find(
    (candidate) => candidate.kind === "click" && candidate.label === label,
  );
  if (action) return action;
  throw new Error(
    `Nothing clickable labelled "${label}" in ${componentName}: ${actions.map((candidate) => candidate.label).join(", ")}`,
  );
};

const expectShowingState = (
  project: VerifyProject,
  component: AnalyzedComponent,
  capture: Capture,
  label: string,
): void => {
  const { name: componentName } = component.analysis;
  const { states } = component.report;
  const labelledStates = states.filter((state) => getStateLabel(state) === label);
  expect(
    labelledStates.length,
    `${componentName} has no state labelled "${label}". Its states are:\n${states.map(getStateLabel).join("\n")}`,
  ).toBeGreaterThan(0);
  const shapes = normalizeShapes(capture.shapes);
  expect(
    labelledStates.some((state) =>
      matchesExpected(toExpected(state.render, project.knownComponents), shapes),
    ),
    `${componentName} isn't showing "${label}"`,
  ).toBe(true);
};

const createComponentFixture = ({
  page,
  project,
  session,
  props,
  initialCapture,
}: FixtureContext): ComponentFixture => {
  let current = initialCapture;
  let path: string[] = [];
  return {
    page,
    click: async (label) => {
      const action = await findClickAction(page, label, session.component.analysis.name);
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
    expectState: (label) => expectShowingState(project, session.component, current, label),
  };
};

const findExportedComponent = (
  project: VerifyProject,
  componentName: string,
): ExportedComponent => {
  for (const component of project.components) {
    const { exportName } = component.analysis;
    if (component.analysis.name === componentName && exportName) return { component, exportName };
  }
  throw new Error(`No exported component named ${componentName}`);
};

const getMountProps = (
  analysis: ComponentAnalysis,
  options: MountOptions,
): Record<string, Sample> => ({
  ...getDefaultProps(analysis),
  ...Object.fromEntries(
    Object.entries(options.props ?? {}).map(([name, value]) => [name, toSample(value)]),
  ),
});

const startSession = async (
  page: Page,
  project: VerifyProject,
  componentName: string,
  options: MountOptions,
): Promise<FixtureContext> => {
  const { component, exportName } = findExportedComponent(project, componentName);
  const { analysis } = component;
  const props = getMountProps(analysis, options);
  const baseRequest: MountRequest = {
    module: project.getComponentModule(analysis.file),
    exportName,
    props,
    scenario: null,
    wrappers: [],
  };
  const { wrappers } = await resolveWrappers(page, baseRequest, analysis, project.projectIndex);
  const initialCapture = await mountInPage(page, {
    ...baseRequest,
    scenario: options.scenario ?? null,
    wrappers,
  });
  expect(initialCapture.error, `${componentName} failed to render`).toBeNull();
  const session: Session = {
    component,
    observations: [{ props, path: [], action: null, before: null, after: initialCapture }],
  };
  return { page, project, session, props, initialCapture };
};

const expectNoCounterexamples = (project: VerifyProject, session: Session): void => {
  const verdict = scoreComponent(
    session.component.analysis,
    session.component.report,
    session.observations,
    project.knownComponents,
  );
  expect(formatCounterexamples(verdict), `${verdict.name} has counterexamples`).toEqual([]);
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
      const fixtureContext = await startSession(page, project, componentName, options);
      sessions.push(fixtureContext.session);
      return createComponentFixture(fixtureContext);
    });
    await page.close();
    for (const session of sessions) expectNoCounterexamples(project, session);
  },
});

export { expect };

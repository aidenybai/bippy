import { describe, expect, it } from "vite-plus/test";
import { GeneratedSource } from "../../src/react-compiler/HIR/HIR";
import type { ComponentAnalysis, Sample } from "../../src/core/types";
import { parseExports } from "../conformance/verifier/source-index";
import type { ExportedName, ProjectIndex } from "../conformance/verifier/types";
import { proposeParents } from "../conformance/verifier/wrappers";
import type { ParentQuery } from "../conformance/verifier/wrappers";

const DRAWER_FILE = "/app/ui/drawer.tsx";
const DIALOG_FILE = "/app/ui/dialog.tsx";
const CONTEXT_FILE = "/app/context/ui-app-state.ts";

const createAnalysis = (name: string, file: string): ComponentAnalysis => ({
  name,
  exportName: name,
  runtimeName: name,
  file,
  declaration: `${file}#${name}`,
  loc: GeneratedSource,
  isAsync: false,
  bindings: [],
  propsSample: null,
  providedContexts: [],
  contextSamples: new Map(),
  untypedContexts: new Map(),
  placeDomains: new Map(),
  render: { kind: "Primitive", value: null },
  handlers: [],
  renders: [],
  bailouts: [],
  warnings: [],
});

const createProject = (exports: Record<string, ExportedName[]>): ProjectIndex => ({
  exports: new Map(Object.entries(exports)),
  imports: new Map([
    [DRAWER_FILE, { packages: [{ specifier: "vaul", names: ["Drawer"] }], files: [] }],
  ]),
  components: new Map(),
  contextSamples: new Map<string, Sample>([
    [`${CONTEXT_FILE}#UIAppStateContext`, { kind: "Object", fields: {}, isOpen: true }],
  ]),
});

const createQuery = (overrides: Partial<ParentQuery>): ParentQuery => {
  const analysis = createAnalysis(overrides.name ?? "DrawerTitle", overrides.file ?? DRAWER_FILE);
  return {
    name: analysis.name,
    file: analysis.file,
    error: "",
    isNamingParent: true,
    analysis,
    project: createProject({}),
    ...overrides,
  };
};

const getNames = (query: ParentQuery): string[] =>
  proposeParents(query).map((wrapper) => wrapper.name);

describe("proposeParents", () => {
  it("tries a part's own outermost root before another file's parent of the name its error gives", () => {
    const project = createProject({
      Drawer: [{ file: DRAWER_FILE, exportName: "Drawer" }],
      DrawerTitle: [{ file: DRAWER_FILE, exportName: "DrawerTitle" }],
      Dialog: [{ file: DIALOG_FILE, exportName: "Dialog" }],
    });
    const proposals = proposeParents(
      createQuery({ error: "`DialogTitle` must be used within `Dialog`", project }),
    );
    expect(proposals.map((wrapper) => wrapper.name).slice(0, 2)).toEqual(["Drawer", "Dialog"]);
    expect(proposals).toContainEqual({
      name: "Dialog",
      source: "named",
      candidate: {
        kind: "package",
        specifier: "vaul",
        namespace: "Drawer",
        exportName: "Dialog",
        importer: DRAWER_FILE,
        props: {},
      },
    });
  });

  it("tries the named parent first when the component's own file exports it", () => {
    const project = createProject({
      Dialog: [{ file: DIALOG_FILE, exportName: "Dialog" }],
      DialogTitle: [{ file: DIALOG_FILE, exportName: "DialogTitle" }],
    });
    expect(
      getNames(
        createQuery({
          name: "DialogTitle",
          file: DIALOG_FILE,
          error: "`DialogTitle` must be used within `Dialog`",
          project,
        }),
      )[0],
    ).toBe("Dialog");
  });

  it("offers the context named after a hook that came up empty, with a sample of its value", () => {
    const project = createProject({
      UIAppStateContext: [{ file: CONTEXT_FILE, exportName: "UIAppStateContext" }],
    });
    const [proposal] = proposeParents(
      createQuery({
        error: "Cannot destructure property 'theme' of 'useUIAppState(...)' as it is null.",
        isNamingParent: false,
        project,
      }),
    );
    expect(proposal?.name).toBe("UIAppStateContext");
    expect(proposal?.candidate.props).toEqual({
      value: { kind: "Object", fields: {}, isOpen: true },
    });
  });
});

describe("parseExports", () => {
  it("records a default export under the name a module import sees", () => {
    expect(parseExports("export default function Panel() {}\nexport const Row = 1;")).toEqual([
      { name: "Panel", exportName: "default" },
      { name: "Row", exportName: "Row" },
    ]);
  });
});

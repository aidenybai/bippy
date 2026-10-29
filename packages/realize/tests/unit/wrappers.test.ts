import { describe, expect, it } from "vite-plus/test";
import { GeneratedSource } from "../../src/react-compiler/HIR/HIR";
import type { ComponentAnalysis, Sample } from "../../src/core/types";
import { parseExports } from "../conformance/verifier/source-index";
import type { ExportedName, ProjectIndex } from "../conformance/verifier/types";
import { createEmptyAnalysis } from "../../src/core/project/analyze-component";
import {
  findRootParts,
  proposeParents,
  resolveNamedParent,
} from "../conformance/verifier/wrappers";
import type { ParentQuery } from "../conformance/verifier/wrappers";

const DRAWER_FILE = "/app/ui/drawer.tsx";
const DIALOG_FILE = "/app/ui/dialog.tsx";
const CONTEXT_FILE = "/app/context/ui-app-state.ts";

const createAnalysis = (name: string, file: string): ComponentAnalysis =>
  createEmptyAnalysis(
    { name, exportName: name, runtimeName: name, file, declaration: `${file}#${name}` },
    GeneratedSource,
    { kind: "Primitive", value: null },
  );

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

  it("tries the named parent first when the component's file imports the file that exports it", () => {
    const selectFile = "/app/ui/select.tsx";
    const codeBlockFile = "/app/ai/code-block.tsx";
    const project: ProjectIndex = {
      ...createProject({
        CodeBlock: [{ file: codeBlockFile, exportName: "CodeBlock" }],
        CodeBlockSelectorTrigger: [{ file: codeBlockFile, exportName: "CodeBlockSelectorTrigger" }],
        Select: [{ file: selectFile, exportName: "Select" }],
      }),
      imports: new Map([[codeBlockFile, { packages: [], files: [selectFile] }]]),
    };
    expect(
      getNames(
        createQuery({
          name: "CodeBlockSelectorTrigger",
          file: codeBlockFile,
          error: "`SelectTrigger` must be used within `Select`",
          project,
        }),
      ).slice(0, 2),
    ).toEqual(["Select", "CodeBlock"]);
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

  it("offers the compound root of a part the component renders from another file", () => {
    const commandFile = "/app/ui/command.tsx";
    const optionFile = "/app/filters/option-item.tsx";
    const project: ProjectIndex = {
      ...createProject({
        Command: [{ file: commandFile, exportName: "Command" }],
        CommandItem: [{ file: commandFile, exportName: "CommandItem" }],
        OptionItem: [{ file: optionFile, exportName: "OptionItem" }],
      }),
      imports: new Map([[optionFile, { packages: [], files: [commandFile] }]]),
    };
    const analysis = {
      ...createAnalysis("OptionItem", optionFile),
      renders: ["Checkbox", "CommandItem"],
    };
    expect(
      proposeParents(
        createQuery({
          name: "OptionItem",
          file: optionFile,
          error: "Cannot read properties of undefined (reading 'subscribe')",
          isNamingParent: false,
          analysis,
          project,
        }),
      ),
    ).toEqual([
      {
        name: "Command",
        source: "root",
        candidate: { kind: "project", file: commandFile, exportName: "Command", props: {} },
      },
    ]);
  });
});

describe("findRootParts", () => {
  it("offers first the part named by the hook that came up empty", () => {
    const comboboxFile = "/app/ui/combobox.tsx";
    const project = createProject({
      Combobox: [{ file: comboboxFile, exportName: "Combobox" }],
      ComboboxInput: [{ file: comboboxFile, exportName: "ComboboxInput" }],
      ComboboxChips: [{ file: comboboxFile, exportName: "ComboboxChips" }],
      ComboboxChip: [{ file: comboboxFile, exportName: "ComboboxChip" }],
    });
    const query = createQuery({
      name: "ComboboxChip",
      file: comboboxFile,
      error:
        "Cannot destructure property 'setHighlightedChipIndex' of 'useComboboxChipsContext(...)' as it is undefined.",
      isNamingParent: false,
      project,
    });
    const roots = proposeParents(query).slice(0, 1);
    expect(roots.map((wrapper) => wrapper.name)).toEqual(["Combobox"]);
    expect(
      roots.flatMap((root) => findRootParts(root, query)).map((wrapper) => wrapper.name),
    ).toEqual(["ComboboxChips", "ComboboxInput"]);
  });

  it("offers the other parts exported beside a root, except the component itself", () => {
    const commandFile = "/app/ui/command.tsx";
    const project = createProject({
      Command: [{ file: commandFile, exportName: "Command" }],
      CommandList: [{ file: commandFile, exportName: "CommandList" }],
      CommandItem: [{ file: commandFile, exportName: "CommandItem" }],
      CommandShortcut: [{ file: "/app/ui/shortcut.tsx", exportName: "CommandShortcut" }],
    });
    const query = createQuery({ name: "CommandItem", file: commandFile, project });
    const roots = proposeParents(query).slice(0, 1);
    expect(roots.map((wrapper) => wrapper.name)).toEqual(["Command"]);
    expect(
      roots.flatMap((root) => findRootParts(root, query)).map((wrapper) => wrapper.name),
    ).toEqual(["CommandList"]);
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

describe("resolveNamedParent", () => {
  it("finds a compound part an error names with a dot under its joined export name", () => {
    const project = createProject({
      QuestionnaireItem: [{ file: "/app/ui/questionnaire.tsx", exportName: "QuestionnaireItem" }],
    });
    expect(
      resolveNamedParent(
        "Questionnaire.Choices must be used within a Questionnaire.Item component.",
        project,
      ),
    ).toBe("QuestionnaireItem");
  });
});

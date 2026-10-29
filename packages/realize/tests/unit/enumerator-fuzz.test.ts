// @vitest-environment happy-dom
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { FunctionComponent } from "react";
import { transformWithEsbuild } from "vite";
import { describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../../src/core/project/analyze-project";
import { getBranchKey } from "../../src/core/interpret/control-flow";
import type { AnalyzedComponent } from "../../src/core/types";

type FuzzValue = string | boolean | number | null;

interface FuzzProps {
  [name: string]: FuzzValue;
}

interface FuzzVariable {
  name: string;
  expression: string;
  values: FuzzValue[];
  isWide?: boolean;
}

interface FuzzHook {
  setter: string;
  fields: FuzzVariable[];
  formatStatement: (isEffect: boolean) => string;
}

interface FuzzComponent {
  name: string;
  file: string;
  source: string;
  bodyOffset: number;
  props: FuzzVariable[];
  variables: FuzzVariable[];
}

interface Observation {
  screen: string[];
  isFirstRender: boolean;
}

const COMPONENT_COUNT = Number(process.env.FUZZ_COUNT ?? 40);
const FIRST_SEED = Number(process.env.FUZZ_SEED ?? 1);
const MAX_OBSERVED_STATES = 400;
const STRING_VALUES = ["x", "y", "z"];
const FIELD_NAMES = ["open", "mode"];
const REACT_TYPES = resolve(import.meta.dirname, "../../../../node_modules/@types/react");

const createRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
};

const formatLiteral = (value: FuzzValue): string =>
  typeof value === "string" ? `"${value}"` : String(value);

const isNullable = (variable: FuzzVariable): boolean => variable.values.includes(null);

const formatWideType = (values: FuzzValue[]): string =>
  values.includes(null) ? "string | null" : typeof values[0];

const formatType = (values: FuzzValue[]): string => values.map(formatLiteral).join(" | ");

const isSameKind = (variable: FuzzVariable, other: FuzzVariable): boolean =>
  other.expression !== variable.expression &&
  other.values.every((value) => variable.values.includes(value));

const generateComponent = (seed: number): FuzzComponent => {
  const random = createRandom(seed);
  const pick = <Item>(items: Item[]): Item => items[Math.floor(random() * items.length)] as Item;
  const chance = (probability: number): boolean => random() < probability;
  const createValues = (isProp: boolean): FuzzValue[] =>
    pick<FuzzValue[]>([
      [false, true],
      STRING_VALUES.slice(0, isProp ? 2 : pick([2, 3])),
      isProp ? [0, 1] : [0, 1, 2],
      [null, ...STRING_VALUES.slice(0, 2)],
    ]);
  const props = Array.from({ length: pick([0, 1, 2]) }, (_unused, index) => {
    const values = createValues(true);
    return {
      name: `p${index}`,
      expression: `p${index}`,
      values,
      isWide: typeof values[0] !== "boolean" && chance(0.3),
    };
  });
  const readables: FuzzVariable[] = [...props];
  const formatAtom = (): string => {
    const readable = pick(readables);
    const value = formatLiteral(pick(readable.values));
    if (isNullable(readable))
      return pick([
        () => readable.expression,
        () => `!${readable.expression}`,
        () => `${readable.expression} === ${value}`,
        () => `${readable.expression} ${chance(0.5) ? "==" : "!="} null`,
        () => `(${readable.expression} ?? "x") === "y"`,
      ])();
    if (typeof readable.values[0] === "boolean")
      return chance(0.5) ? readable.expression : `!${readable.expression}`;
    if (typeof readable.values[0] === "string")
      return `${readable.expression} ${chance(0.6) ? "===" : "!=="} ${value}`;
    return `${readable.expression} ${pick(["===", "!==", ">", "<", ">="])} ${value}`;
  };
  const formatCondition = (depth: number): string =>
    depth > 0 && chance(0.3)
      ? `(${formatCondition(depth - 1)} ${chance(0.5) ? "&&" : "||"} ${formatCondition(depth - 1)})`
      : formatAtom();
  const formatTransform = (variable: FuzzVariable, current: string): string => {
    const values = variable.values;
    const last = formatLiteral(values.at(-1) ?? 0);
    if (isNullable(variable))
      return chance(0.5) ? `${current} === null ? "x" : null` : `${current} ?? "y"`;
    if (typeof values[0] === "boolean") return `!${current}`;
    if (typeof values[0] === "string")
      return `${current} === ${formatLiteral(pick(values))} ? ${formatLiteral(pick(values))} : ${formatLiteral(pick(values))}`;
    const arithmetic = chance(0.5)
      ? `${current} === ${last} ? 0 : ${current} + 1`
      : `${current} > 0 ? ${current} - 1 : ${last}`;
    return variable.isWide ? arithmetic : `((${arithmetic}) as ${formatType(values)})`;
  };
  const formatNextValue = (variable: FuzzVariable, current: string): string => {
    const copies = readables.filter((other) => isSameKind(variable, other));
    return pick([
      () => formatLiteral(pick(variable.values)),
      () =>
        `${formatCondition(1)} ? ${formatLiteral(pick(variable.values))} : ${formatLiteral(pick(variable.values))}`,
      () => formatTransform(variable, current),
      ...(typeof variable.values[0] === "boolean" ? [() => formatCondition(1)] : []),
      ...(copies.length > 0 ? [() => pick(copies).expression] : []),
    ])();
  };
  const createInitial = (variable: FuzzVariable): string => {
    const copies = props.filter((prop) => isSameKind(variable, prop));
    return copies.length > 0 && chance(0.2)
      ? pick(copies).expression
      : formatLiteral(pick(variable.values));
  };

  const prelude: string[] = [];
  const declarations: string[] = [];
  const hooks: FuzzHook[] = Array.from({ length: pick([1, 2, 3]) }, (_unused, index) => {
    const name = `s${index}`;
    const setter = `setS${index}`;
    const kind = pick(["state", "state", "object", "reducer", "custom"]);
    if (kind === "object") {
      const fields = FIELD_NAMES.slice(0, pick([1, 2])).map((field) => ({
        name: `${name}_${field}`,
        expression: `${name}.${field}`,
        values: createValues(false),
      }));
      const formatObject = (formatField: (field: FuzzVariable) => string): string =>
        `{ ${fields.map((field) => `${field.expression.split(".")[1]}: ${formatField(field)}`).join(", ")} }`;
      const objectType = `{ ${fields.map((field) => `${field.expression.split(".")[1]}: ${formatType(field.values)}`).join("; ")} }`;
      const initial = formatObject(createInitial);
      declarations.push(
        `  const [${name}, ${setter}] = useState<${objectType}>(${chance(0.3) ? `() => (${initial})` : initial});`,
      );
      readables.push(...fields);
      return {
        setter,
        fields,
        formatStatement: (isEffect) => {
          const field = pick(fields);
          const key = field.expression.split(".")[1];
          const literal = formatLiteral(pick(field.values));
          if (isEffect) return `${setter}((previous) => ({ ...previous, ${key}: ${literal} }));`;
          return pick([
            () =>
              `${setter}((previous) => ({ ...previous, ${key}: ${formatNextValue(field, `previous.${key}`)} }));`,
            () => `${setter}({ ...${name}, ${key}: ${formatNextValue(field, field.expression)} });`,
            () => `${setter}(${formatObject((other) => formatLiteral(pick(other.values)))});`,
          ])();
        },
      };
    }
    const values = createValues(false);
    const variable = {
      name,
      expression: name,
      values,
      isWide: typeof values[0] !== "boolean" && chance(0.4),
    };
    const typeText = variable.isWide ? formatWideType(values) : formatType(values);
    if (kind === "reducer") {
      const actions = Array.from(
        { length: pick([2, 3]) },
        (_action, actionIndex) => `a${actionIndex}`,
      );
      const formatReturn = (): string =>
        chance(0.5) ? formatLiteral(pick(variable.values)) : formatTransform(variable, "state");
      prelude.push(
        `const reducer${index} = (state: ${typeText}, action: ${actions.map((action) => `"${action}"`).join(" | ")}): ${typeText} => {`,
        ...actions
          .slice(0, -1)
          .map((action) => `  if (action === "${action}") return ${formatReturn()};`),
        `  return ${formatReturn()};`,
        "};",
        "",
      );
      declarations.push(
        `  const [${name}, ${setter}] = useReducer(reducer${index}, ${createInitial(variable)});`,
      );
      readables.push(variable);
      return {
        setter,
        fields: [variable],
        formatStatement: () => `${setter}("${pick(actions)}");`,
      };
    }
    const initial = createInitial(variable);
    if (kind === "custom")
      prelude.push(
        `const useS${index} = (initial: ${typeText}) => {`,
        `  const [value, setValue] = useState<${typeText}>(initial);`,
        "  return [value, setValue] as const;",
        "};",
        "",
      );
    declarations.push(
      kind === "custom"
        ? `  const [${name}, ${setter}] = useS${index}(${initial});`
        : `  const [${name}, ${setter}] = useState<${typeText}>(${chance(0.2) ? `() => ${initial}` : initial});`,
    );
    readables.push(variable);
    return {
      setter,
      fields: [variable],
      formatStatement: (isEffect) =>
        isEffect
          ? `${setter}(${formatLiteral(pick(variable.values))});`
          : `${setter}(${chance(0.4) ? `(previous) => ${formatNextValue(variable, "previous")}` : formatNextValue(variable, name)});`,
    };
  });
  const variables = [...props, ...hooks.flatMap((hook) => hook.fields)];

  const getDependencies = (text: string): string =>
    [...new Set(text.match(/\b[psdm]\d+\b/g) ?? [])].join(", ");
  const derivedCount = pick([0, 0, 1, 2]);
  for (let index = 0; index < derivedCount; index++) {
    const condition = formatCondition(1);
    const name = `${chance(0.5) ? "d" : "m"}${index}`;
    declarations.push(
      name.startsWith("m")
        ? `  const ${name} = useMemo(() => ${condition}, [${getDependencies(condition)}]);`
        : `  const ${name} = ${condition};`,
    );
    readables.push({ name, expression: name, values: [false, true] });
  }

  const formatStatements = (indent: string, isEffect: boolean, targets: FuzzHook[]): string[] =>
    Array.from({ length: pick([1, 1, 2, 3]) }, () => {
      const statement = pick(targets).formatStatement(isEffect);
      return chance(0.25)
        ? `${indent}if (${formatCondition(1)}) ${statement}`
        : `${indent}${statement}`;
    });
  const effectDependencies = Array.from({ length: pick([0, 0, 1, 2]) }, () =>
    chance(0.5) ? null : pick(variables),
  );
  const effectTargets = hooks.filter((hook) =>
    hook.fields.every((field) => !effectDependencies.includes(field)),
  );
  if (effectTargets.length > 0)
    for (const dependency of effectDependencies)
      declarations.push(
        "  useEffect(() => {",
        ...formatStatements("    ", true, effectTargets),
        `  }, [${dependency?.expression ?? ""}]);`,
      );

  const formatFunction = (indent: string): string[] => {
    if (!chance(0.3))
      return ["() => {", ...formatStatements(`${indent}  `, false, hooks), `${indent}}`];
    return [
      "async () => {",
      ...formatStatements(`${indent}  `, false, hooks),
      `${indent}  await Promise.resolve();`,
      ...formatStatements(`${indent}  `, false, hooks),
      `${indent}}`,
    ];
  };
  const hoisted: string[] = [];
  const hoist = (condition: string): string => {
    const name = `c${hoisted.length}`;
    hoisted.push(`  const ${name} = ${condition};`);
    return name;
  };
  const body: string[] = [];
  let buttonCount = 0;
  const pushElement = (depth: number, indent: string): void => {
    const childCount = depth === 0 ? pick([2, 3]) : pick([1, 2]);
    body.push(`${indent}<div>`);
    for (let childIndex = 0; childIndex < childCount; childIndex++) {
      const rowTargets = readables.filter(
        (readable) => typeof readable.values[0] === "string" || isNullable(readable),
      );
      const kind = depth >= 2 ? "button" : pick(["ternary", "and", "rows", "button", "button"]);
      if (kind === "rows" && rowTargets.length > 0) {
        body.push(`${indent}  {["x", "y"].map((item, index) => (`);
        const line = body.length + 1;
        body.push(
          `${indent}    <span key={item}>{item === ${pick(rowTargets).expression} ? <i data-m={\`${line}@\${index}:t\`} /> : <i data-m={\`${line}@\${index}:f\`} />}</span>`,
        );
        body.push(`${indent}  ))}`);
        continue;
      }
      if (kind === "button") {
        buttonCount++;
        if (chance(0.4)) {
          const [first, ...rest] = formatFunction("  ");
          const isCallback = chance(0.5);
          declarations.push(
            `  const handle${buttonCount} = ${isCallback ? "useCallback(" : ""}${first}`,
            ...rest.slice(0, -1),
            `${rest.at(-1)}${isCallback ? `, [${getDependencies(rest.join("\n"))}])` : ""};`,
          );
          body.push(
            `${indent}  <button data-h="h${buttonCount}" onClick={handle${buttonCount}}>b</button>`,
          );
          continue;
        }
        const [first, ...rest] = formatFunction(`${indent}    `);
        body.push(`${indent}  <button data-h="h${buttonCount}" onClick=`);
        body.push(`${indent}    {${first}`, ...rest.slice(0, -1), `${rest.at(-1)}}`);
        body.push(`${indent}  >b</button>`);
        continue;
      }
      const line = body.length + 1;
      if (kind === "and") {
        body.push(`${indent}  <i data-c="${line}">{${hoist(formatCondition(1))} && (`);
        body.push(`${indent}    <span data-m="${line}:t">`);
        pushElement(depth + 1, `${indent}      `);
        body.push(`${indent}    </span>`);
        body.push(`${indent}  )}</i>`);
        continue;
      }
      body.push(`${indent}  {${formatCondition(1)} ? (`);
      body.push(`${indent}    <span data-m="${line}:t">`);
      pushElement(depth + 1, `${indent}      `);
      body.push(`${indent}    </span>`);
      body.push(`${indent}  ) : (`);
      body.push(`${indent}    <span data-m="${line}:f">`);
      pushElement(depth + 1, `${indent}      `);
      body.push(`${indent}    </span>`);
      body.push(`${indent}  )}`);
    }
    body.push(`${indent}</div>`);
  };
  const valueMarkers = variables
    .map((variable) => `<b data-n="${variable.name}" data-v={String(${variable.expression})} />`)
    .join("");
  const earlyReturnLines: number[] = [];
  const earlyReturnCount = pick([0, 0, 1, 2]);
  for (let index = 0; index < earlyReturnCount; index++) {
    const line = body.length + 1;
    const passed = earlyReturnLines.map((earlier) => `<i data-m="${earlier}:f" />`).join("");
    body.push(
      `  if (${hoist(formatCondition(1))}) return <p data-m="${line}:t">${passed}${valueMarkers}</p>;`,
    );
    earlyReturnLines.push(line);
  }
  body.push("  return (");
  body.push("    <main>");
  for (const line of earlyReturnLines) body.push(`      <i data-m="${line}:f" />`);
  body.push(`      ${valueMarkers}`);
  pushElement(0, "      ");
  body.push("    </main>");
  body.push("  );");
  body.push("};");

  const prefix = [
    'import { useCallback, useEffect, useMemo, useReducer, useState } from "react";',
    "",
    ...prelude,
    `export const C${seed} = (${
      props.length === 0
        ? ""
        : `{ ${props.map((prop) => prop.name).join(", ")} }: { ${props
            .map(
              (prop) =>
                `${prop.name}: ${prop.isWide ? formatWideType(prop.values) : formatType(prop.values)}`,
            )
            .join("; ")} }`
    }) => {`,
    ...declarations,
    ...hoisted,
  ];
  return {
    name: `C${seed}`,
    file: `c${seed}.tsx`,
    source: `${[...prefix, ...body].join("\n")}\n`,
    bodyOffset: prefix.length,
    props,
    variables,
  };
};

const getPropCombinations = (props: FuzzVariable[]): FuzzProps[] =>
  props.reduce<FuzzProps[]>(
    (combinations, prop) =>
      combinations.flatMap((combination) =>
        prop.values.map((value) => ({ ...combination, [prop.name]: value })),
      ),
    [{}],
  );

const loadComponent = async (fuzz: FuzzComponent): Promise<FunctionComponent<FuzzProps>> => {
  const react = await import("react");
  const jsxRuntime = await import("react/jsx-runtime");
  const transformed = await transformWithEsbuild(fuzz.source, fuzz.file, {
    loader: "tsx",
    jsx: "automatic",
    format: "cjs",
  });
  const loadedModule: { exports: Record<string, FunctionComponent<FuzzProps>> } = { exports: {} };
  const requireModule = (name: string): unknown =>
    name === "react" ? react : name === "react/jsx-runtime" ? jsxRuntime : undefined;
  new Function("require", "module", "exports", transformed.code)(
    requireModule,
    loadedModule,
    loadedModule.exports,
  );
  const component = loadedModule.exports[fuzz.name];
  if (!component) throw new Error(`${fuzz.name} was not exported`);
  return component;
};

const observeComponent = async (
  fuzz: FuzzComponent,
  component: FunctionComponent<FuzzProps>,
): Promise<Observation[]> => {
  const react = await import("react");
  const { flushSync } = await import("react-dom");
  const { createRoot } = await import("react-dom/client");
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  const observations = new Map<string, Observation>();
  const addObservation = (screen: string[], isFirstRender: boolean): void => {
    observations.set(`${screen.join(",")}|${isFirstRender}`, { screen, isFirstRender });
  };
  for (const props of getPropCombinations(fuzz.props)) {
    const readScreen = (container: HTMLElement): string[] => {
      const marked = [...container.querySelectorAll("[data-m]")].map(
        (element) => element.getAttribute("data-m") ?? "",
      );
      const falseAnds = [...container.querySelectorAll("[data-c]")]
        .map((element) => element.getAttribute("data-c") ?? "")
        .filter((line) => !marked.includes(`${line}:t`))
        .map((line) => `${line}:f`);
      return [...new Set([...marked, ...falseAnds])].sort();
    };
    const render = async (path: string[]) => {
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container, {
        onUncaughtError: (error) => {
          throw error;
        },
      });
      await react.act(async () => {
        flushSync(() => root.render(react.createElement(component, props)));
        if (path.length === 0) addObservation(readScreen(container), true);
      });
      for (const handlerId of path) {
        const button = container.querySelector<HTMLElement>(`[data-h="${handlerId}"]`);
        await react.act(async () => button?.click());
      }
      return { root, container };
    };
    const readValues = (container: HTMLElement): string =>
      [...container.querySelectorAll("[data-n]")]
        .map((element) => `${element.getAttribute("data-n")}=${element.getAttribute("data-v")}`)
        .join(",");
    const pending: string[][] = [[]];
    const seenKeys = new Set<string>();
    while (pending.length > 0 && seenKeys.size < MAX_OBSERVED_STATES) {
      const path = pending.shift() ?? [];
      const { root, container } = await render(path);
      const screen = readScreen(container);
      const key = `${screen.join(",")}|${readValues(container)}`;
      const handlerIds = [...container.querySelectorAll("[data-h]")].map(
        (element) => element.getAttribute("data-h") ?? "",
      );
      await react.act(() => root.unmount());
      container.remove();
      addObservation(screen, false);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      for (const handlerId of handlerIds) pending.push([...path, handlerId]);
    }
  }
  return [...observations.values()];
};

const getOutcomeLabel = (
  branchKey: string,
  isTrue: boolean,
  fuzz: FuzzComponent,
): string | null => {
  const start = Number(/:(\d+):\d+:\d+(?:#\d+)?(?:@.*)?$/.exec(branchKey)?.[1] ?? -1);
  const line = fuzz.source.slice(0, start).split("\n").length - fuzz.bodyOffset;
  const row = /@row:\d+:(\d+)$/.exec(branchKey)?.[1];
  const isMarked =
    row === undefined ? fuzz.source.includes(`"${line}:t"`) : fuzz.source.includes(`{\`${line}@`);
  if (!isMarked) return null;
  return `${line}${row === undefined ? "" : `@${row}`}:${isTrue ? "t" : "f"}`;
};

const getMarkedOutcomes = (branches: string[], fuzz: FuzzComponent): string[] => [
  ...new Set(
    branches.flatMap((branch) => {
      const separator = branch.lastIndexOf(":");
      return (
        getOutcomeLabel(branch.slice(0, separator), branch.slice(separator + 1) === "true", fuzz) ??
        []
      );
    }),
  ),
];

const findUnlistedScreens = (
  analyzed: AnalyzedComponent,
  fuzz: FuzzComponent,
  observations: Observation[],
): string[] => {
  const { report } = analyzed;
  const getStateKey = (stateIndex: number): string =>
    getMarkedOutcomes(report.states[stateIndex]?.branches ?? [], fuzz)
      .sort()
      .join(",");
  return report.regions.flatMap((region, regionIndex) => {
    const lines = new Set(
      region.states.flatMap((stateIndex) =>
        getMarkedOutcomes(report.states[stateIndex]?.branches ?? [], fuzz).map(
          (outcome) => outcome.split(":")[0],
        ),
      ),
    );
    const listedKeys = new Set(region.states.map(getStateKey));
    const firstRenderKeys = new Set(region.possibleFirstRenderStates.map(getStateKey));
    return observations.flatMap((observation) => {
      const key = observation.screen
        .filter((outcome) => lines.has(outcome.split(":")[0]))
        .join(",");
      if (!listedKeys.has(key)) return [`region ${regionIndex} renders unlisted ${key}`];
      return observation.isFirstRender && !firstRenderKeys.has(key)
        ? [`region ${regionIndex} first renders ${key}, not a listed first render`]
        : [];
    });
  });
};

const findReachedUnreachableBranches = (
  analyzed: AnalyzedComponent,
  fuzz: FuzzComponent,
  observations: Observation[],
): string[] => {
  const reached = new Set(observations.flatMap((observation) => observation.screen));
  return analyzed.report.unreachableBranches.flatMap((unreachable) => {
    const outcome = getOutcomeLabel(getBranchKey(unreachable.branch), unreachable.isTrueSide, fuzz);
    return outcome && reached.has(outcome)
      ? [`renders ${outcome}, which realize calls unreachable`]
      : [];
  });
};

describe("state enumeration fuzzing against React", () => {
  const directory = mkdtempSync(join(tmpdir(), "realize-enumerator-fuzz-"));
  const fuzzComponents = Array.from({ length: COMPONENT_COUNT }, (_unused, index) =>
    generateComponent(FIRST_SEED + index),
  );
  for (const fuzz of fuzzComponents) writeFileSync(join(directory, fuzz.file), fuzz.source);
  writeFileSync(
    join(directory, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        jsx: "react-jsx",
        strict: true,
        module: "esnext",
        moduleResolution: "bundler",
        target: "es2022",
        noEmit: true,
        skipLibCheck: true,
        typeRoots: [dirname(REACT_TYPES)],
        paths: { react: [REACT_TYPES], "react/*": [`${REACT_TYPES}/*`] },
      },
      include: ["."],
    }),
  );
  const analyzedByName = new Map(
    analyzeProject(join(directory, "tsconfig.json")).components.map((component) => [
      component.analysis.name,
      component,
    ]),
  );

  it.each(fuzzComponents.map((fuzz) => [fuzz.name, fuzz] as const))(
    "%s lists every screen React renders",
    async (_name, fuzz) => {
      const analyzed = analyzedByName.get(fuzz.name);
      expect(analyzed, fuzz.source).toBeDefined();
      if (!analyzed || analyzed.report.isTruncated) return;
      const observations = await observeComponent(fuzz, await loadComponent(fuzz));
      expect(
        [
          ...findUnlistedScreens(analyzed, fuzz, observations),
          ...findReachedUnreachableBranches(analyzed, fuzz, observations),
        ],
        fuzz.source,
      ).toEqual([]);
    },
  );
});

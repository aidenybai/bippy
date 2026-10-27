// @vitest-environment happy-dom
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { check } from "tla-ts";
import { transformWithEsbuild } from "vite";
import type { FunctionComponent } from "react";
import { describe, expect, it } from "vite-plus/test";
import { formatTla } from "../../src/cli/tla";
import { analyzeProject } from "../../src/core/analyze-project";
import type { AnalyzedComponent } from "../../src/core/types";

type FuzzValue = string | boolean;

interface FuzzProps {
  [name: string]: FuzzValue;
}

interface FuzzVariable {
  name: string;
  setter: string;
  values: FuzzValue[];
  initial: FuzzValue;
}

interface FuzzComponent {
  name: string;
  file: string;
  source: string;
  bodyOffset: number;
  props: FuzzVariable[];
  states: FuzzVariable[];
}

interface Observation {
  screen: string[];
  values: string;
}

const COMPONENT_COUNT = Number(process.env.FUZZ_COUNT ?? 40);
const FIRST_SEED = Number(process.env.FUZZ_SEED ?? 1);
const MAX_OBSERVED_STATES = 400;
const STRING_VALUES = ["x", "y", "z"];
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

const formatTlaLiteral = (value: FuzzValue): string =>
  typeof value === "string" ? `"${value}"` : value ? "TRUE" : "FALSE";

const generateComponent = (seed: number): FuzzComponent => {
  const random = createRandom(seed);
  const pick = <Item>(items: Item[]): Item => items[Math.floor(random() * items.length)] as Item;
  const chance = (probability: number): boolean => random() < probability;
  const createVariable = (name: string, isProp: boolean): FuzzVariable => {
    const values: FuzzValue[] = chance(0.5)
      ? [false, true]
      : STRING_VALUES.slice(0, isProp ? 2 : pick([2, 3]));
    return {
      name,
      setter: `set${name[0]?.toUpperCase()}${name.slice(1)}`,
      values,
      initial: pick(values),
    };
  };
  const props = Array.from({ length: pick([0, 1, 2]) }, (_unused, index) =>
    createVariable(`p${index}`, true),
  );
  const states = Array.from({ length: pick([1, 2, 3]) }, (_unused, index) =>
    createVariable(`s${index}`, false),
  );
  const variables = [...props, ...states];
  const formatAtom = (): string => {
    const variable = pick(variables);
    if (typeof variable.values[0] === "boolean")
      return chance(0.5) ? variable.name : `!${variable.name}`;
    return `${variable.name} ${chance(0.6) ? "===" : "!=="} ${formatLiteral(pick(variable.values))}`;
  };
  const formatCondition = (depth: number): string =>
    depth > 0 && chance(0.3)
      ? `(${formatCondition(depth - 1)} ${chance(0.5) ? "&&" : "||"} ${formatCondition(depth - 1)})`
      : formatAtom();
  const formatUpdate = (variable: FuzzVariable): string => {
    const isBoolean = typeof variable.values[0] === "boolean";
    const sameKind = variables.filter(
      (other) =>
        other !== variable && other.values.every((value) => variable.values.includes(value)),
    );
    const options = [
      () => formatLiteral(pick(variable.values)),
      () =>
        `${formatCondition(1)} ? ${formatLiteral(pick(variable.values))} : ${formatLiteral(pick(variable.values))}`,
      () =>
        isBoolean
          ? `(previous) => !previous`
          : `(previous) => (previous === ${formatLiteral(pick(variable.values))} ? ${formatLiteral(pick(variable.values))} : ${formatLiteral(pick(variable.values))})`,
      ...(isBoolean ? [() => `!${variable.name}`, () => formatCondition(1)] : []),
      ...(sameKind.length > 0 ? [() => pick(sameKind).name] : []),
    ];
    return pick(options)();
  };
  const formatStatements = (
    indent: string,
    isLiteral = false,
    targets: FuzzVariable[] = states,
  ): string[] =>
    Array.from({ length: pick([1, 1, 2, 3]) }, () => {
      const variable = pick(targets);
      const value = isLiteral ? formatLiteral(pick(variable.values)) : formatUpdate(variable);
      const statement = `${variable.setter}(${value});`;
      return chance(0.25)
        ? `${indent}if (${formatCondition(1)}) ${statement}`
        : `${indent}${statement}`;
    });
  const formatHandler = (indent: string): string[] => {
    if (!chance(0.3))
      return [`${indent}{() => {`, ...formatStatements(`${indent}  `), `${indent}}}`];
    return [
      `${indent}{async () => {`,
      ...formatStatements(`${indent}  `),
      `${indent}  await Promise.resolve();`,
      ...formatStatements(`${indent}  `),
      `${indent}}}`,
    ];
  };
  const effectDependencies = Array.from({ length: pick([0, 0, 1, 2]) }, () =>
    chance(0.5) ? null : pick(variables),
  );
  const effectTargets = states.filter((state) => !effectDependencies.includes(state));
  const effects =
    effectTargets.length === 0
      ? []
      : effectDependencies.flatMap((dependency) => [
          "  useEffect(() => {",
          ...formatStatements("    ", true, effectTargets),
          `  }, [${dependency?.name ?? ""}]);`,
        ]);

  const lines = [
    'import { useEffect, useState } from "react";',
    "",
    `export const C${seed} = (${
      props.length === 0
        ? ""
        : `{ ${props.map((prop) => prop.name).join(", ")} }: { ${props
            .map((prop) => `${prop.name}: ${prop.values.map(formatLiteral).join(" | ")}`)
            .join("; ")} }`
    }) => {`,
    ...states.map(
      (state) =>
        `  const [${state.name}, ${state.setter}] = useState<${state.values.map(formatLiteral).join(" | ")}>(${formatLiteral(state.initial)});`,
    ),
  ];
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
      const kind = depth >= 3 ? "button" : pick(["ternary", "and", "button", "button"]);
      if (kind === "button") {
        buttonCount++;
        body.push(`${indent}  <button data-h="h${buttonCount}" onClick=`);
        body.push(...formatHandler(`${indent}    `));
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
  const valueMarkers = variables.map(
    (variable) => `<b data-n="${variable.name}" data-v={String(${variable.name})} />`,
  );
  const earlyReturnLine = chance(0.3) ? body.length + 1 : null;
  if (earlyReturnLine !== null)
    body.push(
      `  if (${hoist(formatCondition(1))}) return <p data-m="${earlyReturnLine}:t">${valueMarkers.join("")}</p>;`,
    );
  body.push("  return (");
  body.push(earlyReturnLine === null ? "    <main>" : `    <main data-m="${earlyReturnLine}:f">`);
  for (const marker of valueMarkers) body.push(`      ${marker}`);
  pushElement(0, "      ");
  body.push("    </main>");
  body.push("  );");
  body.push("};");
  return {
    name: `C${seed}`,
    file: `c${seed}.tsx`,
    source: `${[...lines, ...effects, ...hoisted, ...body].join("\n")}\n`,
    bodyOffset: lines.length + effects.length + hoisted.length,
    props,
    states,
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
  tlaNames: string[],
): Promise<Observation[]> => {
  const react = await import("react");
  const { createRoot } = await import("react-dom/client");
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  const variables = [...fuzz.props, ...fuzz.states].filter((variable) =>
    tlaNames.includes(variable.name),
  );
  const observations = new Map<string, Observation>();
  for (const props of getPropCombinations(fuzz.props)) {
    const render = async (path: string[]) => {
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container, {
        onUncaughtError: (error) => {
          throw error;
        },
      });
      await react.act(async () => root.render(react.createElement(component, props)));
      for (const handlerId of path) {
        const button = container.querySelector<HTMLElement>(`[data-h="${handlerId}"]`);
        await react.act(async () => button?.click());
      }
      return { root, container };
    };
    const readObservation = (container: HTMLElement): Observation => {
      const marked = [...container.querySelectorAll("[data-m]")].map(
        (element) => element.getAttribute("data-m") ?? "",
      );
      const falseAnds = [...container.querySelectorAll("[data-c]")]
        .map((element) => element.getAttribute("data-c") ?? "")
        .filter((line) => !marked.includes(`${line}:t`))
        .map((line) => `${line}:f`);
      const valuesByName = new Map(
        [...container.querySelectorAll("[data-n]")].map((element) => [
          element.getAttribute("data-n") ?? "",
          element.getAttribute("data-v") ?? "",
        ]),
      );
      return {
        screen: [...new Set([...marked, ...falseAnds])].sort(),
        values: variables
          .map((variable) => {
            const text = valuesByName.get(variable.name);
            const value = variable.values.find((candidate) => String(candidate) === text);
            return value === undefined ? `?${text}` : formatTlaLiteral(value);
          })
          .join(", "),
      };
    };
    const pending: string[][] = [[]];
    const seenKeys = new Set<string>();
    while (pending.length > 0 && seenKeys.size < MAX_OBSERVED_STATES) {
      const path = pending.shift() ?? [];
      const { root, container } = await render(path);
      const observation = readObservation(container);
      const key = `${observation.screen.join(",")}|${observation.values}`;
      const handlerIds = [...container.querySelectorAll("[data-h]")].map(
        (element) => element.getAttribute("data-h") ?? "",
      );
      await react.act(() => root.unmount());
      container.remove();
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      observations.set(key, observation);
      for (const handlerId of handlerIds) pending.push([...path, handlerId]);
    }
  }
  return [...observations.values()];
};

const getBranchLines = (keys: string[], fuzz: FuzzComponent): Map<number, number> =>
  new Map(
    keys.map((key, index) => {
      const start = Number(/:(\d+):\d+:\d+(?:#\d+)?(?:@.*)?$/.exec(key)?.[1] ?? -1);
      return [index + 1, fuzz.source.slice(0, start).split("\n").length - fuzz.bodyOffset];
    }),
  );

const getTlaObservations = async (
  analyzed: AnalyzedComponent,
  fuzz: FuzzComponent,
  rootDirectory: string,
): Promise<{ observations: Set<string>; tlaNames: string[] }> => {
  const spec = formatTla(analyzed, { rootDirectory, moduleName: fuzz.name });
  const declaredNames = /^VARIABLES (.*)$/m.exec(spec.source)?.[1]?.split(", ") ?? [];
  const tlaNames = [...fuzz.props, ...fuzz.states]
    .map((variable) => variable.name)
    .filter((name) => declaredNames.includes(name));
  const regionNames = Array.from(
    { length: spec.regionCount },
    (_unused, index) => `Region${index + 1}`,
  );
  const printed: string[] = [];
  const result = await check({
    source: `---- MODULE Observed ----\nEXTENDS ${spec.moduleName}, TLC\nSeen == Settled => PrintT(<<${regionNames.join(' \\o "," \\o ')}, <<${tlaNames.join(", ")}>>>>)\n====`,
    config: `${spec.config}INVARIANT Seen\n`,
    loadModule: (name) => (name === spec.moduleName ? spec.source : undefined),
    onPrint: (text) => printed.push(text),
  });
  expect(result.status, spec.source).toBe("success");
  const lineByIndex = getBranchLines(spec.branchKeys, fuzz);
  const observations = new Set(
    printed.map((text) => {
      const match = /^<<"([^"]*)", <<(.*)>>>>$/.exec(text);
      const screen = [
        ...new Set(
          (match?.[1] ?? "")
            .split(",")
            .filter((token) =>
              fuzz.source.includes(`"${lineByIndex.get(Number(token.slice(0, -1)))}:t"`),
            )
            .map((token) => {
              const index = Number(token.slice(0, -1));
              return `${lineByIndex.get(index)}:${token.endsWith("+") ? "t" : "f"}`;
            }),
        ),
      ].sort();
      return `${screen.join(",")}|${match?.[2] ?? ""}`;
    }),
  );
  return { observations, tlaNames };
};

describe("TLA+ fuzzing against React", () => {
  const directory = mkdtempSync(join(tmpdir(), "realize-tla-fuzz-"));
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
    "%s reaches every screen React renders",
    async (_name, fuzz) => {
      const analyzed = analyzedByName.get(fuzz.name);
      expect(analyzed, fuzz.source).toBeDefined();
      if (!analyzed || analyzed.report.isTruncated) return;
      const { observations: tlaObservations, tlaNames } = await getTlaObservations(
        analyzed,
        fuzz,
        directory,
      );
      const reactObservations = await observeComponent(fuzz, await loadComponent(fuzz), tlaNames);
      const missing = reactObservations
        .map((observation) => `${observation.screen.join(",")}|${observation.values}`)
        .filter((key) => !tlaObservations.has(key));
      expect(missing, `${fuzz.source}\nTLA+ reached:\n${[...tlaObservations].join("\n")}`).toEqual(
        [],
      );
    },
  );
});

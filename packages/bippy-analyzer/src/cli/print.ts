import { relative } from "node:path";
import type picocolors from "picocolors";
import { GeneratedSource } from "../react-compiler/hir/hir.js";
import type { SourceLocation } from "../react-compiler/hir/hir.js";
import type {
  AbstractValue,
  AnalyzedComponent,
  Binding,
  ConditionalValue,
  Domain,
  JsxExpressionValue,
  StateUpdate,
  State,
  SymbolicValue,
  Handler,
} from "../core/types.js";
import { forEachJsxElement } from "../core/utils/traverse.js";
import {
  formatAbstractValue,
  formatLine,
  formatPlace,
  formatSymbolicValue,
} from "../core/format.js";
import { getTestExpression } from "../core/utils/truthiness.js";
import { getPlaceKey } from "../core/utils/place-key.js";
import { isRenderingNothing, isRenderingNothingWhenFalse } from "../core/utils/checks.js";
export const ALL_VIEWS = ["data", "render", "states", "warnings", "bailouts"] as const;
export const DEFAULT_RENDER_DEPTH = 12;

export type View = (typeof ALL_VIEWS)[number];

interface TreeNode {
  label: string;
  children: TreeNode[];
}

export interface PrintOptions {
  views: Set<View>;
  colors: ReturnType<typeof picocolors.createColors>;
  rootDirectory: string;
  maxDepth: number;
  isShowingAttributes: boolean;
}

interface ComponentPrintContext extends PrintOptions {
  effects: Map<string, string>;
  triggers: Map<string, string>;
  renderNodeBudget: { remaining: number };
}

const MAX_LABEL_WIDTH = 140;
const MAX_RENDER_NODES = 400;
const MAX_EFFECT_WIDTH = 70;
const MAX_ATTRIBUTE_WIDTH = 30;
const MAX_TRIGGER_TEXT_WIDTH = 24;

const createTreeNode = (label: string, children: TreeNode[] = []): TreeNode => ({
  label,
  children,
});

const renderAsciiTree = (root: TreeNode): string[] => {
  const lines = [root.label];
  const walk = (children: TreeNode[], prefix: string): void => {
    children.forEach((child, index) => {
      const isLast = index === children.length - 1;
      lines.push(`${prefix}${isLast ? "└─ " : "├─ "}${child.label}`);
      walk(child.children, `${prefix}${isLast ? "   " : "│  "}`);
    });
  };
  walk(root.children, "");
  return lines;
};

const truncate = (text: string, width = MAX_LABEL_WIDTH): string =>
  text.length > width ? `${text.slice(0, width - 1)}…` : text;

const formatCases = (cases: AbstractValue[]): string => cases.map(formatAbstractValue).join(" | ");

const formatDomain = (domain: Domain): string => {
  switch (domain.kind) {
    case "Cases":
      return formatCases(domain.cases) + (domain.origin === "call-sites" ? "  (call sites)" : "");
    case "Opaque":
      return domain.typeText;
    case "Unknown":
      return `Unknown(${domain.reason})`;
  }
};

const isIncrementOf = (value: SymbolicValue, binding: Binding): boolean =>
  value.kind === "BinaryExpression" &&
  value.operator === "+" &&
  value.left.kind === "Binding" &&
  value.left.binding.id === binding.id &&
  value.right.kind === "Primitive" &&
  typeof value.right.value === "number" &&
  value.right.value >= 0;

const getNumericInvariant = (binding: Binding, updates: StateUpdate[]): string | null => {
  const { initial } = binding;
  if (
    initial?.kind !== "Primitive" ||
    typeof initial.value !== "number" ||
    !Number.isInteger(initial.value) ||
    updates.length === 0
  )
    return null;
  const initialValue = initial.value;
  const isLiteralAtLeast = (value: SymbolicValue): boolean =>
    value.kind === "Primitive" &&
    typeof value.value === "number" &&
    Number.isInteger(value.value) &&
    value.value >= initialValue;
  return updates.every(
    (update) => isIncrementOf(update.value, binding) || isLiteralAtLeast(update.value),
  )
    ? `integer ≥ ${initialValue}`
    : null;
};

const formatAttributes = (
  node: JsxExpressionValue,
  context: ComponentPrintContext,
  isCompact: boolean,
): string => {
  if (isCompact) return "";
  const { colors } = context;
  const attributes = node.props.flatMap((prop) => {
    const name = prop.kind === "JsxAttribute" ? prop.name : "{...}";
    if (prop.handlerId)
      return [colors.dim(`${name} ⇒ ${context.effects.get(prop.handlerId) ?? "?"}`)];
    if (!context.isShowingAttributes) return [];
    const value = truncate(formatSymbolicValue(prop.value), MAX_ATTRIBUTE_WIDTH);
    return [colors.dim(prop.kind === "JsxAttribute" ? `${name}=${value}` : `...${value}`)];
  });
  return attributes.length > 0 ? ` ${attributes.join(" ")}` : "";
};

const formatTag = (
  node: JsxExpressionValue,
  context: ComponentPrintContext,
  isCompact: boolean,
): string => `<${node.tag.name}${formatAttributes(node, context, isCompact)}>`;

const formatLeaf = (value: SymbolicValue, options: PrintOptions): string | null => {
  const { colors } = options;
  switch (value.kind) {
    case "JsxExpression":
    case "JsxFragment":
    case "Conditional":
    case "ArrayMap":
      return null;
    case "JSXText":
      return JSON.stringify(value.value);
    case "Unknown":
      return colors.red(`⚠ Unknown(${value.reason})`);
    default:
      return isRenderingNothing(value) ? colors.dim("∅") : `{${formatSymbolicValue(value)}}`;
  }
};

const getConditionLabel = (value: ConditionalValue): string =>
  formatSymbolicValue(getTestExpression(value));

/**
 * Prints a render on one line, stopping once the line is too wide to show. Render values
 * share subtrees, so printing all of a large one could take exponential time.
 */
const formatCompact = (value: SymbolicValue, context: ComponentPrintContext): string => {
  const parts: string[] = [];
  let length = 0;
  const write = (part: string): void => {
    if (!part) return;
    parts.push(part);
    length += part.length + 1;
  };
  let isCut = false;
  const visit = (current: SymbolicValue): void => {
    if (length > MAX_LABEL_WIDTH) {
      isCut = true;
      return;
    }
    if (isRenderingNothing(current)) return;
    const leaf = formatLeaf(current, context);
    if (leaf !== null) return write(leaf);
    switch (current.kind) {
      case "JsxExpression":
        write(formatTag(current, context, true));
        return current.children.forEach(visit);
      case "JsxFragment":
        return current.children.forEach(visit);
      case "ArrayMap":
        return write(`↻ ${formatSymbolicValue(current.array)}`);
      case "Conditional":
        return write(`◆ ${getConditionLabel(current)}`);
      default:
        return;
    }
  };
  visit(value);
  return `${parts.join(" ")}${isCut ? "…" : ""}`;
};

const buildRenderNode = (
  value: SymbolicValue,
  context: ComponentPrintContext,
  depth: number,
  prefix = "",
): TreeNode => {
  const { colors } = context;
  const leaf = formatLeaf(value, context);
  if (leaf !== null) return createTreeNode(`${prefix}${leaf}`);
  if (depth >= context.maxDepth || context.renderNodeBudget.remaining <= 0)
    return createTreeNode(`${prefix}${colors.dim("…")}`);
  context.renderNodeBudget.remaining--;
  switch (value.kind) {
    case "JsxExpression": {
      const [onlyChild] = value.children;
      const onlyLeaf =
        value.children.length === 1 && onlyChild && !isRenderingNothing(onlyChild)
          ? formatLeaf(onlyChild, context)
          : null;
      if (onlyLeaf !== null)
        return createTreeNode(truncate(`${prefix}${formatTag(value, context, false)} ${onlyLeaf}`));
      return createTreeNode(
        truncate(`${prefix}${formatTag(value, context, false)}`),
        value.children.map((child) => buildRenderNode(child, context, depth + 1)),
      );
    }
    case "JsxFragment":
      return createTreeNode(
        `${prefix}<>`,
        value.children.map((child) => buildRenderNode(child, context, depth + 1)),
      );
    case "ArrayMap":
      return createTreeNode(truncate(`${prefix}↻ each of ${formatSymbolicValue(value.array)}`), [
        buildRenderNode(value.item, context, depth + 1),
      ]);
    case "Conditional": {
      const arms = [buildRenderNode(value.consequent, context, depth + 1, colors.dim("✓ "))];
      if (!isRenderingNothingWhenFalse(value))
        arms.push(buildRenderNode(value.alternate, context, depth + 1, colors.dim("✗ ")));
      return createTreeNode(truncate(`${prefix}◆ ${getConditionLabel(value)}`), arms);
    }
    default:
      return createTreeNode(prefix);
  }
};

const formatUpdate = (update: StateUpdate): string => {
  const { binding, value } = update;
  const assignments =
    value.kind === "ObjectExpression"
      ? value.properties.map(
          (property) =>
            `${formatPlace(binding, [property.key])} = ${formatSymbolicValue(property.value)}`,
        )
      : [`${binding.name} = ${formatSymbolicValue(value)}`];
  const guard =
    update.guards.length > 0 ? `if ${update.guards.map(formatSymbolicValue).join(" && ")}: ` : "";
  return `${guard}${assignments.join(", ")}${update.isAsync ? " (async)" : ""}`;
};

const formatTransitionEffect = (handler: Handler): string =>
  truncate(
    [
      ...handler.updates.map(formatUpdate),
      ...handler.delegates.map((delegate) => `calls ${delegate}`),
    ].join("; "),
    MAX_EFFECT_WIDTH,
  );

const getTextContent = (value: SymbolicValue): string => {
  switch (value.kind) {
    case "JSXText":
      return value.value.trim() && JSON.stringify(value.value.trim());
    case "JsxExpression":
    case "JsxFragment":
      return value.children.map(getTextContent).filter(Boolean).join(" ");
    case "Conditional":
    case "ArrayMap":
      return "";
    default:
      if (value.kind === "Primitive" && typeof value.value === "string")
        return JSON.stringify(value.value);
      return isRenderingNothing(value) ? "" : `{${formatSymbolicValue(value)}}`;
  }
};

const collectTriggers = (render: SymbolicValue, triggers: Map<string, string>): void =>
  forEachJsxElement(render, (element) => {
    for (const prop of element.props) {
      if (!prop.handlerId || triggers.has(prop.handlerId)) continue;
      const text = getTextContent(element);
      triggers.set(
        prop.handlerId,
        text
          ? truncate(text, MAX_TRIGGER_TEXT_WIDTH)
          : `<${element.tag.name}> ${prop.kind === "JsxAttribute" ? prop.name : "{...}"}`,
      );
    }
  });

const getEffectLabel = (handler: Handler): string => {
  const { trigger } = handler;
  if (trigger.kind === "Event") return `<${trigger.tag}> ${trigger.event}`;
  return trigger.dependencies === "[]"
    ? "on mount"
    : `${trigger.hookKind}(${trigger.dependencies ?? "every render"})`;
};

const buildBindings = (component: AnalyzedComponent, options: PrintOptions): TreeNode => {
  const { analysis, report } = component;
  const { colors } = options;
  const updates = analysis.handlers.flatMap((handler) => handler.updates);
  const children = analysis.bindings
    .filter((binding) => binding.kind !== "item")
    .map((binding) => {
      const source =
        binding.hookKind && binding.kind !== "state" && binding.kind !== "reducer"
          ? `${binding.kind}:${binding.hookKind}`
          : binding.kind;
      const details: string[] = [];
      if (binding.initial) details.push(`= ${formatSymbolicValue(binding.initial)}`);
      const reachable = report.places.get(getPlaceKey(binding, []));
      if (
        reachable &&
        binding.domain.kind === "Cases" &&
        reachable.length < binding.domain.cases.length
      ) {
        details.push(colors.dim(`reachable ${formatCases(reachable)}`));
      }
      const invariant = getNumericInvariant(
        binding,
        updates.filter((update) => update.binding.id === binding.id),
      );
      if (invariant) details.push(colors.dim(invariant));
      const prefix = `${getPlaceKey(binding, [])}.`;
      const fields = [...report.places.entries()]
        .filter(([placeKey]) => placeKey.startsWith(prefix))
        .map(([placeKey, values]) => {
          const domain = analysis.placeDomains.get(placeKey);
          const isNarrowed = domain?.kind === "Cases" && values.length < domain.cases.length;
          const narrowed = isNarrowed ? ` ${colors.dim(`reachable ${formatCases(values)}`)}` : "";
          return createTreeNode(
            truncate(
              `.${placeKey.slice(prefix.length)} ${domain ? formatDomain(domain) : ""}${narrowed}`,
            ),
          );
        });
      const domainText =
        binding.domain.kind === "Unknown"
          ? colors.red(formatDomain(binding.domain))
          : formatDomain(binding.domain);
      return createTreeNode(
        truncate(
          `${colors.bold(binding.name)} ${colors.dim(source)} ${domainText}${details.length > 0 ? ` ${details.join("  ")}` : ""}`,
        ),
        fields,
      );
    });
  return createTreeNode(
    colors.dim("data"),
    children.length > 0 ? children : [createTreeNode(colors.dim("none"))],
  );
};

const buildState = (
  state: State,
  index: number,
  hasRegions: boolean,
  context: ComponentPrintContext,
): TreeNode => {
  const { colors } = context;
  const label =
    state.conditions.length > 0 ? state.conditions.join(colors.dim(" ∧ ")) : colors.dim("always");
  const rendered = hasRegions
    ? state.fragments
        .map((fragment) => formatCompact(fragment, context))
        .filter(Boolean)
        .join(" ")
    : formatCompact(state.render, context);
  const details = [createTreeNode(truncate(rendered || colors.dim("∅")))];
  for (const transition of state.transitions) {
    const targets = transition.targets
      .filter((target) => target !== index)
      .map((target) => `S${target + 1}`);
    if (targets.length === 0) continue;
    const trigger = context.triggers.get(transition.handlerId) ?? transition.handlerId;
    details.push(
      createTreeNode(
        `${trigger} ${colors.dim("→")} ${targets.join(" | ")}${transition.isAsync ? colors.dim(" (async)") : ""}`,
      ),
    );
  }
  return createTreeNode(truncate(`${colors.bold(`S${index + 1}`)} ${label}`), details);
};

const buildStates = (component: AnalyzedComponent, context: ComponentPrintContext): TreeNode => {
  const { colors } = context;
  const { report } = component;
  const hasRegions = report.regions.length > 1;
  const children = hasRegions
    ? report.regions.map((region) =>
        createTreeNode(
          truncate(region.places.join(colors.dim(", ")) || colors.dim("other")),
          region.states.map((index) => {
            const state = report.states[index];
            return state ? buildState(state, index, true, context) : createTreeNode("");
          }),
        ),
      )
    : report.states.map((state, index) => buildState(state, index, false, context));
  if (report.unreachableBranches.length > 0) {
    children.push(
      createTreeNode(
        colors.red("unreachable branches"),
        report.unreachableBranches.map((unreachableBranch) => {
          return createTreeNode(
            `${colors.red(unreachableBranch.description)} ${colors.dim(formatLine(unreachableBranch.branch.loc))}`,
          );
        }),
      ),
    );
  }
  const truncated = report.isTruncated ? "+, truncated" : "";
  const combinations = report.regions.reduce(
    (product, region) => product * region.states.length,
    1,
  );
  return createTreeNode(
    colors.dim(
      hasRegions
        ? `states (${report.states.length}${truncated} in ${report.regions.length} regions, ${combinations} combinations)`
        : `states (${report.states.length}${truncated})`,
    ),
    children,
  );
};

const buildNotes = (
  title: string,
  notes: Array<{ kind: string; loc: SourceLocation; message: string }>,
  { colors }: PrintOptions,
): TreeNode =>
  createTreeNode(
    colors.dim(title),
    notes.map((note) =>
      createTreeNode(
        truncate(`${colors.red(note.kind)} ${formatLine(note.loc)} ${colors.dim(note.message)}`),
      ),
    ),
  );

export const formatComponent = (component: AnalyzedComponent, options: PrintOptions): string => {
  const { analysis } = component;
  const triggers = new Map<string, string>();
  collectTriggers(analysis.render, triggers);
  for (const handler of analysis.handlers) {
    if (handler.trigger.kind === "Effect") triggers.set(handler.id, getEffectLabel(handler));
  }
  const context: ComponentPrintContext = {
    ...options,
    renderNodeBudget: { remaining: MAX_RENDER_NODES },
    triggers,
    effects: new Map(
      analysis.handlers.map((handler) => [handler.id, formatTransitionEffect(handler)]),
    ),
  };
  const { colors, views } = context;
  const sections: TreeNode[] = [];
  if (views.has("data")) sections.push(buildBindings(component, context));
  if (views.has("render")) {
    const effects = analysis.handlers
      .filter((handler) => handler.trigger.kind === "Effect")
      .map((handler) =>
        createTreeNode(
          colors.dim(`${triggers.get(handler.id)} ⇒ ${context.effects.get(handler.id)}`),
        ),
      );
    sections.push(
      createTreeNode(colors.dim("render"), [
        buildRenderNode(analysis.render, context, 0),
        ...effects,
      ]),
    );
  }
  if (views.has("states")) sections.push(buildStates(component, context));
  if (views.has("warnings") && analysis.warnings.length > 0)
    sections.push(buildNotes("warnings", analysis.warnings, context));
  if (views.has("bailouts") && analysis.bailouts.length > 0)
    sections.push(
      buildNotes(
        "bailouts",
        analysis.bailouts.map((bailout) => ({ ...bailout, kind: bailout.reason })),
        context,
      ),
    );
  const line = analysis.loc === GeneratedSource ? "" : `:${analysis.loc.line}`;
  const location = `${relative(context.rootDirectory, analysis.file)}${line}`;
  return renderAsciiTree(
    createTreeNode(`${colors.bold(analysis.name)} ${colors.dim(location)}`, sections),
  ).join("\n");
};

export const formatHierarchy = (components: AnalyzedComponent[], options: PrintOptions): string => {
  const { colors } = options;
  const componentsByName = new Map(
    components.map((component) => [component.analysis.name, component]),
  );
  const rendered = new Set(components.flatMap((component) => component.analysis.renders));
  const roots = components.filter((component) => !rendered.has(component.analysis.name));
  const build = (component: AnalyzedComponent, ancestors: Set<string>): TreeNode => {
    const { analysis, report } = component;
    const stateCount = report.states.length;
    const transitionCount = analysis.handlers.length;
    const stats = colors.dim(
      `${stateCount} state${stateCount === 1 ? "" : "s"}${transitionCount > 0 ? `, ${transitionCount} handler${transitionCount === 1 ? "" : "s"}` : ""}`,
    );
    const label = `${analysis.name} ${stats}`;
    if (ancestors.has(analysis.name)) return createTreeNode(`${label} ${colors.dim("(cycle)")}`);
    const nextAncestors = new Set([...ancestors, analysis.name]);
    const children = analysis.renders.flatMap((childName) => {
      const child = componentsByName.get(childName);
      return child ? [build(child, nextAncestors)] : [];
    });
    return createTreeNode(label, children);
  };
  return renderAsciiTree(
    createTreeNode(
      colors.bold("components"),
      roots.map((root) => build(root, new Set())),
    ),
  ).join("\n");
};

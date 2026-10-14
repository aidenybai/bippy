import { relative } from "node:path";
import type picocolors from "picocolors";
import { GeneratedSource } from "../react-compiler/HIR/HIR";
import type { SourceLocation } from "../react-compiler/HIR/HIR";
import type {
  AbstractValue,
  AnalyzedComponent,
  Binding,
  ConditionalValue,
  Domain,
  JsxExpressionValue,
  JsxProp,
  JsxSpreadProp,
  StateUpdate,
  State,
  SymbolicValue,
  Handler,
} from "../core/types";
import { forEachJsxElement } from "../core/utils/traverse";
import {
  CONDITION_SEPARATOR,
  UNCONDITIONAL_LABEL,
  formatAbstractValue,
  formatLine,
  formatPlace,
  formatStateLabel,
  formatSymbolicValue,
} from "../core/format";
import { getTestExpression } from "../core/utils/truthiness";
import { getBindingPlace } from "../core/utils/place";
import {
  isRenderingNothing,
  isRenderingNothingWhenFalse,
  isStateBinding,
} from "../core/utils/checks";
import { getBindingUpdates, isEffectHandler } from "../core/collect-handlers";
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

interface RenderNodeBudget {
  remaining: number;
}

interface Note {
  kind: string;
  loc: SourceLocation;
  message: string;
}

interface ComponentPrintContext extends PrintOptions {
  effectSummariesByHandler: Map<string, string>;
  triggerLabelsByHandler: Map<string, string>;
  renderNodeBudget: RenderNodeBudget;
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

const getPropLabel = (prop: JsxProp | JsxSpreadProp): string =>
  prop.kind === "JsxAttribute" ? prop.name : "{...}";

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
    const name = getPropLabel(prop);
    if (prop.handlerId)
      return [
        colors.dim(`${name} ⇒ ${context.effectSummariesByHandler.get(prop.handlerId) ?? "?"}`),
      ];
    if (!context.isShowingAttributes) return [];
    const valueText = truncate(formatSymbolicValue(prop.value), MAX_ATTRIBUTE_WIDTH);
    return [colors.dim(prop.kind === "JsxAttribute" ? `${name}=${valueText}` : `...${valueText}`)];
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

const formatCompact = (value: SymbolicValue, context: ComponentPrintContext): string => {
  const parts: string[] = [];
  let printedLength = 0;
  const appendPart = (part: string): void => {
    if (!part) return;
    parts.push(part);
    printedLength += part.length + 1;
  };
  let isCut = false;
  const visit = (node: SymbolicValue): void => {
    if (printedLength > MAX_LABEL_WIDTH) {
      isCut = true;
      return;
    }
    if (isRenderingNothing(node)) return;
    const leaf = formatLeaf(node, context);
    if (leaf !== null) {
      appendPart(leaf);
      return;
    }
    switch (node.kind) {
      case "JsxExpression":
        appendPart(formatTag(node, context, true));
        node.children.forEach(visit);
        break;
      case "JsxFragment":
        node.children.forEach(visit);
        break;
      case "ArrayMap":
        appendPart(`↻ ${formatSymbolicValue(node.array)}`);
        break;
      case "Conditional":
        appendPart(`◆ ${getConditionLabel(node)}`);
        break;
      default:
        break;
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
  const guardPrefix =
    update.guards.length > 0 ? `if ${update.guards.map(formatSymbolicValue).join(" && ")}: ` : "";
  const asyncSuffix = update.isAsync ? " (async)" : "";
  return `${guardPrefix}${assignments.join(", ")}${asyncSuffix}`;
};

const formatHandlerEffects = (handler: Handler): string =>
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

const collectTriggerLabels = (render: SymbolicValue): Map<string, string> => {
  const triggerLabelsByHandler = new Map<string, string>();
  forEachJsxElement(render, (element) => {
    for (const prop of element.props) {
      if (!prop.handlerId || triggerLabelsByHandler.has(prop.handlerId)) continue;
      const textContent = getTextContent(element);
      const propName = getPropLabel(prop);
      triggerLabelsByHandler.set(
        prop.handlerId,
        textContent
          ? truncate(textContent, MAX_TRIGGER_TEXT_WIDTH)
          : `<${element.tag.name}> ${propName}`,
      );
    }
  });
  return triggerLabelsByHandler;
};

const getEffectTriggerLabel = (handler: Handler): string => {
  const { trigger } = handler;
  if (trigger.kind === "Event") return `<${trigger.tag}> ${trigger.event}`;
  return trigger.dependencies === "[]"
    ? "on mount"
    : `${trigger.hookKind}(${trigger.dependencies ?? "every render"})`;
};

const getReachableLabel = (
  domain: Domain | undefined,
  reachableValues: AbstractValue[],
): string | null =>
  domain?.kind === "Cases" && reachableValues.length < domain.cases.length
    ? `reachable ${formatCases(reachableValues)}`
    : null;

const buildFieldNodes = (
  component: AnalyzedComponent,
  binding: Binding,
  options: PrintOptions,
): TreeNode[] =>
  [...component.report.places]
    .filter(([place]) => place.bindingId === binding.id && place.path.length > 0)
    .map(([place, reachableValues]) => {
      const fieldDomain = component.analysis.placeDomains.get(place);
      const reachableLabel = getReachableLabel(fieldDomain, reachableValues);
      const reachableSuffix = reachableLabel ? ` ${options.colors.dim(reachableLabel)}` : "";
      const domainText = fieldDomain ? formatDomain(fieldDomain) : "";
      return createTreeNode(truncate(`.${place.path.join(".")} ${domainText}${reachableSuffix}`));
    });

const buildBindingNode = (
  component: AnalyzedComponent,
  binding: Binding,
  options: PrintOptions,
): TreeNode => {
  const { colors } = options;
  const bindingSource =
    binding.hookKind && !isStateBinding(binding)
      ? `${binding.kind}:${binding.hookKind}`
      : binding.kind;
  const details: string[] = [];
  if (binding.initial) details.push(`= ${formatSymbolicValue(binding.initial)}`);
  const reachableValues = component.report.places.get(getBindingPlace(binding));
  const reachableLabel = reachableValues && getReachableLabel(binding.domain, reachableValues);
  if (reachableLabel) details.push(colors.dim(reachableLabel));
  const bindingUpdates = getBindingUpdates(component.analysis.handlers, binding);
  const invariant = getNumericInvariant(binding, bindingUpdates);
  if (invariant) details.push(colors.dim(invariant));
  const domainText =
    binding.domain.kind === "Unknown"
      ? colors.red(formatDomain(binding.domain))
      : formatDomain(binding.domain);
  const detailsSuffix = details.length > 0 ? ` ${details.join("  ")}` : "";
  return createTreeNode(
    truncate(
      `${colors.bold(binding.name)} ${colors.dim(bindingSource)} ${domainText}${detailsSuffix}`,
    ),
    buildFieldNodes(component, binding, options),
  );
};

const buildBindings = (component: AnalyzedComponent, options: PrintOptions): TreeNode => {
  const bindingNodes = component.analysis.bindings
    .filter((binding) => binding.kind !== "item")
    .map((binding) => buildBindingNode(component, binding, options));
  return createTreeNode(
    options.colors.dim("data"),
    bindingNodes.length > 0 ? bindingNodes : [createTreeNode(options.colors.dim("none"))],
  );
};

const buildState = (
  state: State,
  stateIndex: number,
  hasRegions: boolean,
  context: ComponentPrintContext,
): TreeNode => {
  const { colors } = context;
  const conditionLabel =
    state.conditions.length > 0
      ? state.conditions.join(colors.dim(CONDITION_SEPARATOR))
      : colors.dim(UNCONDITIONAL_LABEL);
  const rendered = hasRegions
    ? state.fragments
        .map((fragment) => formatCompact(fragment, context))
        .filter(Boolean)
        .join(" ")
    : formatCompact(state.render, context);
  const details = [createTreeNode(truncate(rendered || colors.dim("∅")))];
  for (const transition of state.transitions) {
    const targetLabels = transition.targets
      .filter((targetIndex) => targetIndex !== stateIndex)
      .map(formatStateLabel);
    if (targetLabels.length === 0) continue;
    const triggerLabel =
      context.triggerLabelsByHandler.get(transition.handlerId) ?? transition.handlerId;
    const asyncSuffix = transition.isAsync ? colors.dim(" (async)") : "";
    details.push(
      createTreeNode(
        `${triggerLabel} ${colors.dim("→")} ${targetLabels.join(" | ")}${asyncSuffix}`,
      ),
    );
  }
  return createTreeNode(
    truncate(`${colors.bold(formatStateLabel(stateIndex))} ${conditionLabel}`),
    details,
  );
};

const buildStates = (component: AnalyzedComponent, context: ComponentPrintContext): TreeNode => {
  const { colors } = context;
  const { report } = component;
  const hasRegions = report.regions.length > 1;
  const stateNodes = hasRegions
    ? report.regions.map((region) =>
        createTreeNode(
          truncate(region.placeNames.join(colors.dim(", ")) || colors.dim("other")),
          region.states.map((stateIndex) => {
            const state = report.states[stateIndex];
            return state ? buildState(state, stateIndex, true, context) : createTreeNode("");
          }),
        ),
      )
    : report.states.map((state, stateIndex) => buildState(state, stateIndex, false, context));
  if (report.unreachableBranches.length > 0) {
    stateNodes.push(
      createTreeNode(
        colors.red("unreachable branches"),
        report.unreachableBranches.map((unreachableBranch) =>
          createTreeNode(
            `${colors.red(unreachableBranch.description)} ${colors.dim(formatLine(unreachableBranch.branch.loc))}`,
          ),
        ),
      ),
    );
  }
  const truncatedSuffix = report.isTruncated ? "+, truncated" : "";
  const combinationCount = report.regions.reduce(
    (product, region) => product * region.states.length,
    1,
  );
  const stateCountLabel = `${report.states.length}${truncatedSuffix}`;
  return createTreeNode(
    colors.dim(
      hasRegions
        ? `states (${stateCountLabel} in ${report.regions.length} regions, ${combinationCount} combinations)`
        : `states (${stateCountLabel})`,
    ),
    stateNodes,
  );
};

const buildNotes = (title: string, notes: Note[], { colors }: PrintOptions): TreeNode =>
  createTreeNode(
    colors.dim(title),
    notes.map((note) =>
      createTreeNode(
        truncate(`${colors.red(note.kind)} ${formatLine(note.loc)} ${colors.dim(note.message)}`),
      ),
    ),
  );

const createPrintContext = (
  component: AnalyzedComponent,
  options: PrintOptions,
): ComponentPrintContext => {
  const { analysis } = component;
  const triggerLabelsByHandler = collectTriggerLabels(analysis.render);
  for (const handler of analysis.handlers.filter(isEffectHandler))
    triggerLabelsByHandler.set(handler.id, getEffectTriggerLabel(handler));
  return {
    ...options,
    renderNodeBudget: { remaining: MAX_RENDER_NODES },
    triggerLabelsByHandler,
    effectSummariesByHandler: new Map(
      analysis.handlers.map((handler) => [handler.id, formatHandlerEffects(handler)]),
    ),
  };
};

const buildRenderSection = (
  component: AnalyzedComponent,
  context: ComponentPrintContext,
): TreeNode => {
  const effectNodes = component.analysis.handlers.filter(isEffectHandler).map((handler) => {
    const triggerLabel = context.triggerLabelsByHandler.get(handler.id);
    const effectSummary = context.effectSummariesByHandler.get(handler.id);
    return createTreeNode(context.colors.dim(`${triggerLabel} ⇒ ${effectSummary}`));
  });
  return createTreeNode(context.colors.dim("render"), [
    buildRenderNode(component.analysis.render, context, 0),
    ...effectNodes,
  ]);
};

const buildSections = (
  component: AnalyzedComponent,
  context: ComponentPrintContext,
): TreeNode[] => {
  const { analysis } = component;
  const sections: TreeNode[] = [];
  if (context.views.has("data")) sections.push(buildBindings(component, context));
  if (context.views.has("render")) sections.push(buildRenderSection(component, context));
  if (context.views.has("states")) sections.push(buildStates(component, context));
  if (context.views.has("warnings") && analysis.warnings.length > 0)
    sections.push(buildNotes("warnings", analysis.warnings, context));
  if (context.views.has("bailouts") && analysis.bailouts.length > 0) {
    const bailoutNotes = analysis.bailouts.map((bailout) => ({ ...bailout, kind: bailout.reason }));
    sections.push(buildNotes("bailouts", bailoutNotes, context));
  }
  return sections;
};

export const formatComponent = (component: AnalyzedComponent, options: PrintOptions): string => {
  const { analysis } = component;
  const context = createPrintContext(component, options);
  const lineSuffix = analysis.loc === GeneratedSource ? "" : `:${analysis.loc.start.line}`;
  const location = `${relative(context.rootDirectory, analysis.file)}${lineSuffix}`;
  return renderAsciiTree(
    createTreeNode(
      `${context.colors.bold(analysis.name)} ${context.colors.dim(location)}`,
      buildSections(component, context),
    ),
  ).join("\n");
};

export const formatHierarchy = (components: AnalyzedComponent[], options: PrintOptions): string => {
  const { colors } = options;
  const componentsByName = new Map(
    components.map((component) => [component.analysis.name, component]),
  );
  const renderedNames = new Set(components.flatMap((component) => component.analysis.renders));
  const rootComponents = components.filter(
    (component) => !renderedNames.has(component.analysis.name),
  );
  const buildComponentNode = (component: AnalyzedComponent, ancestors: Set<string>): TreeNode => {
    const { analysis, report } = component;
    const stateCount = report.states.length;
    const handlerCount = analysis.handlers.length;
    const stateLabel = `${stateCount} state${stateCount === 1 ? "" : "s"}`;
    const handlerLabel =
      handlerCount > 0 ? `, ${handlerCount} handler${handlerCount === 1 ? "" : "s"}` : "";
    const label = `${analysis.name} ${colors.dim(`${stateLabel}${handlerLabel}`)}`;
    if (ancestors.has(analysis.name)) return createTreeNode(`${label} ${colors.dim("(cycle)")}`);
    const childAncestors = new Set([...ancestors, analysis.name]);
    const childNodes = analysis.renders.flatMap((childName) => {
      const childComponent = componentsByName.get(childName);
      return childComponent ? [buildComponentNode(childComponent, childAncestors)] : [];
    });
    return createTreeNode(label, childNodes);
  };
  return renderAsciiTree(
    createTreeNode(
      colors.bold("components"),
      rootComponents.map((rootComponent) => buildComponentNode(rootComponent, new Set())),
    ),
  ).join("\n");
};

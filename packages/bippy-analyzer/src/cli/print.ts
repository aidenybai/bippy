import { relative } from "node:path";
import { GeneratedSource } from "../core/hir/hir.js";
import type { SourceLocation } from "../core/hir/hir.js";
import type {
  AbstractValue,
  AnalyzedComponent,
  Binding,
  ConditionalValue,
  Domain,
  JsxExpressionValue,
  StateUpdate,
  SymbolicValue,
  Transition,
} from "../core/inference/types.js";
import {
  forEachJsxElement,
  formatAbstractValue,
  formatPlace,
  formatSymbolicValue,
  getPlaceKey,
  isRenderingNothing,
  isRenderingNothingWhenFalse,
} from "../core/inference/values.js";
import { createTreeNode, renderAsciiTree } from "./ascii-tree.js";
import { MAX_LABEL_WIDTH, MAX_RENDER_NODES } from "./constants.js";
import type { ComponentPrintContext, PrintOptions, TreeNode } from "./types.js";

const MAX_EFFECT_WIDTH = 70;
const MAX_ATTRIBUTE_WIDTH = 30;
const MAX_TRIGGER_TEXT_WIDTH = 24;
const INTEGER_PATTERN = /^-?\d+$/;

const truncate = (text: string, width = MAX_LABEL_WIDTH): string =>
  text.length > width ? `${text.slice(0, width - 1)}…` : text;

const formatLine = (loc: SourceLocation): string => (loc === GeneratedSource ? "" : `L${loc.line}`);

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
    !INTEGER_PATTERN.test(String(initial.value)) ||
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
    if (prop.kind === "JsxSpreadAttribute")
      return context.isShowingAttributes
        ? [colors.dim(`...${truncate(formatSymbolicValue(prop.value), MAX_ATTRIBUTE_WIDTH)}`)]
        : [];
    if (prop.transitionId)
      return [colors.dim(`${prop.name} ⇒ ${context.effects.get(prop.transitionId) ?? "?"}`)];
    return context.isShowingAttributes
      ? [
          colors.dim(
            `${prop.name}=${truncate(formatSymbolicValue(prop.value), MAX_ATTRIBUTE_WIDTH)}`,
          ),
        ]
      : [];
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
  value.testKind === "nullish"
    ? `${formatSymbolicValue(value.test)} != null`
    : formatSymbolicValue(value.test);

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

const formatTransitionEffect = (transition: Transition): string =>
  truncate(
    [
      ...transition.updates.map(formatUpdate),
      ...transition.delegates.map((delegate) => `calls ${delegate}`),
    ].join("; "),
    MAX_EFFECT_WIDTH,
  );

const getTextContent = (value: SymbolicValue): string => {
  switch (value.kind) {
    case "JSXText":
      return value.value.trim();
    case "JsxExpression":
    case "JsxFragment":
      return value.children.map(getTextContent).filter(Boolean).join(" ");
    case "Conditional":
    case "ArrayMap":
      return "";
    default:
      return isRenderingNothing(value) ? "" : formatSymbolicValue(value);
  }
};

const collectTriggers = (render: SymbolicValue, triggers: Map<string, string>): void =>
  forEachJsxElement(render, (element) => {
    for (const prop of element.props) {
      if (prop.kind !== "JsxAttribute" || !prop.transitionId || triggers.has(prop.transitionId))
        continue;
      const text = getTextContent(element);
      triggers.set(
        prop.transitionId,
        text
          ? JSON.stringify(truncate(text, MAX_TRIGGER_TEXT_WIDTH))
          : `<${element.tag.name}> ${prop.name}`,
      );
    }
  });

const getEffectLabel = (transition: Transition): string => {
  const { trigger } = transition;
  if (trigger.kind === "Event") return `<${trigger.tag}> ${trigger.event}`;
  return trigger.dependencies === "[]"
    ? "on mount"
    : `${trigger.hookKind}(${trigger.dependencies ?? "every render"})`;
};

const buildBindings = (component: AnalyzedComponent, options: PrintOptions): TreeNode => {
  const { analysis, report } = component;
  const { colors } = options;
  const updates = analysis.transitions.flatMap((transition) => transition.updates);
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

const buildStates = (component: AnalyzedComponent, context: ComponentPrintContext): TreeNode => {
  const { colors } = context;
  const { report } = component;
  const children = report.states.map((state, index) => {
    const label =
      state.assumptions.length > 0
        ? state.assumptions.join(colors.dim(" ∧ "))
        : colors.dim("always");
    const details = [
      createTreeNode(truncate(formatCompact(state.render, context) || colors.dim("∅"))),
    ];
    for (const edge of state.edges) {
      const targets = edge.targets
        .filter((target) => target !== index)
        .map((target) => `S${target + 1}`);
      if (targets.length === 0) continue;
      const trigger = context.triggers.get(edge.transitionId) ?? edge.transitionId;
      details.push(
        createTreeNode(
          `${trigger} ${colors.dim("→")} ${targets.join(" | ")}${edge.isAsync ? colors.dim(" (async)") : ""}`,
        ),
      );
    }
    return createTreeNode(truncate(`${colors.bold(`S${index + 1}`)} ${label}`), details);
  });
  if (report.deadBranches.length > 0) {
    children.push(
      createTreeNode(
        colors.red("dead branches"),
        report.deadBranches.map((deadBranch) => {
          return createTreeNode(
            `${colors.red(deadBranch.description)} ${colors.dim(formatLine(deadBranch.decision.loc))}`,
          );
        }),
      ),
    );
  }
  return createTreeNode(
    colors.dim(`states (${report.states.length}${report.isTruncated ? "+, truncated" : ""})`),
    children,
  );
};

const buildWarnings = (component: AnalyzedComponent, options: PrintOptions): TreeNode =>
  createTreeNode(
    options.colors.dim("warnings"),
    component.analysis.warnings.map((warning) =>
      createTreeNode(
        truncate(
          `${options.colors.red(warning.kind)} ${formatLine(warning.loc)} ${options.colors.dim(warning.message)}`,
        ),
      ),
    ),
  );

const buildBailouts = (component: AnalyzedComponent, options: PrintOptions): TreeNode =>
  createTreeNode(
    options.colors.dim("bailouts"),
    component.analysis.bailouts.map((bailout) =>
      createTreeNode(
        truncate(
          `${options.colors.red(bailout.reason)} ${formatLine(bailout.loc)} ${options.colors.dim(bailout.message)}`,
        ),
      ),
    ),
  );

export const formatComponent = (component: AnalyzedComponent, options: PrintOptions): string => {
  const { analysis } = component;
  const triggers = new Map<string, string>();
  collectTriggers(analysis.render, triggers);
  for (const transition of analysis.transitions) {
    if (transition.trigger.kind === "Effect")
      triggers.set(transition.id, getEffectLabel(transition));
  }
  const context: ComponentPrintContext = {
    ...options,
    renderNodeBudget: { remaining: MAX_RENDER_NODES },
    triggers,
    effects: new Map(
      analysis.transitions.map((transition) => [transition.id, formatTransitionEffect(transition)]),
    ),
  };
  const { colors, views } = context;
  const sections: TreeNode[] = [];
  if (views.has("data")) sections.push(buildBindings(component, context));
  if (views.has("render")) {
    const effects = analysis.transitions
      .filter((transition) => transition.trigger.kind === "Effect")
      .map((transition) =>
        createTreeNode(
          colors.dim(`${getEffectLabel(transition)} ⇒ ${formatTransitionEffect(transition)}`),
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
    sections.push(buildWarnings(component, context));
  if (views.has("bailouts") && analysis.bailouts.length > 0)
    sections.push(buildBailouts(component, context));
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
    const transitionCount = analysis.transitions.length;
    const stats = colors.dim(
      `${stateCount} state${stateCount === 1 ? "" : "s"}${transitionCount > 0 ? `, ${transitionCount} transition${transitionCount === 1 ? "" : "s"}` : ""}`,
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

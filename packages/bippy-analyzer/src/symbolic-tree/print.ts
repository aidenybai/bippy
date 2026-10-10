import { relative } from "node:path";
import type picocolors from "picocolors";
import { createTreeNode, renderAsciiTree } from "./ascii-tree.ts";
import type { TreeNode } from "./ascii-tree.ts";
import { formatDomain } from "./domain.ts";
import { formatExpression } from "./expression.ts";
import type { ComponentModel, Expression, RenderNode, Slot, Transition, Update } from "./model.ts";
import type { StateReport } from "./states.ts";

export type View = "data" | "render" | "states" | "bailouts";

type Colors = ReturnType<typeof picocolors.createColors>;

export interface PrintOptions {
  views: Set<View>;
  colors: Colors;
  rootDirectory: string;
  maxDepth: number;
  isShowingAttributes: boolean;
  effects: Map<string, string>;
  triggers: Map<string, string>;
}

export interface AnalyzedComponent {
  model: ComponentModel;
  report: StateReport;
}

const MAX_LABEL_WIDTH = 140;

const truncate = (text: string, width = MAX_LABEL_WIDTH): string =>
  text.length > width ? `${text.slice(0, width - 1)}…` : text;

const getNumericInvariant = (slot: Slot, updates: Update[]): string | undefined => {
  if (
    slot.initial?.kind !== "literal" ||
    !/^-?\d+$/.test(slot.initial.text) ||
    updates.length === 0
  )
    return undefined;
  const initialValue = Number(slot.initial.text);
  const isIncrement = (value: Expression): boolean =>
    value.kind === "binary" &&
    value.operator === "+" &&
    value.left.kind === "slot" &&
    value.left.slot === slot.name &&
    value.right.kind === "literal" &&
    /^\d+$/.test(value.right.text);
  const isLiteralAtLeast = (value: Expression): boolean =>
    value.kind === "literal" && /^-?\d+$/.test(value.text) && Number(value.text) >= initialValue;
  if (updates.every((update) => isIncrement(update.value) || isLiteralAtLeast(update.value)))
    return `integer ≥ ${initialValue}`;
  return undefined;
};

const formatAttributes = (
  node: RenderNode & { kind: "element" },
  options: PrintOptions,
  isCompact: boolean,
): string => {
  const { colors } = options;
  const attributes = node.attributes.flatMap((attribute) => {
    if (isCompact) return [];
    if (attribute.transitionId)
      return [
        colors.dim(`${attribute.name} ⇒ ${options.effects.get(attribute.transitionId) ?? "?"}`),
      ];
    if (!options.isShowingAttributes) return [];
    return [colors.dim(`${attribute.name}=${truncate(attribute.value, 30)}`)];
  });
  return attributes.length > 0 ? ` ${attributes.join(" ")}` : "";
};

const formatTag = (
  node: RenderNode & { kind: "element" },
  options: PrintOptions,
  isCompact: boolean,
): string => {
  const coloredTag = node.tag;
  return `<${coloredTag}${formatAttributes(node, options, isCompact)}>`;
};

const formatLeaf = (node: RenderNode, options: PrintOptions): string | undefined => {
  const { colors } = options;
  if (node.kind === "text") return JSON.stringify(node.text);
  if (node.kind === "value") return `{${formatExpression(node.expression)}}`;
  if (node.kind === "empty") return colors.dim("∅");
  if (node.kind === "unknown") return colors.red(`⚠ Unknown(${node.reason})`);
  return undefined;
};

const formatCompact = (node: RenderNode, options: PrintOptions): string => {
  if (node.kind === "empty") return "";
  const leaf = formatLeaf(node, options);
  if (leaf !== undefined) return leaf;
  if (node.kind === "element") {
    const children = node.children
      .map((child) => formatCompact(child, options))
      .filter(Boolean)
      .join(" ");
    return children
      ? `${formatTag(node, options, true)} ${children}`
      : formatTag(node, options, true);
  }
  if (node.kind === "list") return `↻ ${formatExpression(node.source)}`;
  if (node.kind === "branch") return `◆ ${formatExpression(node.condition)}`;
  return "";
};

const buildRenderNode = (
  node: RenderNode,
  options: PrintOptions,
  depth: number,
  prefix = "",
): TreeNode => {
  const { colors } = options;
  const leaf = formatLeaf(node, options);
  if (leaf !== undefined) return createTreeNode(`${prefix}${leaf}`);
  if (depth >= options.maxDepth) return createTreeNode(`${prefix}${colors.dim("…")}`);
  if (node.kind === "element") {
    const [onlyChild] = node.children;
    const onlyLeaf =
      node.children.length === 1 && onlyChild && onlyChild.kind !== "empty"
        ? formatLeaf(onlyChild, options)
        : undefined;
    if (onlyLeaf !== undefined)
      return createTreeNode(truncate(`${prefix}${formatTag(node, options, false)} ${onlyLeaf}`));
    return createTreeNode(
      truncate(`${prefix}${formatTag(node, options, false)}`),
      node.children.map((child) => buildRenderNode(child, options, depth + 1)),
    );
  }
  if (node.kind === "list") {
    return createTreeNode(truncate(`${prefix}${`↻ each of ${formatExpression(node.source)}`}`), [
      buildRenderNode(node.item, options, depth + 1),
    ]);
  }
  if (node.kind === "branch") {
    const branches = [buildRenderNode(node.whenTrue, options, depth + 1, colors.dim("✓ "))];
    if (node.whenFalse.kind !== "empty")
      branches.push(buildRenderNode(node.whenFalse, options, depth + 1, colors.dim("✗ ")));
    return createTreeNode(
      truncate(`${prefix}${`◆ ${formatExpression(node.condition)}`}`),
      branches,
    );
  }
  return createTreeNode(prefix);
};

const formatUpdate = (update: Update): string => {
  const { slot, value } = update;
  const assignments =
    value.kind === "object"
      ? value.fields
          .filter((field) => field.name !== "...")
          .map((field) => `${slot}.${field.name} = ${formatExpression(field.value)}`)
      : [`${slot} = ${formatExpression(value)}`];
  const guard =
    update.guards.length > 0 ? `if ${update.guards.map(formatExpression).join(" && ")}: ` : "";
  return `${guard}${assignments.join(", ")}${update.isAsync ? " (async)" : ""}`;
};

const formatTransitionEffect = (transition: Transition): string =>
  truncate(
    [
      ...transition.updates.map(formatUpdate),
      ...transition.delegates.map((delegate) => `calls ${delegate}`),
    ].join("; "),
    70,
  );

const getTextContent = (node: RenderNode): string => {
  if (node.kind === "text") return node.text;
  if (node.kind === "value") return formatExpression(node.expression);
  if (node.kind === "element") return node.children.map(getTextContent).filter(Boolean).join(" ");
  return "";
};

const collectTriggers = (node: RenderNode, triggers: Map<string, string>): void => {
  if (node.kind === "element") {
    for (const attribute of node.attributes) {
      if (!attribute.transitionId || triggers.has(attribute.transitionId)) continue;
      const text = getTextContent(node);
      triggers.set(
        attribute.transitionId,
        text ? JSON.stringify(truncate(text, 24)) : `<${node.tag}> ${attribute.name}`,
      );
    }
    for (const child of node.children) collectTriggers(child, triggers);
  }
  if (node.kind === "branch") {
    collectTriggers(node.whenTrue, triggers);
    collectTriggers(node.whenFalse, triggers);
  }
  if (node.kind === "list") collectTriggers(node.item, triggers);
};

const isRenderTrigger = (transition: Transition): boolean => transition.trigger.startsWith("<");

const getEffectLabel = (transition: Transition): string =>
  transition.trigger.endsWith("([])") ? "on mount" : transition.trigger;

const buildSlots = (component: AnalyzedComponent, options: PrintOptions): TreeNode => {
  const { model, report } = component;
  const { colors } = options;
  const updates = model.transitions.flatMap((transition) => transition.updates);
  const children = model.slots.map((slot) => {
    const source =
      slot.hookName && slot.source !== "state" && slot.source !== "reducer"
        ? `${slot.source}:${slot.hookName}`
        : slot.source;
    const details: string[] = [];
    if (slot.initial) details.push(`= ${formatExpression(slot.initial)}`);
    const reachable = report.initial.get(slot.name);
    if (reachable && slot.domain.kind === "cases" && reachable.length < slot.domain.cases.length)
      details.push(colors.dim(`reachable ${reachable.join(" | ")}`));
    const invariant = getNumericInvariant(
      slot,
      updates.filter((update) => update.slot === slot.name),
    );
    if (invariant) details.push(colors.dim(invariant));
    const fields = [...report.initial.entries()]
      .filter(([atomKey]) => atomKey.startsWith(`${slot.name}.`))
      .map(([atomKey, values]) => {
        const domain = model.atoms.get(atomKey);
        const isNarrowed = domain?.kind === "cases" && values.length < domain.cases.length;
        return createTreeNode(
          truncate(
            `.${atomKey.slice(slot.name.length + 1)} ${domain ? formatDomain(domain) : ""}${isNarrowed ? ` ${colors.dim(`reachable ${values.join(" | ")}`)}` : ""}`,
          ),
        );
      });
    const domainText =
      slot.domain.kind === "unknown"
        ? colors.red(formatDomain(slot.domain))
        : formatDomain(slot.domain);
    return createTreeNode(
      truncate(
        `${colors.bold(slot.name)} ${colors.dim(source)} ${domainText}${details.length > 0 ? ` ${details.join("  ")}` : ""}`,
      ),
      fields,
    );
  });
  return createTreeNode(
    colors.dim("data"),
    children.length > 0 ? children : [createTreeNode(colors.dim("none"))],
  );
};

const buildStates = (component: AnalyzedComponent, options: PrintOptions): TreeNode => {
  const { colors } = options;
  const { report } = component;
  const children = report.states.map((state, index) => {
    const label =
      state.assumptions.length > 0
        ? state.assumptions.join(colors.dim(" ∧ "))
        : colors.dim("always");
    const details = [
      createTreeNode(truncate(formatCompact(state.render, options) || colors.dim("∅"))),
    ];
    for (const edge of state.edges) {
      const targets = edge.targets
        .filter((target) => target !== index)
        .map((target) => `S${target + 1}`);
      if (targets.length === 0) continue;
      const trigger = options.triggers.get(edge.transitionId) ?? edge.transitionId;
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
        report.deadBranches.map((branch) =>
          createTreeNode(`${colors.red(branch.text)} ${colors.dim(`L${branch.span.line}`)}`),
        ),
      ),
    );
  }
  return createTreeNode(
    colors.dim(`states (${report.states.length}${report.isTruncated ? "+, truncated" : ""})`),
    children,
  );
};

const buildBailouts = (component: AnalyzedComponent, options: PrintOptions): TreeNode =>
  createTreeNode(
    options.colors.dim("bailouts"),
    component.model.bailouts.map((bailout) =>
      createTreeNode(
        truncate(
          `${options.colors.red(bailout.reason)} L${bailout.line} ${options.colors.dim(bailout.text)}`,
        ),
      ),
    ),
  );

export const formatComponent = (
  component: AnalyzedComponent,
  baseOptions: PrintOptions,
): string => {
  const { model } = component;
  const triggers = new Map<string, string>();
  collectTriggers(model.render, triggers);
  for (const transition of model.transitions)
    if (!isRenderTrigger(transition)) triggers.set(transition.id, getEffectLabel(transition));
  const options = {
    ...baseOptions,
    triggers,
    effects: new Map(
      model.transitions.map((transition) => [transition.id, formatTransitionEffect(transition)]),
    ),
  };
  const { colors, views } = options;
  const sections: TreeNode[] = [];
  if (views.has("data")) sections.push(buildSlots(component, options));
  if (views.has("render")) {
    const effects = model.transitions
      .filter((transition) => !isRenderTrigger(transition))
      .map((transition) =>
        createTreeNode(
          colors.dim(`${getEffectLabel(transition)} ⇒ ${formatTransitionEffect(transition)}`),
        ),
      );
    sections.push(
      createTreeNode(colors.dim("render"), [buildRenderNode(model.render, options, 0), ...effects]),
    );
  }
  if (views.has("states")) sections.push(buildStates(component, options));
  if (views.has("bailouts") && model.bailouts.length > 0)
    sections.push(buildBailouts(component, options));
  const header = `${colors.bold(model.name)} ${colors.dim(`${relative(options.rootDirectory, model.file)}:${model.line}`)}`;
  return renderAsciiTree(createTreeNode(header, sections)).join("\n");
};

export const formatHierarchy = (components: AnalyzedComponent[], options: PrintOptions): string => {
  const { colors } = options;
  const byName = new Map(components.map((component) => [component.model.name, component]));
  const rendered = new Set(components.flatMap((component) => component.model.renders));
  const roots = components.filter((component) => !rendered.has(component.model.name));
  const build = (component: AnalyzedComponent, ancestors: Set<string>): TreeNode => {
    const { model, report } = component;
    const stateCount = report.states.length;
    const stats = colors.dim(
      `${stateCount} state${stateCount === 1 ? "" : "s"}${model.transitions.length > 0 ? `, ${model.transitions.length} transition${model.transitions.length === 1 ? "" : "s"}` : ""}`,
    );
    const label = `${model.name} ${stats}`;
    if (ancestors.has(model.name)) return createTreeNode(`${label} ${colors.dim("(cycle)")}`);
    const nextAncestors = new Set([...ancestors, model.name]);
    const children = model.renders.flatMap((childName) => {
      const child = byName.get(childName);
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

import { getCaseTruthiness } from "./domain.ts";
import { formatExpression, getAtomKey } from "./expression.ts";
import type {
  ComponentModel,
  Domain,
  Edge,
  Expression,
  RenderNode,
  Slot,
  SourceSpan,
  State,
  Transition,
} from "./model.ts";

interface Knowledge {
  values: Map<string, Set<string>>;
  facts: Map<string, Fact>;
  bounds: Bound[];
}

interface Fact {
  expression: Expression;
  outcome: boolean;
}

interface Bound {
  left: string;
  right: string;
  constant: number;
  isStrict: boolean;
}

interface LinearTerm {
  atom: string;
  constant: number;
}

interface Distance {
  weight: number;
  isStrict: boolean;
}

interface Alternative {
  knowledge: Knowledge;
  render: RenderNode;
  assumptions: string[];
}

export interface DeadBranch {
  text: string;
  span: SourceSpan;
}

export interface StateReport {
  initial: Map<string, string[]>;
  states: State[];
  deadBranches: DeadBranch[];
  isTruncated: boolean;
}

type BranchOutcomes = Map<RenderNode, Set<boolean>>;

const MAX_ALTERNATIVES = 256;
const ZERO_ATOM = "0";
const ORDER_OPERATORS = new Set(["<", "<=", ">", ">=", "===", "=="]);
const EQUALITY_OPERATORS = new Set(["===", "!==", "==", "!="]);
const NEGATED_OPERATORS: Record<string, string> = {
  "===": "!==",
  "!==": "===",
  "==": "!=",
  "!=": "==",
  "<": ">=",
  ">": "<=",
  "<=": ">",
  ">=": "<",
};

export const formatNegated = (expression: Expression): string => {
  if (expression.kind === "unary" && expression.operator === "!")
    return formatExpression(expression.operand);
  if (expression.kind === "binary" && NEGATED_OPERATORS[expression.operator]) {
    return formatExpression({
      ...expression,
      operator: NEGATED_OPERATORS[expression.operator] ?? expression.operator,
    });
  }
  const text = formatExpression(expression);
  return expression.kind === "binary" || expression.kind === "conditional"
    ? `!(${text})`
    : `!${text}`;
};

const getLiteralCases = (
  expression: Expression,
  knowledge: Knowledge | undefined,
): string[] | undefined => {
  if (expression.kind === "literal") return [expression.text];
  if (expression.kind === "conditional") {
    const decided = knowledge ? evaluate(expression.condition, knowledge) : undefined;
    if (decided !== undefined)
      return getLiteralCases(decided ? expression.whenTrue : expression.whenFalse, knowledge);
    const whenTrue = getLiteralCases(expression.whenTrue, knowledge);
    const whenFalse = getLiteralCases(expression.whenFalse, knowledge);
    return whenTrue && whenFalse ? [...whenTrue, ...whenFalse] : undefined;
  }
  return undefined;
};

const getFieldCases = (
  expression: Expression | undefined,
  path: string[],
  slot: string,
  knowledge?: Knowledge,
): string[] | "unchanged" | undefined => {
  if (!expression) return undefined;
  if (path.length === 0) return getLiteralCases(expression, knowledge);
  if (expression.kind === "slot" && expression.slot === slot && expression.path.length === 0)
    return "unchanged";
  if (expression.kind !== "object") return undefined;
  const [field, ...restPath] = path;
  const assigned = [...expression.fields].reverse().find((candidate) => candidate.name === field);
  if (assigned) return getFieldCases(assigned.value, restPath, slot, knowledge);
  const spread = expression.fields.find((candidate) => candidate.name === "...");
  if (spread?.value.kind === "slot" && spread.value.slot === slot) return "unchanged";
  return undefined;
};

const getToggleCases = (
  expression: Expression,
  atomKey: string,
  cases: Set<string> | undefined,
): string[] | undefined => {
  if (!cases) return undefined;
  if (
    expression.kind === "unary" &&
    expression.operator === "!" &&
    expression.operand.kind === "slot" &&
    getAtomKey(expression.operand.slot, expression.operand.path) === atomKey
  ) {
    return [...cases].map((value) => (getCaseTruthiness(value) === "falsy" ? "true" : "false"));
  }
  return undefined;
};

const getAtomPath = (atomKey: string, slot: string): string[] | undefined => {
  if (atomKey === slot) return [];
  return atomKey.startsWith(`${slot}.`) ? atomKey.slice(slot.length + 1).split(".") : undefined;
};

const getReachableCases = (
  model: ComponentModel,
  slot: Slot,
  path: string[],
  domain: Domain,
): Set<string> | undefined => {
  const typeCases = domain.kind === "cases" ? domain.cases : undefined;
  const initialCases = getFieldCases(slot.initial, path, slot.name);
  if (!Array.isArray(initialCases)) return typeCases ? new Set(typeCases) : undefined;
  const reachable = new Set(initialCases);
  const atomKey = getAtomKey(slot.name, path);
  const updates = model.transitions
    .flatMap((transition) => transition.updates)
    .filter((update) => update.slot === slot.name);
  for (let round = 0; round < 3; round++) {
    for (const update of updates) {
      const fieldCases =
        getFieldCases(update.value, path, slot.name) ??
        getToggleCases(update.value, atomKey, reachable);
      if (fieldCases === "unchanged") continue;
      if (!fieldCases) return typeCases ? new Set(typeCases) : undefined;
      for (const value of fieldCases) reachable.add(value);
    }
  }
  return reachable;
};

const createInitialKnowledge = (model: ComponentModel): Knowledge => {
  const values = new Map<string, Set<string>>();
  for (const [atomKey, domain] of model.atoms) {
    const [slotName = "", ...path] = atomKey.split(".");
    const slot = model.slots.find((candidate) => candidate.name === slotName);
    const isStateLike = slot?.source === "state" || slot?.source === "reducer";
    const cases =
      isStateLike && slot
        ? getReachableCases(model, slot, path, domain)
        : domain.kind === "cases"
          ? new Set(domain.cases)
          : undefined;
    if (cases) values.set(atomKey, cases);
  }
  return { values, facts: new Map(), bounds: [] };
};

const getAtomValues = (expression: Expression, knowledge: Knowledge): Set<string> | undefined =>
  expression.kind === "slot"
    ? knowledge.values.get(getAtomKey(expression.slot, expression.path))
    : undefined;

const isLooseMatch = (value: string, literal: string, operator: string): boolean => {
  if (operator === "==" || operator === "!=") {
    const nullish = new Set(["null", "undefined"]);
    if (nullish.has(literal)) return nullish.has(value);
  }
  return value === literal;
};

const LITERAL_CASE_PATTERN = /^(".*"|-?\d+(\.\d+)?|true|false|null|undefined)$/;

const canCaseEqualLiteral = (value: string, literal: string): boolean => {
  if (LITERAL_CASE_PATTERN.test(value)) return false;
  if (value === "string") return literal.startsWith('"');
  if (value === "number") return /^-?\d/.test(literal);
  if (value === "boolean") return literal === "true" || literal === "false";
  return value === "any" || value === "unknown";
};

const splitEquality = (expression: Expression & { kind: "binary" }): [Expression, Expression] =>
  expression.left.kind === "literal"
    ? [expression.right, expression.left]
    : [expression.left, expression.right];

const evaluateEquality = (
  expression: Expression & { kind: "binary" },
  knowledge: Knowledge,
): boolean | undefined => {
  const isNegated = expression.operator === "!==" || expression.operator === "!=";
  const [atomSide, literalSide] = splitEquality(expression);
  if (atomSide.kind === "literal" && literalSide.kind === "literal")
    return (atomSide.text === literalSide.text) !== isNegated;
  if (literalSide.kind !== "literal") return undefined;
  const values = getAtomValues(atomSide, knowledge);
  if (!values) return undefined;
  const matches = [...values].filter((value) =>
    isLooseMatch(value, literalSide.text, expression.operator),
  );
  const hasUndecided = [...values].some((value) => canCaseEqualLiteral(value, literalSide.text));
  if (matches.length === values.size) return !isNegated;
  if (matches.length === 0 && !hasUndecided) return isNegated;
  return undefined;
};

const evaluate = (expression: Expression, knowledge: Knowledge): boolean | undefined => {
  const fact = knowledge.facts.get(formatExpression(expression));
  if (fact !== undefined) return fact.outcome;
  if (expression.kind === "literal") {
    const truthiness = getCaseTruthiness(expression.text);
    return truthiness === "either" ? undefined : truthiness === "truthy";
  }
  if (expression.kind === "slot") {
    const values = getAtomValues(expression, knowledge);
    if (!values || values.size === 0) return undefined;
    const truthiness = [...values].map(getCaseTruthiness);
    if (truthiness.every((value) => value === "truthy")) return true;
    if (truthiness.every((value) => value === "falsy")) return false;
    return undefined;
  }
  if (expression.kind === "unary" && expression.operator === "!") {
    const operand = evaluate(expression.operand, knowledge);
    return operand === undefined ? undefined : !operand;
  }
  if (expression.kind === "binary") {
    const bounded = evaluateBounds(expression, knowledge);
    if (bounded !== undefined) return bounded;
    if (expression.operator === "&&" || expression.operator === "||") {
      const isAnd = expression.operator === "&&";
      const left = evaluate(expression.left, knowledge);
      if (left === !isAnd) return left;
      const right = evaluate(expression.right, knowledge);
      if (left === isAnd) return right;
      if (right === !isAnd) return right;
      return undefined;
    }
    if (EQUALITY_OPERATORS.has(expression.operator)) return evaluateEquality(expression, knowledge);
  }
  return undefined;
};

const cloneKnowledge = (knowledge: Knowledge): Knowledge => ({
  values: new Map(knowledge.values),
  facts: new Map(knowledge.facts),
  bounds: [...knowledge.bounds],
});

const getLinearTerm = (expression: Expression): LinearTerm | undefined => {
  if (expression.kind === "literal")
    return /^-?\d+(\.\d+)?$/.test(expression.text)
      ? { atom: ZERO_ATOM, constant: Number(expression.text) }
      : undefined;
  if (expression.kind === "slot")
    return { atom: getAtomKey(expression.slot, expression.path), constant: 0 };
  if (
    expression.kind === "unary" &&
    expression.operator === "-" &&
    expression.operand.kind === "literal"
  )
    return getLinearTerm({ kind: "literal", text: `-${expression.operand.text}` });
  if (
    expression.kind === "binary" &&
    (expression.operator === "+" || expression.operator === "-")
  ) {
    const left = getLinearTerm(expression.left);
    const right = getLinearTerm(expression.right);
    if (!left || !right) return undefined;
    const sign = expression.operator === "+" ? 1 : -1;
    if (right.atom === ZERO_ATOM)
      return { atom: left.atom, constant: left.constant + sign * right.constant };
    if (left.atom === ZERO_ATOM && sign === 1)
      return { atom: right.atom, constant: left.constant + right.constant };
  }
  return undefined;
};

const getBounds = (expression: Expression, outcome: boolean): Bound[] | undefined => {
  if (expression.kind !== "binary") return undefined;
  const operator = outcome ? expression.operator : NEGATED_OPERATORS[expression.operator];
  if (!operator || !ORDER_OPERATORS.has(operator)) return undefined;
  const left = getLinearTerm(expression.left);
  const right = getLinearTerm(expression.right);
  if (!left || !right || (left.atom === ZERO_ATOM && right.atom === ZERO_ATOM)) return undefined;
  const difference = right.constant - left.constant;
  const lessThan = (isStrict: boolean): Bound => ({
    left: left.atom,
    right: right.atom,
    constant: difference,
    isStrict,
  });
  const greaterThan = (isStrict: boolean): Bound => ({
    left: right.atom,
    right: left.atom,
    constant: -difference,
    isStrict,
  });
  if (operator === "<") return [lessThan(true)];
  if (operator === "<=") return [lessThan(false)];
  if (operator === ">") return [greaterThan(true)];
  if (operator === ">=") return [greaterThan(false)];
  return [lessThan(false), greaterThan(false)];
};

const isShorter = (candidate: Distance, current: Distance): boolean =>
  candidate.weight < current.weight ||
  (candidate.weight === current.weight && candidate.isStrict && !current.isStrict);

const areBoundsConsistent = (bounds: Bound[]): boolean => {
  const lengthBounds = bounds
    .flatMap((bound) => [bound.left, bound.right])
    .filter((atom) => atom.endsWith(".length"))
    .map((atom): Bound => ({ left: ZERO_ATOM, right: atom, constant: 0, isStrict: false }));
  const allBounds = [...bounds, ...lengthBounds];
  const atoms = [
    ...new Set([ZERO_ATOM, ...allBounds.flatMap((bound) => [bound.left, bound.right])]),
  ];
  const indexOf = new Map(atoms.map((atom, index) => [atom, index]));
  const distances: Distance[][] = atoms.map((_, row) =>
    atoms.map((__, column) =>
      row === column ? { weight: 0, isStrict: false } : { weight: Infinity, isStrict: false },
    ),
  );
  for (const bound of allBounds) {
    const from = indexOf.get(bound.right) ?? 0;
    const to = indexOf.get(bound.left) ?? 0;
    const candidate = { weight: bound.constant, isStrict: bound.isStrict };
    const row = distances[from];
    const current = row?.[to];
    if (row && current && isShorter(candidate, current)) row[to] = candidate;
  }
  for (let middle = 0; middle < atoms.length; middle++) {
    for (let from = 0; from < atoms.length; from++) {
      for (let to = 0; to < atoms.length; to++) {
        const first = distances[from]?.[middle];
        const second = distances[middle]?.[to];
        const current = distances[from]?.[to];
        const row = distances[from];
        if (!first || !second || !current || !row) continue;
        const candidate = {
          weight: first.weight + second.weight,
          isStrict: first.isStrict || second.isStrict,
        };
        if (isShorter(candidate, current)) row[to] = candidate;
      }
    }
  }
  return distances.every((row, index) => {
    const self = row[index];
    return !self || !(self.weight < 0 || (self.weight === 0 && self.isStrict));
  });
};

const evaluateBounds = (expression: Expression, knowledge: Knowledge): boolean | undefined => {
  if (knowledge.bounds.length === 0) return undefined;
  const whenTrue = getBounds(expression, true);
  const whenFalse = getBounds(expression, false);
  if (whenTrue && !areBoundsConsistent([...knowledge.bounds, ...whenTrue])) return false;
  if (whenFalse && !areBoundsConsistent([...knowledge.bounds, ...whenFalse])) return true;
  return undefined;
};

const restrictAtom = (
  atom: Expression,
  knowledge: Knowledge,
  keep: (value: string) => boolean,
): Knowledge | undefined => {
  const values = getAtomValues(atom, knowledge);
  if (!values || atom.kind !== "slot") return undefined;
  const restricted = new Set([...values].filter(keep));
  if (restricted.size === 0) return undefined;
  const next = cloneKnowledge(knowledge);
  next.values.set(getAtomKey(atom.slot, atom.path), restricted);
  return next;
};

const assume = (
  expression: Expression,
  outcome: boolean,
  knowledge: Knowledge,
): Knowledge | undefined => {
  const evaluated = evaluate(expression, knowledge);
  if (evaluated !== undefined) return evaluated === outcome ? knowledge : undefined;
  if (expression.kind === "unary" && expression.operator === "!")
    return assume(expression.operand, !outcome, knowledge);
  if (
    expression.kind === "binary" &&
    ((expression.operator === "&&" && outcome) || (expression.operator === "||" && !outcome))
  ) {
    const afterLeft = assume(expression.left, outcome, knowledge);
    return afterLeft && assume(expression.right, outcome, afterLeft);
  }
  if (expression.kind === "slot" && getAtomValues(expression, knowledge)) {
    const restricted = restrictAtom(
      expression,
      knowledge,
      (value) => getCaseTruthiness(value) !== (outcome ? "falsy" : "truthy"),
    );
    if (restricted) return restricted;
  }
  if (expression.kind === "binary" && EQUALITY_OPERATORS.has(expression.operator)) {
    const isNegated = expression.operator === "!==" || expression.operator === "!=";
    const [atomSide, literalSide] = splitEquality(expression);
    if (literalSide.kind === "literal" && getAtomValues(atomSide, knowledge)) {
      const wantsMatch = outcome !== isNegated;
      const restricted = restrictAtom(atomSide, knowledge, (value) =>
        isLooseMatch(value, literalSide.text, expression.operator)
          ? wantsMatch
          : !wantsMatch || canCaseEqualLiteral(value, literalSide.text),
      );
      if (restricted) return restricted;
    }
  }
  const next = cloneKnowledge(knowledge);
  next.facts.set(formatExpression(expression), { expression, outcome });
  const bounds = getBounds(expression, outcome);
  if (bounds) {
    next.bounds.push(...bounds);
    if (!areBoundsConsistent(next.bounds)) return undefined;
  }
  return next;
};

const enumerate = (
  render: RenderNode,
  knowledge: Knowledge,
  outcomes: BranchOutcomes,
): Alternative[] => {
  if (render.kind === "branch") {
    const alternatives: Alternative[] = [];
    const isDecided = evaluate(render.condition, knowledge) !== undefined;
    for (const outcome of [true, false]) {
      const assumed = assume(render.condition, outcome, knowledge);
      if (!assumed) continue;
      const reached = outcomes.get(render) ?? new Set();
      reached.add(outcome);
      outcomes.set(render, reached);
      const label = outcome ? formatExpression(render.condition) : formatNegated(render.condition);
      for (const alternative of enumerate(
        outcome ? render.whenTrue : render.whenFalse,
        assumed,
        outcomes,
      )) {
        alternatives.push({
          ...alternative,
          assumptions: isDecided ? alternative.assumptions : [label, ...alternative.assumptions],
        });
      }
    }
    return alternatives;
  }
  if (render.kind === "element") {
    let partials: Alternative[] = [
      { knowledge, render: { ...render, children: [] }, assumptions: [] },
    ];
    for (const child of render.children) {
      const nextPartials: Alternative[] = [];
      for (const partial of partials) {
        for (const childAlternative of enumerate(child, partial.knowledge, outcomes)) {
          if (nextPartials.length >= MAX_ALTERNATIVES) break;
          const children = partial.render.kind === "element" ? partial.render.children : [];
          nextPartials.push({
            knowledge: childAlternative.knowledge,
            render: { ...render, children: [...children, childAlternative.render] },
            assumptions: [...partial.assumptions, ...childAlternative.assumptions],
          });
        }
      }
      partials = nextPartials;
    }
    return partials;
  }
  return [{ knowledge, render, assumptions: [] }];
};

const collectTransitionIds = (render: RenderNode, ids: Set<string>): void => {
  if (render.kind === "element") {
    for (const attribute of render.attributes)
      if (attribute.transitionId) ids.add(attribute.transitionId);
    for (const child of render.children) collectTransitionIds(child, ids);
  }
  if (render.kind === "branch") {
    collectTransitionIds(render.whenTrue, ids);
    collectTransitionIds(render.whenFalse, ids);
  }
  if (render.kind === "list") collectTransitionIds(render.item, ids);
};

const collectDeadBranches = (
  render: RenderNode,
  outcomes: BranchOutcomes,
  dead: DeadBranch[],
): void => {
  if (render.kind === "branch") {
    const reached = outcomes.get(render);
    if (reached && !reached.has(true))
      dead.push({ text: `never ${formatExpression(render.condition)}`, span: render.span });
    if (reached && !reached.has(false) && render.whenFalse.kind !== "empty")
      dead.push({ text: `never ${formatNegated(render.condition)}`, span: render.span });
    if (reached?.has(true)) collectDeadBranches(render.whenTrue, outcomes, dead);
    if (reached?.has(false)) collectDeadBranches(render.whenFalse, outcomes, dead);
  }
  if (render.kind === "element")
    for (const child of render.children) collectDeadBranches(child, outcomes, dead);
};

const isLengthPreserving = (value: Expression, slot: string): boolean =>
  value.kind === "array" &&
  value.itemCount === 0 &&
  value.spreads.length === 1 &&
  value.spreads[0]?.kind === "slot" &&
  value.spreads[0].slot === slot &&
  value.spreads[0].path.length === 0;

const getLengthBounds = (value: Expression, slot: string): Bound[] => {
  if (value.kind !== "array") return [];
  const lengthAtom = `${slot}.length`;
  const minimum: Bound = {
    left: ZERO_ATOM,
    right: lengthAtom,
    constant: -value.itemCount,
    isStrict: false,
  };
  if (value.spreads.length > 0) return [minimum];
  return [
    minimum,
    { left: lengthAtom, right: ZERO_ATOM, constant: value.itemCount, isStrict: false },
  ];
};

const applyTransition = (
  transition: Transition,
  knowledge: Knowledge,
  reachable: Knowledge,
): Knowledge[] => {
  const applied = applyUpdates(transition, knowledge, reachable);
  return transition.updates.some((update) => update.guards.length > 0)
    ? [knowledge, applied]
    : [applied];
};

const applyUpdates = (
  transition: Transition,
  knowledge: Knowledge,
  reachable: Knowledge,
): Knowledge => {
  const next = cloneKnowledge(knowledge);
  for (const update of transition.updates) {
    for (const atomKey of reachable.values.keys()) {
      const path = getAtomPath(atomKey, update.slot);
      if (!path) continue;
      const current = knowledge.values.get(atomKey);
      const cases =
        getFieldCases(update.value, path, update.slot, knowledge) ??
        getToggleCases(update.value, atomKey, current);
      if (cases === "unchanged") continue;
      const resolved = cases
        ? new Set(cases)
        : (reachable.values.get(atomKey) ?? new Set<string>());
      next.values.set(atomKey, resolved);
    }
    const isKeepingLength = isLengthPreserving(update.value, update.slot);
    const lengthAtom = `${update.slot}.length`;
    const slotPattern = new RegExp(`(^|[^\\w.])${update.slot}\\b`);
    for (const factKey of knowledge.facts.keys()) {
      if (slotPattern.test(factKey) && !(isKeepingLength && factKey.includes(lengthAtom)))
        next.facts.delete(factKey);
    }
    next.bounds = next.bounds.filter((bound) => {
      const mentionsSlot =
        getAtomPath(bound.left, update.slot) !== undefined ||
        getAtomPath(bound.right, update.slot) !== undefined;
      const isLengthOnly = bound.left === lengthAtom || bound.right === lengthAtom;
      return !mentionsSlot || (isKeepingLength && isLengthOnly);
    });
    next.bounds.push(...getLengthBounds(update.value, update.slot));
  }
  return next;
};

export const enumerateStates = (model: ComponentModel): StateReport => {
  const reachable = createInitialKnowledge(model);
  const outcomes: BranchOutcomes = new Map();
  const alternatives = enumerate(model.render, reachable, outcomes);
  const signatures = alternatives.map((alternative) => JSON.stringify(alternative.render));
  const effectIds = new Set(
    model.transitions
      .filter((transition) => !transition.trigger.startsWith("<"))
      .map((transition) => transition.id),
  );

  const states = alternatives.map((alternative): State => {
    const ids = new Set<string>(effectIds);
    collectTransitionIds(alternative.render, ids);
    const edges: Edge[] = [];
    for (const transition of model.transitions) {
      if (!ids.has(transition.id) || transition.updates.length === 0) continue;
      const targetSignatures = new Set(
        applyTransition(transition, alternative.knowledge, reachable).flatMap((afterTransition) =>
          enumerate(model.render, afterTransition, new Map()).map((target) =>
            JSON.stringify(target.render),
          ),
        ),
      );
      const targets = signatures.flatMap((signature, index) =>
        targetSignatures.has(signature) ? [index] : [],
      );
      edges.push({
        transitionId: transition.id,
        targets,
        isAsync: transition.updates.some((update) => update.isAsync),
      });
    }
    return { assumptions: alternative.assumptions, render: alternative.render, edges };
  });

  const deadBranches: DeadBranch[] = [];
  collectDeadBranches(model.render, outcomes, deadBranches);
  const initial = new Map<string, string[]>();
  for (const [atomKey, values] of reachable.values) initial.set(atomKey, [...values]);
  return { initial, states, deadBranches, isTruncated: alternatives.length >= MAX_ALTERNATIVES };
};

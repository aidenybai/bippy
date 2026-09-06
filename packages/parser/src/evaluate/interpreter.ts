import type {
  Argument,
  ArrayExpression,
  AssignmentExpression,
  BinaryExpression,
  BindingPattern,
  CallExpression,
  Class,
  Expression,
  JSXAttributeItem,
  JSXChild,
  JSXElement,
  JSXElementName,
  JSXFragment,
  JSXMemberExpressionObject,
  LogicalExpression,
  MemberExpression,
  NewExpression,
  ObjectExpression,
  ParamPattern,
  PrivateInExpression,
  PropertyKey,
  Span,
  Statement,
  SwitchStatement,
  TemplateLiteral,
  UnaryExpression,
} from "oxc-parser";
import type { ModuleGraph } from "../graph/module-graph.js";
import { getSourceLocation } from "../parse/source-location.js";
import { toElementType } from "../react/element-type.js";
import { resolveReactApi, resolveReactApiMember } from "../react/react-api.js";
import type {
  Diagnostic,
  FunctionLikeNode,
  ModuleRecord,
  ResolvedSymbol,
  Scope,
  SourceLocation,
  StaticElementValue,
  StaticObjectEntry,
  StaticObjectValue,
  StaticPrimitive,
  StaticValue,
  TopLevelBinding,
} from "../types.js";
import { evaluateBuiltinCall, getBuiltinGlobal } from "./builtin-calls.js";
import type { ContextFrame, EvaluationContext } from "./context.js";
import { withScope } from "./context.js";
import { cleanJsxText } from "./jsx-text.js";
import { evaluateReactApiCall } from "./react-calls.js";
import { createScope, declareInScope, findOwningScope, lookupScope } from "./scope.js";
import {
  branchValue,
  componentReference,
  describeValue,
  FALSE_VALUE,
  falsyCounterpart,
  getObjectProperty,
  getTruthiness,
  isNullish,
  listValue,
  mapValue,
  NULL_VALUE,
  objectValue,
  omitObjectKeys,
  primitiveValue,
  TRUE_VALUE,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

export interface InterpreterOptions {
  maxCallDepth?: number;
  maxRecursionPerFunction?: number;
  maxForkDepth?: number;
  maxSteps?: number;
}

const DEFAULT_MAX_CALL_DEPTH = 32;
const DEFAULT_MAX_RECURSION_PER_FUNCTION = 2;
const DEFAULT_MAX_FORK_DEPTH = 5;
const DEFAULT_MAX_STEPS = 2_000_000;

const IN_PROGRESS = Symbol("in-progress");

interface StatementOutcome {
  returned: StaticValue | null;
}

const COMPLETES: StatementOutcome = { returned: null };

export interface CallOptions {
  thisValue?: StaticValue | null;
  contextFrame?: ContextFrame | null;
  callStack?: FunctionLikeNode[];
}

export class Interpreter {
  readonly graph: ModuleGraph;
  readonly diagnostics: Diagnostic[] = [];
  private readonly maxCallDepth: number;
  private readonly maxRecursionPerFunction: number;
  private readonly maxForkDepth: number;
  private remainingSteps: number;
  private readonly moduleScopes = new Map<string, Scope>();
  private readonly moduleValues = new Map<string, Map<string, StaticValue | typeof IN_PROGRESS>>();
  private readonly diagnosticKeys = new Set<string>();

  constructor(graph: ModuleGraph, options: InterpreterOptions = {}) {
    this.graph = graph;
    this.maxCallDepth = options.maxCallDepth ?? DEFAULT_MAX_CALL_DEPTH;
    this.maxRecursionPerFunction = options.maxRecursionPerFunction ?? DEFAULT_MAX_RECURSION_PER_FUNCTION;
    this.maxForkDepth = options.maxForkDepth ?? DEFAULT_MAX_FORK_DEPTH;
    this.remainingSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  }

  report(code: string, message: string, location: SourceLocation | null, severity: Diagnostic["severity"] = "info"): void {
    const key = `${code}\u0000${message}\u0000${location?.filePath}:${location?.line}:${location?.column}`;
    if (this.diagnosticKeys.has(key)) return;
    this.diagnosticKeys.add(key);
    this.diagnostics.push({ severity, code, message, location });
  }

  locate(module: ModuleRecord, span: Span): SourceLocation {
    return getSourceLocation(module.file, span);
  }

  createModuleContext(module: ModuleRecord, contextFrame: ContextFrame | null = null): EvaluationContext {
    return {
      module,
      scope: this.getModuleScope(module),
      thisValue: null,
      contextFrame,
      callStack: [],
      uncertainDepth: 0,
      forkDepth: 0,
    };
  }

  getModuleScope(module: ModuleRecord): Scope {
    let scope = this.moduleScopes.get(module.filePath);
    if (!scope) {
      scope = createScope(null);
      this.moduleScopes.set(module.filePath, scope);
    }
    return scope;
  }

  evaluateModuleExport(module: ModuleRecord, exportedName: string): StaticValue {
    return this.resolvedSymbolToValue(this.graph.resolveExport(module, exportedName), exportedName);
  }

  evaluateModuleBinding(module: ModuleRecord, name: string): StaticValue | null {
    const binding = module.bindings.get(name);
    if (!binding) return null;
    let values = this.moduleValues.get(module.filePath);
    if (!values) {
      values = new Map();
      this.moduleValues.set(module.filePath, values);
    }
    const cached = values.get(name);
    if (cached === IN_PROGRESS) {
      return unknownValue(`cyclic module-level evaluation of "${name}"`, this.locate(module, binding.span));
    }
    if (cached) return cached;
    values.set(name, IN_PROGRESS);
    const value = this.evaluateTopLevelBinding(module, binding);
    values.set(name, value);
    return value;
  }

  resolvedSymbolToValue(symbol: ResolvedSymbol, nameHint: string | null): StaticValue {
    switch (symbol.kind) {
      case "binding":
        return this.evaluateModuleBinding(symbol.module, symbol.binding.name) ?? UNDEFINED_VALUE;
      case "expression":
        return this.evaluateExpression(symbol.expression, this.createModuleContext(symbol.module), nameHint);
      case "namespace":
        return { kind: "namespace", module: symbol.module };
      case "external": {
        const importedName =
          symbol.imported.kind === "named"
            ? symbol.imported.name
            : symbol.imported.kind === "default"
              ? "default"
              : "*";
        if (symbol.imported.kind === "named") {
          const api = resolveReactApi(symbol.packageName, symbol.imported.name);
          if (api) return { kind: "react-api", api };
        }
        if (symbol.imported.kind === "namespace" || symbol.imported.kind === "default") {
          const api = resolveReactApi(symbol.packageName, "*");
          if (api) return { kind: "react-api", api };
        }
        return { kind: "external", packageName: symbol.packageName, importedName };
      }
      case "unresolved":
        return unknownValue(symbol.reason);
    }
  }

  private evaluateTopLevelBinding(module: ModuleRecord, binding: TopLevelBinding): StaticValue {
    const context = this.createModuleContext(module);
    const value = this.evaluateTopLevelBindingValue(module, binding, context);
    return this.applyMemberAssignments(module, binding.name, value, context);
  }

  private applyMemberAssignments(
    module: ModuleRecord,
    name: string,
    value: StaticValue,
    context: EvaluationContext,
  ): StaticValue {
    let result = value;
    for (const assignment of module.memberAssignments) {
      if (assignment.objectName !== name) continue;
      const assigned = this.evaluateExpression(assignment.value, context, assignment.propertyName);
      result = this.assignProperty(result, assignment.propertyName, assigned);
    }
    return result;
  }

  private assignProperty(target: StaticValue, propertyName: string, value: StaticValue): StaticValue {
    switch (target.kind) {
      case "object":
        target.entries.push({ kind: "property", key: propertyName, value });
        return target;
      case "function":
      case "class":
        target.properties.set(propertyName, value);
        return target;
      case "component-reference": {
        if (propertyName !== "displayName" || value.kind !== "primitive" || typeof value.value !== "string") return target;
        const type = target.type;
        if (type.kind === "memo" || type.kind === "forward-ref" || type.kind === "lazy") {
          return componentReference({ ...type, displayName: value.value });
        }
        return target;
      }
      default:
        return target;
    }
  }

  private evaluateTopLevelBindingValue(module: ModuleRecord, binding: TopLevelBinding, context: EvaluationContext): StaticValue {
    switch (binding.kind) {
      case "variable":
        return binding.init ? this.evaluateExpression(binding.init, context, binding.name) : UNDEFINED_VALUE;
      case "function":
        return this.createFunctionValue(binding.node, context, binding.name);
      case "class":
        return this.createClassValue(binding.node, context, binding.name);
      case "import":
        return this.resolvedSymbolToValue(this.graph.resolveImport(binding.binding, module), binding.name);
      case "destructured": {
        const initValue = binding.init ? this.evaluateExpression(binding.init, context, null) : UNDEFINED_VALUE;
        const scratch = createScope(null);
        this.bindPattern(binding.pattern, initValue, scratch, context);
        return scratch.bindings.get(binding.name) ?? UNDEFINED_VALUE;
      }
    }
  }

  createFunctionValue(node: FunctionLikeNode, context: EvaluationContext, nameHint: string | null): StaticValue {
    const explicitName = node.type === "ArrowFunctionExpression" ? null : node.id?.name ?? null;
    return {
      kind: "function",
      node,
      scope: context.scope,
      module: context.module,
      thisValue: node.type === "ArrowFunctionExpression" ? context.thisValue : null,
      name: explicitName ?? nameHint,
      properties: new Map(),
    };
  }

  private createClassValue(node: Class, context: EvaluationContext, nameHint: string | null): StaticValue {
    return {
      kind: "class",
      node,
      scope: context.scope,
      module: context.module,
      name: node.id?.name ?? nameHint,
      properties: new Map(),
    };
  }

  lookupIdentifier(name: string, context: EvaluationContext): StaticValue {
    const scoped = lookupScope(context.scope, name);
    if (scoped) return scoped;
    const moduleValue = this.evaluateModuleBinding(context.module, name);
    if (moduleValue) return moduleValue;
    const builtin = getBuiltinGlobal(name);
    if (builtin) return builtin;
    return unknownValue(`unbound identifier "${name}"`);
  }

  private consumeStep(location: SourceLocation | null): boolean {
    if (this.remainingSteps <= 0) {
      this.report("budget-exhausted", "evaluation step budget exhausted", location, "warning");
      return false;
    }
    this.remainingSteps--;
    return true;
  }

  evaluateExpression(node: Expression, context: EvaluationContext, nameHint: string | null = null): StaticValue {
    const location = this.locate(context.module, node);
    if (!this.consumeStep(location)) return unknownValue("step budget exhausted", location);
    switch (node.type) {
      case "Literal":
        if ("regex" in node) return unknownValue("regular expression literal", location);
        return primitiveValue(node.value);
      case "TemplateLiteral":
        return this.evaluateTemplateLiteral(node, context);
      case "Identifier":
        if (node.name === "undefined") return UNDEFINED_VALUE;
        return this.lookupIdentifier(node.name, context);
      case "ThisExpression":
        return context.thisValue ?? unknownValue("this outside of a class", location);
      case "ArrayExpression":
        return this.evaluateArrayExpression(node, context);
      case "ObjectExpression":
        return this.evaluateObjectExpression(node, context);
      case "ArrowFunctionExpression":
      case "FunctionExpression":
      case "FunctionDeclaration":
        return this.createFunctionValue(node, context, nameHint);
      case "TSDeclareFunction":
      case "TSEmptyBodyFunctionExpression":
        return unknownValue("function without a body", location);
      case "ClassExpression":
      case "ClassDeclaration":
        return this.createClassValue(node, context, nameHint);
      case "TSAsExpression":
      case "TSSatisfiesExpression":
      case "TSNonNullExpression":
      case "TSTypeAssertion":
      case "TSInstantiationExpression":
      case "ParenthesizedExpression":
        return this.evaluateExpression(node.expression, context, nameHint);
      case "ChainExpression":
        return this.evaluateExpression(node.expression, context, nameHint);
      case "SequenceExpression":
        return this.evaluateExpression(node.expressions[node.expressions.length - 1], context, nameHint);
      case "AwaitExpression":
        return this.evaluateExpression(node.argument, context, nameHint);
      case "MemberExpression":
        return this.evaluateMemberExpression(node, context);
      case "CallExpression":
        return this.evaluateCallExpression(node, context, nameHint);
      case "NewExpression":
        return this.evaluateNewExpression(node, context);
      case "ConditionalExpression": {
        const test = this.evaluateExpression(node.test, context);
        const truthiness = getTruthiness(test);
        if (truthiness === true) return this.evaluateExpression(node.consequent, context, nameHint);
        if (truthiness === false) return this.evaluateExpression(node.alternate, context, nameHint);
        return branchValue(
          [
            this.evaluateExpression(node.consequent, context, nameHint),
            this.evaluateExpression(node.alternate, context, nameHint),
          ],
          `conditional on ${describeValue(test)}`,
          location,
        );
      }
      case "LogicalExpression":
        return this.evaluateLogicalExpression(node, context, nameHint);
      case "UnaryExpression":
        return this.evaluateUnaryExpression(node, context);
      case "BinaryExpression":
        return this.evaluateBinaryExpression(node, context);
      case "AssignmentExpression":
        return this.evaluateAssignmentExpression(node, context);
      case "UpdateExpression":
        return unknownPrimitiveValue("number", "update expression");
      case "JSXElement":
        return this.evaluateJsxElement(node, context);
      case "JSXFragment":
        return this.evaluateJsxFragment(node, context);
      case "ImportExpression": {
        if (node.source.type !== "Literal" || typeof node.source.value !== "string") {
          return unknownValue("dynamic import with non-literal specifier", location);
        }
        const target = this.graph.resolveImportedModule(node.source.value, context.module);
        if ("bindings" in target) return { kind: "namespace", module: target };
        if (target.kind === "external") {
          return { kind: "external", packageName: target.packageName, importedName: "*" };
        }
        return unknownValue(`cannot resolve dynamic import "${node.source.value}"`, location);
      }
      case "TaggedTemplateExpression": {
        const tag = this.evaluateExpression(node.tag, context);
        if (tag.kind === "external") return { ...tag, importedName: `${tag.importedName}\`\`` };
        if (tag.kind === "function") {
          return this.callFunction(tag, [unknownValue("template strings"), unknownValue("template values")], context);
        }
        return unknownValue("tagged template", location);
      }
      case "YieldExpression":
      case "Super":
      case "MetaProperty":
      case "V8IntrinsicExpression":
        return unknownValue(`unsupported expression ${node.type}`, location);
    }
  }

  private evaluateTemplateLiteral(node: TemplateLiteral, context: EvaluationContext): StaticValue {
    let text = "";
    let isKnown = true;
    node.quasis.forEach((quasi, index) => {
      text += quasi.value.cooked ?? quasi.value.raw;
      if (index < node.expressions.length) {
        const value = this.evaluateExpression(node.expressions[index], context);
        if (value.kind === "primitive") {
          text += String(value.value);
        } else {
          isKnown = false;
        }
      }
    });
    return isKnown ? primitiveValue(text) : unknownPrimitiveValue("string", "template literal with dynamic parts");
  }

  private evaluateArrayExpression(node: ArrayExpression, context: EvaluationContext): StaticValue {
    const items: StaticValue[] = [];
    for (const element of node.elements) {
      if (element === null) {
        items.push(UNDEFINED_VALUE);
        continue;
      }
      if (element.type === "SpreadElement") {
        const spread = this.evaluateExpression(element.argument, context);
        if (spread.kind === "list") items.push(...spread.items);
        else if (spread.kind === "repeat") items.push(spread);
        else items.push(unknownValue(`spread of ${describeValue(spread)}`));
        continue;
      }
      items.push(this.evaluateExpression(element, context));
    }
    return listValue(items);
  }

  private evaluatePropertyKey(key: PropertyKey, computed: boolean, context: EvaluationContext): string | null {
    if (!computed) {
      if (key.type === "Identifier") return key.name;
      if (key.type === "Literal" && !("regex" in key)) return String(key.value);
      if (key.type === "PrivateIdentifier") return `#${key.name}`;
    }
    if (key.type === "PrivateIdentifier") return `#${key.name}`;
    const value = this.evaluateExpression(key, context);
    if (value.kind === "primitive") return String(value.value);
    return null;
  }

  private evaluateObjectExpression(node: ObjectExpression, context: EvaluationContext): StaticValue {
    const entries: StaticObjectEntry[] = [];
    for (const property of node.properties) {
      if (property.type === "SpreadElement") {
        entries.push({ kind: "spread", value: this.evaluateExpression(property.argument, context) });
        continue;
      }
      if (property.kind !== "init") continue;
      const key = this.evaluatePropertyKey(property.key, property.computed, context);
      if (key === null) {
        entries.push({ kind: "spread", value: unknownValue("computed property key") });
        continue;
      }
      entries.push({ kind: "property", key, value: this.evaluateExpression(property.value, context, key) });
    }
    return objectValue(entries);
  }

  private evaluateLogicalExpression(node: LogicalExpression, context: EvaluationContext, nameHint: string | null): StaticValue {
    const left = this.evaluateExpression(node.left, context, nameHint);
    const location = this.locate(context.module, node);
    switch (node.operator) {
      case "&&": {
        const truthiness = getTruthiness(left);
        if (truthiness === true) return this.evaluateExpression(node.right, context, nameHint);
        if (truthiness === false) return left;
        return branchValue(
          [this.evaluateExpression(node.right, context, nameHint), falsyCounterpart(left)],
          `&& on ${describeValue(left)}`,
          location,
        );
      }
      case "||": {
        const truthiness = getTruthiness(left);
        if (truthiness === true) return left;
        if (truthiness === false) return this.evaluateExpression(node.right, context, nameHint);
        return branchValue(
          [left, this.evaluateExpression(node.right, context, nameHint)],
          `|| on ${describeValue(left)}`,
          location,
        );
      }
      case "??": {
        const nullish = isNullish(left);
        if (nullish === false) return left;
        if (nullish === true) return this.evaluateExpression(node.right, context, nameHint);
        return branchValue(
          [left, this.evaluateExpression(node.right, context, nameHint)],
          `?? on ${describeValue(left)}`,
          location,
        );
      }
    }
  }

  private evaluateUnaryExpression(node: UnaryExpression, context: EvaluationContext): StaticValue {
    const argument = this.evaluateExpression(node.argument, context);
    switch (node.operator) {
      case "!": {
        const truthiness = getTruthiness(argument);
        if (truthiness === null) {
          return mapValue(argument, (alternative) => {
            const inner = getTruthiness(alternative);
            return inner === null ? unknownPrimitiveValue("boolean", "negation of unknown") : inner ? FALSE_VALUE : TRUE_VALUE;
          });
        }
        return truthiness ? FALSE_VALUE : TRUE_VALUE;
      }
      case "typeof":
        if (argument.kind === "primitive") return primitiveValue(typeof argument.value);
        if (argument.kind === "function" || argument.kind === "class") return primitiveValue("function");
        if (argument.kind === "object" || argument.kind === "list" || argument.kind === "element") {
          return primitiveValue("object");
        }
        return unknownPrimitiveValue("string", "typeof unknown");
      case "-":
        if (argument.kind === "primitive" && typeof argument.value === "number") return primitiveValue(-argument.value);
        return unknownPrimitiveValue("number", "unary minus");
      case "+":
        if (argument.kind === "primitive" && typeof argument.value !== "bigint") return primitiveValue(Number(argument.value));
        return unknownPrimitiveValue("number", "unary plus");
      case "void":
        return UNDEFINED_VALUE;
      case "~":
        return unknownPrimitiveValue("number", "bitwise not");
      case "delete":
        return TRUE_VALUE;
    }
  }

  private evaluateBinaryExpression(node: BinaryExpression | PrivateInExpression, context: EvaluationContext): StaticValue {
    if (node.left.type === "PrivateIdentifier") return unknownPrimitiveValue("boolean", "private in");
    const left = this.evaluateExpression(node.left, context);
    const right = this.evaluateExpression(node.right, context);
    if (left.kind === "primitive" && right.kind === "primitive") {
      const computed = computeBinary(node.operator, left.value, right.value);
      if (computed !== undefined) return computed;
    }
    switch (node.operator) {
      case "==":
      case "!=":
      case "===":
      case "!==":
      case "<":
      case "<=":
      case ">":
      case ">=":
      case "instanceof":
      case "in":
        return unknownPrimitiveValue("boolean", `${node.operator} on dynamic values`);
      case "+": {
        const isString =
          (left.kind === "primitive" && typeof left.value === "string") ||
          (right.kind === "primitive" && typeof right.value === "string") ||
          (left.kind === "unknown-primitive" && left.primitiveType === "string") ||
          (right.kind === "unknown-primitive" && right.primitiveType === "string");
        return unknownPrimitiveValue(isString ? "string" : "any", "+ on dynamic values");
      }
      default:
        return unknownPrimitiveValue("number", `${node.operator} on dynamic values`);
    }
  }

  private evaluateAssignmentExpression(node: AssignmentExpression, context: EvaluationContext): StaticValue {
    const value =
      node.operator === "="
        ? this.evaluateExpression(node.right, context, node.left.type === "Identifier" ? node.left.name : null)
        : unknownValue(`compound assignment ${node.operator}`);
    const target = node.left;
    if (target.type === "Identifier") {
      this.assignIdentifier(target.name, value, context);
    } else if (target.type === "MemberExpression" && !target.computed && target.property.type === "Identifier") {
      const object = this.evaluateExpression(target.object, context);
      const reassigned = this.assignProperty(object, target.property.name, value);
      if (reassigned !== object && target.object.type === "Identifier") {
        this.assignIdentifier(target.object.name, reassigned, context);
      }
    } else if (target.type === "ObjectPattern" || target.type === "ArrayPattern") {
      this.report("unsupported-assignment", "destructuring assignment is not tracked", this.locate(context.module, node));
    }
    return value;
  }

  private assignIdentifier(name: string, value: StaticValue, context: EvaluationContext): void {
    const owner = findOwningScope(context.scope, name);
    if (!owner) return;
    if (context.uncertainDepth > 0) {
      const previous = owner.bindings.get(name) ?? UNDEFINED_VALUE;
      owner.bindings.set(name, branchValue([value, previous], `assignment to ${name} in an uncertain path`));
      return;
    }
    owner.bindings.set(name, value);
  }

  private evaluateMemberExpression(node: MemberExpression, context: EvaluationContext): StaticValue {
    const object = this.evaluateExpression(node.object, context);
    const location = this.locate(context.module, node);
    if (node.property.type === "PrivateIdentifier") {
      return this.getProperty(object, `#${node.property.name}`, context, location, node.optional);
    }
    if (!node.computed) {
      return this.getProperty(object, node.property.name, context, location, node.optional);
    }
    const key = this.evaluateExpression(node.property, context);
    if (key.kind === "primitive") {
      return this.getProperty(object, String(key.value), context, location, node.optional);
    }
    if (object.kind === "list") {
      const candidates = object.items.filter((item) => item.kind !== "repeat");
      return candidates.length === 0
        ? unknownValue("index into an unknown list", location)
        : branchValue(candidates, "dynamic list index", location);
    }
    if (object.kind === "object") {
      const values = object.entries.filter((entry) => entry.kind === "property").map((entry) => entry.value);
      return values.length === 0
        ? unknownValue("dynamic key into an unknown object", location)
        : branchValue(values, "dynamic object key", location);
    }
    return unknownValue(`dynamic member access on ${describeValue(object)}`, location);
  }

  getProperty(
    object: StaticValue,
    key: string,
    context: EvaluationContext,
    location: SourceLocation | null,
    optional = false,
  ): StaticValue {
    switch (object.kind) {
      case "branch":
        return mapValue(object, (alternative) => this.getProperty(alternative, key, context, location, optional));
      case "object":
        return getObjectProperty(object, key);
      case "list": {
        if (key === "length") {
          const hasUnknownLength = object.items.some((item) => item.kind === "repeat" || item.kind === "unknown");
          return hasUnknownLength
            ? unknownPrimitiveValue("number", "length of a partially known list")
            : primitiveValue(object.items.length);
        }
        const index = Number(key);
        if (Number.isInteger(index) && index >= 0) {
          const hasUnknownPrefix = object.items.slice(0, index + 1).some((item) => item.kind === "repeat" || item.kind === "unknown");
          if (hasUnknownPrefix) return unknownValue(`index ${index} of a partially known list`, location);
          return object.items[index] ?? UNDEFINED_VALUE;
        }
        return { kind: "method", receiver: object, name: key };
      }
      case "primitive":
        if (object.value === null || object.value === undefined) {
          if (optional) return UNDEFINED_VALUE;
          return unknownValue(`property "${key}" of ${String(object.value)}`, location);
        }
        if (typeof object.value === "string" && key === "length") return primitiveValue(object.value.length);
        return { kind: "method", receiver: object, name: key };
      case "unknown-primitive":
        if (key === "length") return unknownPrimitiveValue("number", "length of dynamic value");
        return { kind: "method", receiver: object, name: key };
      case "context":
        if (key === "Provider") {
          return componentReference({ kind: "context-provider", context: object.context, displayName: `${object.context.name}.Provider` });
        }
        if (key === "Consumer") {
          return componentReference({ kind: "context-consumer", context: object.context, displayName: `${object.context.name}.Consumer` });
        }
        return unknownValue(`context property "${key}"`, location);
      case "react-api": {
        if (object.api === "Component" || object.api === "PureComponent") {
          return unknownValue(`React.${object.api}.${key}`, location);
        }
        const member = resolveReactApiMember(object.api, key);
        if (member) return member;
        return unknownValue(`React.${object.api}.${key}`, location);
      }
      case "external":
        if (object.packageName === "react" || object.packageName === "react-dom") {
          const api = resolveReactApi(object.packageName, key);
          if (api && object.importedName === "*") return { kind: "react-api", api };
        }
        return { kind: "external", packageName: object.packageName, importedName: `${object.importedName}.${key}` };
      case "namespace":
        return this.evaluateModuleExport(object.module, key);
      case "global":
        return getBuiltinGlobal(`${object.name}.${key}`) ?? { kind: "method", receiver: object, name: key };
      case "element":
        if (key === "props") return object.props;
        if (key === "key") return object.key ?? NULL_VALUE;
        if (key === "type") return componentReference(object.type);
        return unknownValue(`element.${key}`, location);
      case "function":
      case "class": {
        const property = object.properties.get(key);
        if (property) return property;
        if (key === "displayName") return UNDEFINED_VALUE;
        if (key === "name") return object.name ? primitiveValue(object.name) : primitiveValue("");
        return unknownValue(`${describeValue(object)}.${key}`, location);
      }
      case "component-reference":
        if (key === "displayName" || key === "name") return unknownPrimitiveValue("string", "component name");
        return unknownValue(`component property "${key}"`, location);
      case "repeat":
        if (key === "length") return unknownPrimitiveValue("number", "length of a repeated list");
        return { kind: "method", receiver: object, name: key };
      case "method":
        return unknownValue(`property "${key}" of a method`, location);
      case "unknown":
        return unknownValue(object.reason, location);
    }
  }

  evaluateArguments(args: Argument[], context: EvaluationContext): StaticValue[] {
    const values: StaticValue[] = [];
    for (const argument of args) {
      if (argument.type === "SpreadElement") {
        const spread = this.evaluateExpression(argument.argument, context);
        if (spread.kind === "list" && spread.items.every((item) => item.kind !== "repeat")) {
          values.push(...spread.items);
        } else {
          values.push(unknownValue(`spread argument ${describeValue(spread)}`));
        }
        continue;
      }
      values.push(this.evaluateExpression(argument, context));
    }
    return values;
  }

  private evaluateCallExpression(node: CallExpression, context: EvaluationContext, nameHint: string | null): StaticValue {
    const location = this.locate(context.module, node);
    let callee: StaticValue;
    let thisValue: StaticValue | null = null;
    if (node.callee.type === "MemberExpression") {
      const receiver = this.evaluateExpression(node.callee.object, context);
      thisValue = receiver;
      if (node.callee.property.type === "PrivateIdentifier") {
        callee = this.getProperty(receiver, `#${node.callee.property.name}`, context, location, node.callee.optional);
      } else if (!node.callee.computed) {
        callee = this.getProperty(receiver, node.callee.property.name, context, location, node.callee.optional);
      } else {
        const key = this.evaluateExpression(node.callee.property, context);
        callee =
          key.kind === "primitive"
            ? this.getProperty(receiver, String(key.value), context, location, node.callee.optional)
            : unknownValue("computed method call", location);
      }
    } else {
      callee = this.evaluateExpression(node.callee, context);
    }
    if (node.optional && callee.kind === "primitive" && (callee.value === null || callee.value === undefined)) {
      return UNDEFINED_VALUE;
    }
    const args = this.evaluateArguments(node.arguments, context);
    return this.callValue(callee, args, context, location, { thisValue, nameHint });
  }

  callValue(
    callee: StaticValue,
    args: StaticValue[],
    context: EvaluationContext,
    location: SourceLocation | null,
    options: { thisValue?: StaticValue | null; nameHint?: string | null } = {},
  ): StaticValue {
    switch (callee.kind) {
      case "branch":
        return mapValue(callee, (alternative) => this.callValue(alternative, args, context, location, options));
      case "function":
        return this.callFunction(callee, args, context, { thisValue: options.thisValue ?? callee.thisValue });
      case "react-api":
        return evaluateReactApiCall(this, callee.api, args, context, location, options.nameHint ?? null);
      case "method":
      case "global":
        return evaluateBuiltinCall(this, callee, args, context, location);
      case "external":
        return { kind: "external", packageName: callee.packageName, importedName: `${callee.importedName}()` };
      case "class":
        return unknownValue(`class ${callee.name ?? ""} called without new`, location);
      case "unknown":
        return unknownValue(`call of ${callee.reason}`, location);
      case "primitive":
        return unknownValue(`call of ${String(callee.value)}`, location);
      default:
        return unknownValue(`call of ${describeValue(callee)}`, location);
    }
  }

  private evaluateNewExpression(node: NewExpression, context: EvaluationContext): StaticValue {
    const callee = this.evaluateExpression(node.callee, context);
    const location = this.locate(context.module, node);
    if (callee.kind === "global") {
      const args = this.evaluateArguments(node.arguments, context);
      return evaluateBuiltinCall(this, callee, args, context, location, true);
    }
    return unknownValue(`new ${describeValue(callee)}`, location);
  }

  callFunction(
    fn: Extract<StaticValue, { kind: "function" }>,
    args: StaticValue[],
    context: EvaluationContext,
    options: CallOptions = {},
  ): StaticValue {
    const callStack = options.callStack ?? context.callStack;
    const location = this.locate(fn.module, fn.node);
    if (callStack.length >= this.maxCallDepth) {
      this.report("max-call-depth", `call depth ${this.maxCallDepth} exceeded`, location, "warning");
      return unknownValue("call depth exceeded", location);
    }
    let occurrences = 0;
    for (const frame of callStack) if (frame === fn.node) occurrences++;
    if (occurrences >= this.maxRecursionPerFunction) {
      return unknownValue(`recursive call of ${fn.name ?? "anonymous function"}`, location);
    }
    if (fn.node.async || fn.node.generator) {
      return unknownValue(`${fn.node.async ? "async" : "generator"} function result`, location);
    }
    const scope = createScope(fn.scope);
    const callContext: EvaluationContext = {
      module: fn.module,
      scope,
      thisValue: fn.node.type === "ArrowFunctionExpression" ? fn.thisValue : options.thisValue ?? null,
      contextFrame: options.contextFrame === undefined ? context.contextFrame : options.contextFrame,
      callStack: [...callStack, fn.node],
      uncertainDepth: context.uncertainDepth,
      forkDepth: context.forkDepth,
    };
    this.bindParameters(fn.node.params, args, scope, callContext);
    const body = fn.node.body;
    if (!body) return UNDEFINED_VALUE;
    if (body.type !== "BlockStatement") {
      return this.evaluateExpression(body, callContext);
    }
    const outcome = this.evaluateBlock(body.body, callContext, false);
    return outcome.returned ?? UNDEFINED_VALUE;
  }

  private bindParameters(params: ParamPattern[], args: StaticValue[], scope: Scope, context: EvaluationContext): void {
    params.forEach((param, index) => {
      if (param.type === "RestElement") {
        this.bindPattern(param.argument, listValue(args.slice(index)), scope, context);
        return;
      }
      const pattern = param.type === "TSParameterProperty" ? param.parameter : param;
      this.bindPattern(pattern, args[index] ?? UNDEFINED_VALUE, scope, context);
    });
  }

  bindPattern(pattern: BindingPattern, value: StaticValue, scope: Scope, context: EvaluationContext): void {
    switch (pattern.type) {
      case "Identifier":
        declareInScope(scope, pattern.name, value);
        return;
      case "AssignmentPattern": {
        const nullish = isNullish(value);
        const patternName = pattern.left.type === "Identifier" ? pattern.left.name : null;
        if (nullish === true || (value.kind === "primitive" && value.value === undefined)) {
          this.bindPattern(pattern.left, this.evaluateExpression(pattern.right, withScope(context, scope), patternName), scope, context);
          return;
        }
        if (nullish === false) {
          this.bindPattern(pattern.left, value, scope, context);
          return;
        }
        const fallback = this.evaluateExpression(pattern.right, withScope(context, scope), patternName);
        this.bindPattern(
          pattern.left,
          branchValue([fallback, value], `default for ${patternName ?? "pattern"}`),
          scope,
          context,
        );
        return;
      }
      case "ObjectPattern": {
        const usedKeys = new Set<string>();
        for (const property of pattern.properties) {
          if (property.type === "RestElement") {
            const rest =
              value.kind === "object"
                ? omitObjectKeys(value, usedKeys)
                : unknownValue(`rest of ${describeValue(value)}`);
            this.bindPattern(property.argument, rest, scope, context);
            continue;
          }
          const key = this.evaluatePropertyKey(property.key, property.computed, withScope(context, scope));
          if (key === null) {
            this.bindPattern(property.value, unknownValue("computed destructuring key"), scope, context);
            continue;
          }
          usedKeys.add(key);
          this.bindPattern(property.value, this.getProperty(value, key, context, null, true), scope, context);
        }
        return;
      }
      case "ArrayPattern": {
        pattern.elements.forEach((element, index) => {
          if (!element) return;
          if (element.type === "RestElement") {
            const rest =
              value.kind === "list" && value.items.slice(0, index).every((item) => item.kind !== "repeat")
                ? listValue(value.items.slice(index))
                : unknownValue(`rest of ${describeValue(value)}`);
            this.bindPattern(element.argument, rest, scope, context);
            return;
          }
          this.bindPattern(element, this.getProperty(value, String(index), context, null, true), scope, context);
        });
        return;
      }
    }
  }

  private hoistDeclarations(statements: Statement[], context: EvaluationContext): void {
    for (const statement of statements) {
      if (statement.type === "FunctionDeclaration" && statement.id) {
        declareInScope(context.scope, statement.id.name, this.createFunctionValue(statement, context, statement.id.name));
      }
    }
  }

  evaluateBlock(statements: Statement[], context: EvaluationContext, createChildScope: boolean): StatementOutcome {
    const blockContext = createChildScope ? withScope(context, createScope(context.scope)) : context;
    this.hoistDeclarations(statements, blockContext);
    return this.evaluateStatements(statements, 0, blockContext);
  }

  private evaluateStatements(statements: Statement[], startIndex: number, context: EvaluationContext): StatementOutcome {
    for (let index = startIndex; index < statements.length; index++) {
      const statement = statements[index];
      const location = this.locate(context.module, statement);
      if (!this.consumeStep(location)) return { returned: unknownValue("step budget exhausted", location) };
      switch (statement.type) {
        case "ReturnStatement":
          return {
            returned: statement.argument ? this.evaluateExpression(statement.argument, context) : UNDEFINED_VALUE,
          };
        case "ThrowStatement":
          return { returned: unknownValue("component throws", location) };
        case "VariableDeclaration":
          for (const declarator of statement.declarations) {
            const nameHint = declarator.id.type === "Identifier" ? declarator.id.name : null;
            const value = declarator.init ? this.evaluateExpression(declarator.init, context, nameHint) : UNDEFINED_VALUE;
            this.bindPattern(declarator.id, value, context.scope, context);
          }
          break;
        case "FunctionDeclaration":
          break;
        case "ClassDeclaration":
          if (statement.id) {
            declareInScope(context.scope, statement.id.name, this.createClassValue(statement, context, statement.id.name));
          }
          break;
        case "ExpressionStatement":
          this.evaluateExpression(statement.expression, context);
          break;
        case "BlockStatement": {
          const outcome = this.evaluateBlock(statement.body, context, true);
          if (outcome.returned) return outcome;
          break;
        }
        case "IfStatement": {
          const test = this.evaluateExpression(statement.test, context);
          const truthiness = getTruthiness(test);
          if (truthiness === true) {
            const outcome = this.evaluateBlock([statement.consequent], context, true);
            if (outcome.returned) return outcome;
            break;
          }
          if (truthiness === false) {
            if (!statement.alternate) break;
            const outcome = this.evaluateBlock([statement.alternate], context, true);
            if (outcome.returned) return outcome;
            break;
          }
          return this.forkPaths(
            [
              (pathContext) => this.evaluateBlock([statement.consequent], pathContext, true),
              (pathContext) =>
                statement.alternate ? this.evaluateBlock([statement.alternate], pathContext, true) : COMPLETES,
            ],
            statements,
            index + 1,
            context,
            `if (${describeValue(test)})`,
            location,
          );
        }
        case "SwitchStatement":
          return this.evaluateSwitch(statement, statements, index + 1, context, location);
        case "TryStatement": {
          const outcome = this.evaluateBlock(statement.block.body, context, true);
          if (outcome.returned) return outcome;
          if (statement.finalizer) {
            const finalOutcome = this.evaluateBlock(statement.finalizer.body, context, true);
            if (finalOutcome.returned) return finalOutcome;
          }
          break;
        }
        case "ForOfStatement":
        case "ForInStatement":
        case "ForStatement":
        case "WhileStatement":
        case "DoWhileStatement": {
          const loopContext: EvaluationContext = {
            ...context,
            scope: createScope(context.scope),
            uncertainDepth: context.uncertainDepth + 1,
          };
          if (statement.type === "ForOfStatement" || statement.type === "ForInStatement") {
            if (statement.left.type === "VariableDeclaration") {
              for (const declarator of statement.left.declarations) {
                this.bindPattern(declarator.id, unknownValue("loop variable"), loopContext.scope, loopContext);
              }
            }
          } else if (statement.type === "ForStatement" && statement.init?.type === "VariableDeclaration") {
            for (const declarator of statement.init.declarations) {
              this.bindPattern(declarator.id, unknownPrimitiveValue("number", "loop counter"), loopContext.scope, loopContext);
            }
          }
          const outcome = this.evaluateBlock([statement.body], loopContext, true);
          if (outcome.returned) {
            return this.forkPaths(
              [() => outcome, () => COMPLETES],
              statements,
              index + 1,
              context,
              "return inside a loop",
              location,
            );
          }
          break;
        }
        case "LabeledStatement": {
          const outcome = this.evaluateBlock([statement.body], context, false);
          if (outcome.returned) return outcome;
          break;
        }
        default:
          break;
      }
    }
    return COMPLETES;
  }

  private forkPaths(
    branches: Array<(pathContext: EvaluationContext) => StatementOutcome>,
    statements: Statement[],
    continueIndex: number,
    context: EvaluationContext,
    reason: string,
    location: SourceLocation,
  ): StatementOutcome {
    if (context.forkDepth >= this.maxForkDepth) {
      const uncertainContext: EvaluationContext = { ...context, uncertainDepth: context.uncertainDepth + 1 };
      const returnedValues: StaticValue[] = [];
      let anyCompletes = false;
      for (const branch of branches) {
        const outcome = branch(uncertainContext);
        if (outcome.returned) returnedValues.push(outcome.returned);
        else anyCompletes = true;
      }
      if (anyCompletes) {
        const rest = this.evaluateStatements(statements, continueIndex, uncertainContext);
        returnedValues.push(rest.returned ?? UNDEFINED_VALUE);
      }
      return { returned: branchValue(returnedValues, reason, location) };
    }
    const forkContext: EvaluationContext = { ...context, forkDepth: context.forkDepth + 1 };
    const results: StaticValue[] = [];
    const snapshot = snapshotScopes(context.scope);
    branches.forEach((branch, branchIndex) => {
      if (branchIndex > 0) restoreScopes(snapshot);
      const outcome = branch(forkContext);
      if (outcome.returned) {
        results.push(outcome.returned);
        return;
      }
      const rest = this.evaluateStatements(statements, continueIndex, forkContext);
      results.push(rest.returned ?? UNDEFINED_VALUE);
    });
    return { returned: branchValue(results, reason, location) };
  }

  private evaluateSwitch(
    statement: SwitchStatement,
    statements: Statement[],
    continueIndex: number,
    context: EvaluationContext,
    location: SourceLocation,
  ): StatementOutcome {
    const discriminant = this.evaluateExpression(statement.discriminant, context);
    const caseValues = statement.cases.map((switchCase) =>
      switchCase.test ? this.evaluateExpression(switchCase.test, context) : null,
    );
    const runFrom = (startCase: number, pathContext: EvaluationContext): StatementOutcome => {
      const switchContext = withScope(pathContext, createScope(pathContext.scope));
      for (let caseIndex = startCase; caseIndex < statement.cases.length; caseIndex++) {
        const consequent = statement.cases[caseIndex].consequent;
        const breakIndex = consequent.findIndex((inner) => inner.type === "BreakStatement");
        const body = breakIndex === -1 ? consequent : consequent.slice(0, breakIndex);
        const outcome = this.evaluateBlock(body, switchContext, false);
        if (outcome.returned) return outcome;
        if (breakIndex !== -1) return COMPLETES;
      }
      return COMPLETES;
    };
    if (discriminant.kind === "primitive" && caseValues.every((value) => value === null || value.kind === "primitive")) {
      let matchIndex = caseValues.findIndex(
        (value) => value !== null && value.kind === "primitive" && Object.is(value.value, discriminant.value),
      );
      if (matchIndex === -1) matchIndex = statement.cases.findIndex((switchCase) => switchCase.test === null);
      if (matchIndex === -1) return this.evaluateStatements(statements, continueIndex, context);
      const outcome = runFrom(matchIndex, context);
      if (outcome.returned) return outcome;
      return this.evaluateStatements(statements, continueIndex, context);
    }
    const hasDefault = statement.cases.some((switchCase) => switchCase.test === null);
    const branches = statement.cases.map(
      (_, caseIndex) => (pathContext: EvaluationContext) => runFrom(caseIndex, pathContext),
    );
    if (!hasDefault) branches.push(() => COMPLETES);
    return this.forkPaths(branches, statements, continueIndex, context, `switch (${describeValue(discriminant)})`, location);
  }

  private evaluateJsxName(name: JSXElementName | JSXMemberExpressionObject, context: EvaluationContext): StaticValue {
    switch (name.type) {
      case "JSXIdentifier":
        if (/^[a-z]/.test(name.name)) return primitiveValue(name.name);
        return this.lookupIdentifier(name.name, context);
      case "JSXNamespacedName":
        return primitiveValue(`${name.namespace.name}:${name.name.name}`);
      case "JSXMemberExpression": {
        const object = this.evaluateJsxName(name.object, context);
        return this.getProperty(object, name.property.name, context, this.locate(context.module, name));
      }
    }
  }

  private describeJsxName(name: JSXElementName | JSXMemberExpressionObject): string {
    switch (name.type) {
      case "JSXIdentifier":
        return name.name;
      case "JSXNamespacedName":
        return `${name.namespace.name}:${name.name.name}`;
      case "JSXMemberExpression":
        return `${this.describeJsxName(name.object)}.${name.property.name}`;
    }
  }

  private evaluateJsxAttributes(
    attributes: JSXAttributeItem[],
    context: EvaluationContext,
  ): { props: StaticObjectValue; key: StaticValue | null } {
    const entries: StaticObjectEntry[] = [];
    let key: StaticValue | null = null;
    for (const attribute of attributes) {
      if (attribute.type === "JSXSpreadAttribute") {
        entries.push({ kind: "spread", value: this.evaluateExpression(attribute.argument, context) });
        continue;
      }
      const name =
        attribute.name.type === "JSXIdentifier"
          ? attribute.name.name
          : `${attribute.name.namespace.name}:${attribute.name.name.name}`;
      let value: StaticValue;
      if (attribute.value === null) {
        value = TRUE_VALUE;
      } else if (attribute.value.type === "Literal") {
        value = primitiveValue(attribute.value.value);
      } else if (attribute.value.type === "JSXExpressionContainer") {
        value =
          attribute.value.expression.type === "JSXEmptyExpression"
            ? UNDEFINED_VALUE
            : this.evaluateExpression(attribute.value.expression, context, name);
      } else {
        value = this.evaluateExpression(attribute.value, context, name);
      }
      if (name === "key") {
        key = value;
        continue;
      }
      entries.push({ kind: "property", key: name, value });
    }
    return { props: objectValue(entries), key };
  }

  evaluateJsxChildren(children: JSXChild[], context: EvaluationContext): StaticValue[] {
    const values: StaticValue[] = [];
    for (const child of children) {
      switch (child.type) {
        case "JSXText": {
          const text = cleanJsxText(child.value);
          if (text) values.push(primitiveValue(text));
          break;
        }
        case "JSXExpressionContainer":
          if (child.expression.type !== "JSXEmptyExpression") {
            values.push(this.evaluateExpression(child.expression, context));
          }
          break;
        case "JSXSpreadChild": {
          const spread = this.evaluateExpression(child.expression, context);
          if (spread.kind === "list") values.push(...spread.items);
          else values.push(unknownValue("spread child"));
          break;
        }
        case "JSXElement":
          values.push(this.evaluateJsxElement(child, context));
          break;
        case "JSXFragment":
          values.push(this.evaluateJsxFragment(child, context));
          break;
      }
    }
    return values;
  }

  createElement(
    type: StaticValue,
    props: StaticObjectValue,
    key: StaticValue | null,
    children: StaticValue[],
    location: SourceLocation | null,
    nameHint: string | null,
  ): StaticElementValue {
    if (children.length === 1) {
      props.entries.push({ kind: "property", key: "children", value: children[0] });
    } else if (children.length > 1) {
      props.entries.push({ kind: "property", key: "children", value: listValue(children) });
    }
    return { kind: "element", type: toElementType(type, nameHint), key, props, location };
  }

  private evaluateJsxElement(node: JSXElement, context: EvaluationContext): StaticValue {
    const type = this.evaluateJsxName(node.openingElement.name, context);
    const { props, key } = this.evaluateJsxAttributes(node.openingElement.attributes, context);
    const children = this.evaluateJsxChildren(node.children, context);
    return this.createElement(
      type,
      props,
      key,
      children,
      this.locate(context.module, node),
      this.describeJsxName(node.openingElement.name),
    );
  }

  private evaluateJsxFragment(node: JSXFragment, context: EvaluationContext): StaticValue {
    const children = this.evaluateJsxChildren(node.children, context);
    return this.createElement(
      { kind: "react-api", api: "Fragment" },
      objectValue(),
      null,
      children,
      this.locate(context.module, node),
      "Fragment",
    );
  }
}

interface ScopeSnapshot {
  scope: Scope;
  bindings: Map<string, StaticValue>;
}

const snapshotScopes = (scope: Scope): ScopeSnapshot[] => {
  const snapshots: ScopeSnapshot[] = [];
  let current: Scope | null = scope;
  while (current && current.parent) {
    snapshots.push({ scope: current, bindings: new Map(current.bindings) });
    current = current.parent;
  }
  return snapshots;
};

const restoreScopes = (snapshots: ScopeSnapshot[]): void => {
  for (const snapshot of snapshots) {
    snapshot.scope.bindings.clear();
    for (const [name, value] of snapshot.bindings) snapshot.scope.bindings.set(name, value);
  }
};

const computeBinary = (
  operator: BinaryExpression["operator"],
  left: StaticPrimitive,
  right: StaticPrimitive,
): StaticValue | undefined => {
  switch (operator) {
    case "===":
      return primitiveValue(left === right);
    case "!==":
      return primitiveValue(left !== right);
    case "==":
      // eslint-disable-next-line eqeqeq
      return primitiveValue(left == right);
    case "!=":
      // eslint-disable-next-line eqeqeq
      return primitiveValue(left != right);
    default:
      break;
  }
  if (typeof left === "bigint" || typeof right === "bigint") return undefined;
  if (typeof left === "string" || typeof right === "string") {
    if (operator === "+") return primitiveValue(String(left) + String(right));
  }
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  switch (operator) {
    case "+":
      return primitiveValue(leftNumber + rightNumber);
    case "-":
      return primitiveValue(leftNumber - rightNumber);
    case "*":
      return primitiveValue(leftNumber * rightNumber);
    case "/":
      return primitiveValue(leftNumber / rightNumber);
    case "%":
      return primitiveValue(leftNumber % rightNumber);
    case "**":
      return primitiveValue(leftNumber ** rightNumber);
    case "<":
      return primitiveValue(leftNumber < rightNumber);
    case "<=":
      return primitiveValue(leftNumber <= rightNumber);
    case ">":
      return primitiveValue(leftNumber > rightNumber);
    case ">=":
      return primitiveValue(leftNumber >= rightNumber);
    default:
      return undefined;
  }
};

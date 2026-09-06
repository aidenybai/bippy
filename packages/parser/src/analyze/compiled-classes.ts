import type {
  Argument,
  CallExpression,
  Expression,
  Function as FunctionNode,
  ObjectExpression,
  Statement,
} from "@oxc-project/types";
import {
  getFunctionStatements,
  getMemberChain,
  isFunctionLike,
  isStringLiteral,
  unwrapExpression,
} from "../module/ast.js";
import { defineClassComponent } from "./components.js";
import type { EvaluationContext, Interpreter } from "./interpreter.js";
import { bindParameters } from "./patterns.js";
import { createScope, declareVariable } from "./scope.js";
import type { ClassMember, StaticValue } from "./values.js";

/**
 * A class as Babel and TypeScript lower it for targets without class
 * syntax: a wrapper called with the base class that declares the
 * constructor as a function, attaches members to its prototype and
 * returns it.
 */
export interface CompiledClass {
  name: string;
  wrapper: FunctionNode;
  members: ClassMember[];
  /** Wrapper statements that are not members: helper calls and variables the members close over. */
  setup: Statement[];
}

interface MemberTarget {
  key: string;
  isStatic: boolean;
}

interface MemberCollector {
  className: string;
  /** `_proto` in `var _proto = X.prototype`. */
  prototypeAliases: Set<string>;
  members: ClassMember[];
}

/** The `key`, `value` and `get` of a property descriptor written as an object literal. */
interface Descriptor {
  key: string | null;
  value: Expression | null;
  getter: Expression | null;
}

const getReturnedName = (statements: Statement[]): string | null => {
  const last = statements.at(-1);
  if (last?.type !== "ReturnStatement" || !last.argument) return null;
  const returned = unwrapExpression(last.argument);
  return returned.type === "Identifier" ? returned.name : null;
};

const toMember = (target: MemberTarget, descriptor: Descriptor): ClassMember => {
  const { key, isStatic } = target;
  if (isFunctionLike(descriptor.getter)) return { key, isStatic, kind: "getter", fn: descriptor.getter };
  if (isFunctionLike(descriptor.value)) return { key, isStatic, kind: "method", fn: descriptor.value };
  return { key, isStatic, kind: "field", value: descriptor.value };
};

const readDescriptor = (object: ObjectExpression): Descriptor | null => {
  const descriptor: Descriptor = { key: null, value: null, getter: null };
  for (const property of object.properties) {
    if (property.type !== "Property" || property.computed || property.key.type !== "Identifier") {
      return null;
    }
    switch (property.key.name) {
      case "key":
        if (!isStringLiteral(property.value)) return null;
        descriptor.key = property.value.value;
        break;
      case "value":
        descriptor.value = property.value;
        break;
      case "get":
        descriptor.getter = property.value;
        break;
    }
  }
  return descriptor;
};

/** `[{ key: "render", value: function () {} }, …]`, as `_createClass` receives; `[]` when absent. */
const getDescriptorMembers = (
  argument: Argument | undefined,
  isStatic: boolean,
): ClassMember[] | null => {
  if (argument === undefined) return [];
  if (argument.type !== "ArrayExpression") return null;
  const members: ClassMember[] = [];
  for (const element of argument.elements) {
    if (element?.type !== "ObjectExpression") return null;
    const descriptor = readDescriptor(element);
    if (descriptor?.key == null) return null;
    members.push(toMember({ key: descriptor.key, isStatic }, descriptor));
  }
  return members;
};

/** Which member a reference names: `X.prototype.m` and `_proto.m` are instance members, `X.m` a static. */
const getMemberTarget = (reference: Expression, collector: MemberCollector): MemberTarget | null => {
  const chain = getMemberChain(reference);
  if (!chain) return null;
  const [root, ...path] = chain;
  if (root === collector.className) {
    if (path.length === 2 && path[0] === "prototype") return { key: path[1], isStatic: false };
    if (path.length === 1 && path[0] !== "prototype") return { key: path[0], isStatic: true };
    return null;
  }
  if (collector.prototypeAliases.has(root) && path.length === 1) {
    return { key: path[0], isStatic: false };
  }
  return null;
};

const isPrototypeAliasDeclaration = (statement: Statement, collector: MemberCollector): boolean => {
  if (statement.type !== "VariableDeclaration" || statement.declarations.length !== 1) return false;
  const [declarator] = statement.declarations;
  if (declarator.id.type !== "Identifier" || !declarator.init) return false;
  const chain = getMemberChain(declarator.init);
  if (chain?.length !== 2 || chain[0] !== collector.className || chain[1] !== "prototype") {
    return false;
  }
  collector.prototypeAliases.add(declarator.id.name);
  return true;
};

/**
 * Records the member a wrapper statement attaches, if any: a prototype or
 * static assignment, `Object.defineProperty` on the class or its prototype,
 * or a `_createClass(X, protoProps, staticProps)` descriptor list.
 */
const collectMemberStatement = (statement: Statement, collector: MemberCollector): boolean => {
  if (isPrototypeAliasDeclaration(statement, collector)) return true;
  if (statement.type !== "ExpressionStatement") return false;
  const expression = unwrapExpression(statement.expression);
  if (expression.type === "AssignmentExpression") {
    if (expression.operator !== "=" || expression.left.type !== "MemberExpression") return false;
    const target = getMemberTarget(expression.left, collector);
    if (!target) return false;
    collector.members.push(toMember(target, { key: null, value: expression.right, getter: null }));
    return true;
  }
  if (expression.type !== "CallExpression") return false;
  const [receiver, second, third] = expression.arguments;
  if (getMemberChain(expression.callee)?.join(".") === "Object.defineProperty") {
    if (!receiver || receiver.type === "SpreadElement" || !isStringLiteral(second)) return false;
    const descriptor = third?.type === "ObjectExpression" ? readDescriptor(third) : null;
    const chain = getMemberChain(receiver);
    if (!descriptor || !chain) return false;
    const isClass = chain.length === 1 && chain[0] === collector.className;
    if (!isClass && !isPrototypeChain(chain, collector)) return false;
    collector.members.push(toMember({ key: second.value, isStatic: isClass }, descriptor));
    return true;
  }
  if (receiver?.type !== "Identifier" || receiver.name !== collector.className) return false;
  if (second === undefined) return false;
  const instanceMembers = getDescriptorMembers(second, false);
  const staticMembers = getDescriptorMembers(third, true);
  if (!instanceMembers || !staticMembers) return false;
  collector.members.push(...instanceMembers, ...staticMembers);
  return true;
};

/** `X.prototype` or an alias of it. */
const isPrototypeChain = (chain: string[], collector: MemberCollector): boolean =>
  (chain.length === 2 && chain[0] === collector.className && chain[1] === "prototype") ||
  (chain.length === 1 && collector.prototypeAliases.has(chain[0]));

/**
 * Recognises `(function (_Base) { …; function X() {} …; return X; })(Base)`
 * with at least one member attached to `X` besides its constructor.
 */
export const getCompiledClass = (call: CallExpression): CompiledClass | null => {
  const wrapper = unwrapExpression(call.callee);
  if (wrapper.type !== "FunctionExpression") return null;
  if (wrapper.params.length !== 1 || call.arguments.length !== 1) return null;
  const statements = getFunctionStatements(wrapper);
  if (!statements) return null;
  const name = getReturnedName(statements);
  if (name === null) return null;
  const constructorFn = statements.find(
    (statement) => statement.type === "FunctionDeclaration" && statement.id?.name === name,
  );
  if (!constructorFn || constructorFn.type !== "FunctionDeclaration") return null;
  const collector: MemberCollector = {
    className: name,
    prototypeAliases: new Set(),
    members: [{ key: "constructor", isStatic: false, kind: "constructor", fn: constructorFn }],
  };
  const setup: Statement[] = [];
  for (const statement of statements.slice(0, -1)) {
    if (statement === constructorFn || collectMemberStatement(statement, collector)) continue;
    setup.push(statement);
  }
  if (collector.members.length === 1) return null;
  return { name, wrapper, members: collector.members, setup };
};

/**
 * The wrapper runs once: its parameter is the base class, the constructor is
 * hoisted as the class itself so helpers such as `_createSuper(X)` see it,
 * and the remaining setup runs for whatever the members close over.
 */
export const evaluateCompiledClass = (
  interpreter: Interpreter,
  compiled: CompiledClass,
  superValue: StaticValue,
  context: EvaluationContext,
): StaticValue => {
  const scope = createScope(context.scope);
  const wrapperContext: EvaluationContext = { ...context, scope };
  bindParameters(interpreter, compiled.wrapper.params, [superValue], wrapperContext);
  const value = defineClassComponent(
    interpreter,
    {
      name: compiled.name,
      module: context.module,
      scope,
      members: compiled.members,
      superValue,
      span: compiled.wrapper,
    },
    wrapperContext,
  );
  declareVariable(scope, compiled.name, value);
  interpreter.evaluateStatements(compiled.setup, wrapperContext);
  return value;
};

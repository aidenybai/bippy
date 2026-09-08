import type {
  Argument,
  AssignmentExpression,
  CallExpression,
  Expression,
  Function as FunctionNode,
  ObjectExpression,
  Statement,
} from "oxc-parser";
import {
  getFunctionStatements,
  getMemberChain,
  isFunctionLikeExpression,
  isStringLiteralNode,
  unwrapExpression,
} from "../parse/ast-walk.js";
import type { ClassMember } from "../types.js";

/**
 * A class as Babel and TypeScript lower it for targets without class syntax:
 * `(function (_Base) { …; function X() {} …; return X; })(Base)`, where the
 * wrapper declares the constructor as a function, attaches members to its
 * prototype (directly, through a `_proto` alias, `Object.defineProperty` or a
 * `_createClass` descriptor list) and returns it.
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
  /** Variables the wrapper assigns the constructor to, as in `(t = X).prototype = …`. */
  classAliases: Set<string>;
  prototypeAliases: Set<string>;
  members: ClassMember[];
}

/** The returned constructor name plus the expressions a `return a = b, …, X` sequence runs first. */
interface ReturnedClass {
  name: string;
  trailing: Expression[];
}

interface PropertyDescriptor {
  key: string | null;
  value: Expression | null;
  getter: Expression | null;
}

const getReturnedClass = (statements: Statement[]): ReturnedClass | null => {
  const last = statements.at(-1);
  if (last?.type !== "ReturnStatement" || !last.argument) return null;
  const returned = unwrapExpression(last.argument);
  const sequence = returned.type === "SequenceExpression" ? returned.expressions : [returned];
  const named = unwrapExpression(sequence.at(-1) ?? returned);
  return named.type === "Identifier" ? { name: named.name, trailing: sequence.slice(0, -1) } : null;
};

const toMember = (target: MemberTarget, descriptor: PropertyDescriptor): ClassMember => {
  const { key, isStatic } = target;
  if (isFunctionLikeExpression(descriptor.getter)) {
    return { key, isStatic, kind: "getter", functionNode: descriptor.getter };
  }
  if (isFunctionLikeExpression(descriptor.value)) {
    return { key, isStatic, kind: "method", functionNode: descriptor.value };
  }
  return { key, isStatic, kind: "field", value: descriptor.value };
};

const readDescriptor = (object: ObjectExpression): PropertyDescriptor | null => {
  const descriptor: PropertyDescriptor = { key: null, value: null, getter: null };
  for (const property of object.properties) {
    if (property.type !== "Property" || property.computed || property.key.type !== "Identifier") {
      return null;
    }
    switch (property.key.name) {
      case "key":
        if (!isStringLiteralNode(property.value)) return null;
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
    if (descriptor === null || descriptor.key === null) return null;
    members.push(toMember({ key: descriptor.key, isStatic }, descriptor));
  }
  return members;
};

/** `alias = X` naming the class (also inline, as `(t = X).prototype`): records the alias and returns true. */
const collectClassAlias = (expression: Expression, collector: MemberCollector): boolean => {
  const unwrapped = unwrapExpression(expression);
  if (
    unwrapped.type !== "AssignmentExpression" ||
    unwrapped.operator !== "=" ||
    unwrapped.left.type !== "Identifier" ||
    unwrapped.right.type !== "Identifier" ||
    !collector.classAliases.has(unwrapped.right.name)
  )
    return false;
  collector.classAliases.add(unwrapped.left.name);
  return true;
};

/** A member chain rooted at the class, normalized to the class name. */
const getClassChain = (reference: Expression, collector: MemberCollector): string[] | null => {
  const unwrapped = unwrapExpression(reference);
  if (unwrapped.type === "MemberExpression" && !unwrapped.computed) {
    if (unwrapped.property.type !== "Identifier") return null;
    const objectChain = getClassChain(unwrapped.object, collector);
    return objectChain ? [...objectChain, unwrapped.property.name] : null;
  }
  if (collectClassAlias(unwrapped, collector)) return [collector.className];
  const chain = getMemberChain(unwrapped);
  if (chain?.length === 1 && collector.classAliases.has(chain[0])) return [collector.className];
  return chain;
};

const isPrototypeChain = (chain: string[], collector: MemberCollector): boolean =>
  (chain.length === 2 && chain[0] === collector.className && chain[1] === "prototype") ||
  (chain.length === 1 && collector.prototypeAliases.has(chain[0]));

const getMemberTarget = (
  reference: Expression,
  collector: MemberCollector,
): MemberTarget | null => {
  const chain = getClassChain(reference, collector);
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

/** `X.prototype = Object.create(Base.prototype)` / `X.prototype.constructor = X`: inlined inheritance wiring. */
const isInheritanceWiring = (
  assignment: AssignmentExpression,
  collector: MemberCollector,
): boolean => {
  if (assignment.left.type !== "MemberExpression") return false;
  const chain = getClassChain(assignment.left, collector);
  if (chain?.[0] !== collector.className) return false;
  const right = unwrapExpression(assignment.right);
  if (chain.length === 2 && chain[1] === "prototype") return right.type === "CallExpression";
  return (
    chain.length === 3 &&
    chain[1] === "prototype" &&
    chain[2] === "constructor" &&
    right.type === "Identifier" &&
    collector.classAliases.has(right.name)
  );
};

const isPrototypeAliasDeclaration = (statement: Statement, collector: MemberCollector): boolean => {
  if (statement.type !== "VariableDeclaration" || statement.declarations.length !== 1) return false;
  const [declarator] = statement.declarations;
  if (declarator.id.type !== "Identifier" || !declarator.init) return false;
  const chain = getClassChain(declarator.init, collector);
  if (!chain || !isPrototypeChain(chain, collector) || chain.length !== 2) return false;
  collector.prototypeAliases.add(declarator.id.name);
  return true;
};

const collectMemberExpression = (expression: Expression, collector: MemberCollector): boolean => {
  if (collectClassAlias(expression, collector)) return true;
  if (expression.type === "AssignmentExpression") {
    if (expression.operator !== "=" || expression.left.type !== "MemberExpression") return false;
    if (isInheritanceWiring(expression, collector)) return true;
    const target = getMemberTarget(expression.left, collector);
    if (!target) return false;
    collector.members.push(toMember(target, { key: null, value: expression.right, getter: null }));
    return true;
  }
  if (expression.type !== "CallExpression") return false;
  const [receiver, second, third] = expression.arguments;
  if (getMemberChain(expression.callee)?.join(".") === "Object.defineProperty") {
    if (!receiver || receiver.type === "SpreadElement" || !isStringLiteralNode(second)) {
      return false;
    }
    const descriptor = third?.type === "ObjectExpression" ? readDescriptor(third) : null;
    const chain = getClassChain(receiver, collector);
    if (!descriptor || !chain) return false;
    const isClass = chain.length === 1 && chain[0] === collector.className;
    if (!isClass && !isPrototypeChain(chain, collector)) return false;
    collector.members.push(toMember({ key: second.value, isStatic: isClass }, descriptor));
    return true;
  }
  if (receiver?.type !== "Identifier" || !collector.classAliases.has(receiver.name)) return false;
  if (second === undefined) return false;
  const instanceMembers = getDescriptorMembers(second, false);
  const staticMembers = getDescriptorMembers(third, true);
  if (!instanceMembers || !staticMembers) return false;
  collector.members.push(...instanceMembers, ...staticMembers);
  return true;
};

const collectMemberStatement = (statement: Statement, collector: MemberCollector): boolean =>
  isPrototypeAliasDeclaration(statement, collector) ||
  (statement.type === "ExpressionStatement" &&
    collectMemberExpression(unwrapExpression(statement.expression), collector));

const toExpressionStatement = (expression: Expression): Statement => ({
  type: "ExpressionStatement",
  expression,
  start: expression.start,
  end: expression.end,
});

/** Recognizes a lowered class wrapper call with at least one member besides the constructor. */
export const getCompiledClass = (call: CallExpression): CompiledClass | null => {
  const wrapper = unwrapExpression(call.callee);
  if (wrapper.type !== "FunctionExpression") return null;
  if (wrapper.params.length !== 1 || call.arguments.length !== 1) return null;
  const statements = getFunctionStatements(wrapper);
  if (!statements) return null;
  const returned = getReturnedClass(statements);
  if (returned === null) return null;
  const { name } = returned;
  const constructorDeclaration = statements.find(
    (statement) => statement.type === "FunctionDeclaration" && statement.id?.name === name,
  );
  if (constructorDeclaration?.type !== "FunctionDeclaration") return null;
  const collector: MemberCollector = {
    className: name,
    classAliases: new Set([name]),
    prototypeAliases: new Set(),
    members: [
      {
        key: "constructor",
        isStatic: false,
        kind: "constructor",
        functionNode: constructorDeclaration,
      },
    ],
  };
  const setup: Statement[] = [];
  const body = [...statements.slice(0, -1), ...returned.trailing.map(toExpressionStatement)];
  for (const statement of body) {
    if (statement === constructorDeclaration || collectMemberStatement(statement, collector))
      continue;
    setup.push(statement);
  }
  if (collector.members.length === 1) return null;
  return { name, wrapper, members: collector.members, setup };
};

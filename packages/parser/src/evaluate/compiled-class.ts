import type {
  Argument,
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
  prototypeAliases: Set<string>;
  members: ClassMember[];
}

interface PropertyDescriptor {
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

const isPrototypeChain = (chain: string[], collector: MemberCollector): boolean =>
  (chain.length === 2 && chain[0] === collector.className && chain[1] === "prototype") ||
  (chain.length === 1 && collector.prototypeAliases.has(chain[0]));

const getMemberTarget = (
  reference: Expression,
  collector: MemberCollector,
): MemberTarget | null => {
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
  if (!chain || !isPrototypeChain(chain, collector) || chain.length !== 2) return false;
  collector.prototypeAliases.add(declarator.id.name);
  return true;
};

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
    if (!receiver || receiver.type === "SpreadElement" || !isStringLiteralNode(second)) {
      return false;
    }
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

/** Recognizes a lowered class wrapper call with at least one member besides the constructor. */
export const getCompiledClass = (call: CallExpression): CompiledClass | null => {
  const wrapper = unwrapExpression(call.callee);
  if (wrapper.type !== "FunctionExpression") return null;
  if (wrapper.params.length !== 1 || call.arguments.length !== 1) return null;
  const statements = getFunctionStatements(wrapper);
  if (!statements) return null;
  const name = getReturnedName(statements);
  if (name === null) return null;
  const constructorDeclaration = statements.find(
    (statement) => statement.type === "FunctionDeclaration" && statement.id?.name === name,
  );
  if (constructorDeclaration?.type !== "FunctionDeclaration") return null;
  const collector: MemberCollector = {
    className: name,
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
  for (const statement of statements.slice(0, -1)) {
    if (statement === constructorDeclaration || collectMemberStatement(statement, collector))
      continue;
    setup.push(statement);
  }
  if (collector.members.length === 1) return null;
  return { name, wrapper, members: collector.members, setup };
};

import { traverse, types } from "@babel/core";
import type { NodePath } from "@babel/core";

const COMPONENT_BASE_CLASSES = new Set(["Component", "PureComponent"]);
const MOUNT_METHOD = "componentDidMount";
const UNMOUNT_METHOD = "componentWillUnmount";
const RENDER_METHOD = "render";
const STATE_NAME = "state";
const BINDING_METHODS = new Set(["bind", "call", "apply"]);
const SET_STATE_NAME = "setState";
const PROPS_NAME = "props";
const HOOK_NAMES = ["useState", "useLayoutEffect"];
const IGNORED_STATICS = new Set(["displayName"]);
const SYNCHRONOUS_CALLBACK_METHODS = new Set([
  "map",
  "filter",
  "forEach",
  "some",
  "every",
  "find",
  "findIndex",
  "flatMap",
  "reduce",
  "sort",
]);
const UNSUPPORTED_LIFECYCLES = new Set([
  "componentDidUpdate",
  "shouldComponentUpdate",
  "getSnapshotBeforeUpdate",
  "componentDidCatch",
  "componentWillMount",
  "componentWillReceiveProps",
  "componentWillUpdate",
  "UNSAFE_componentWillMount",
  "UNSAFE_componentWillReceiveProps",
  "UNSAFE_componentWillUpdate",
  "getChildContext",
]);

type ClassMember = types.ClassBody["body"][number];

type MethodValue = types.ClassMethod | types.ArrowFunctionExpression | types.FunctionExpression;

interface ClassParts {
  initialState: types.Expression | null;
  stateLoc: types.SourceLocation | null;
  stateNameLoc: types.SourceLocation | null;
  methods: Map<string, MethodValue>;
  boundNames: Set<string>;
  render: types.ClassMethod | null;
}

export const isComponentBaseClass = (superClass: types.Expression | null | undefined): boolean => {
  if (types.isIdentifier(superClass)) return COMPONENT_BASE_CLASSES.has(superClass.name);
  return (
    types.isMemberExpression(superClass) &&
    types.isIdentifier(superClass.property) &&
    COMPONENT_BASE_CLASSES.has(superClass.property.name)
  );
};

const getMemberName = (member: ClassMember): string | null => {
  if (!("key" in member) || ("computed" in member && member.computed)) return null;
  return types.isIdentifier(member.key) ? member.key.name : null;
};

const isThisMember = (node: types.Node, name: string): boolean =>
  types.isMemberExpression(node) &&
  types.isThisExpression(node.object) &&
  !node.computed &&
  types.isIdentifier(node.property, { name });

const isBindCall = (node: types.Expression): boolean =>
  types.isCallExpression(node) &&
  types.isMemberExpression(node.callee) &&
  types.isIdentifier(node.callee.property, { name: "bind" }) &&
  node.arguments.length === 1 &&
  types.isThisExpression(node.arguments[0]);

const getInlineBoundName = (node: types.CallExpression): string | null => {
  if (!isBindCall(node) || !types.isMemberExpression(node.callee)) return null;
  const target = node.callee.object;
  return types.isMemberExpression(target) &&
    types.isThisExpression(target.object) &&
    !target.computed &&
    types.isIdentifier(target.property)
    ? target.property.name
    : null;
};

const readConstructor = (method: types.ClassMethod, parts: ClassParts): boolean =>
  method.params.every((param) => types.isIdentifier(param, { name: PROPS_NAME })) &&
  method.body.body.every((statement) => {
    if (!types.isExpressionStatement(statement)) return false;
    const { expression } = statement;
    if (types.isCallExpression(expression) && types.isSuper(expression.callee)) return true;
    if (!types.isAssignmentExpression(expression, { operator: "=" })) return false;
    if (isThisMember(expression.left, STATE_NAME)) {
      parts.initialState = expression.right;
      parts.stateLoc = expression.loc ?? null;
      parts.stateNameLoc = expression.left.loc ?? null;
      return true;
    }
    const name =
      types.isMemberExpression(expression.left) &&
      types.isThisExpression(expression.left.object) &&
      types.isIdentifier(expression.left.property)
        ? expression.left.property.name
        : null;
    if (!name || !isBindCall(expression.right)) return false;
    parts.boundNames.add(name);
    return true;
  });

const readMember = (member: ClassMember, parts: ClassParts): boolean => {
  const name = getMemberName(member);
  if (types.isClassMethod(member) && member.kind === "constructor")
    return readConstructor(member, parts);
  if (!name || UNSUPPORTED_LIFECYCLES.has(name)) return false;
  if ("static" in member && member.static) return IGNORED_STATICS.has(name);
  if (types.isClassMethod(member)) {
    if (member.kind !== "method") return false;
    if (name === RENDER_METHOD) parts.render = member;
    if (name !== RENDER_METHOD) parts.methods.set(name, member);
    return true;
  }
  if (!types.isClassProperty(member)) return false;
  if (!member.value) return member.declare === true || name === STATE_NAME || name === PROPS_NAME;
  if (name === STATE_NAME) {
    parts.initialState = member.value;
    parts.stateLoc = member.loc ?? null;
    parts.stateNameLoc = member.key.loc ?? null;
    return true;
  }
  if (!types.isArrowFunctionExpression(member.value) && !types.isFunctionExpression(member.value))
    return false;
  parts.methods.set(name, member.value);
  return true;
};

const readClassParts = (node: types.Class): ClassParts | null => {
  const parts: ClassParts = {
    initialState: null,
    stateLoc: null,
    stateNameLoc: null,
    methods: new Map(),
    boundNames: new Set(),
    render: null,
  };
  if (!node.body.body.every((member) => readMember(member, parts))) return null;
  if (!parts.render || parts.render.params.length > 0) return null;
  if ([...parts.boundNames].some((name) => !parts.methods.has(name))) return null;
  const mount = parts.methods.get(MOUNT_METHOD);
  if (mount && mount.params.length > 0) return null;
  const unmount = parts.methods.get(UNMOUNT_METHOD);
  if (unmount && unmount.params.length > 0) return null;
  return parts;
};

const isInsideNode = (path: NodePath, node: types.Node): boolean =>
  path.findParent((parent) => parent.node === node) !== null;

const getOwnerMember = (path: NodePath, classBody: types.ClassBody): NodePath | null =>
  path.findParent(
    (parent) =>
      (parent.isFunction() && !parent.isArrowFunctionExpression()) ||
      (parent.isClassProperty() && parent.parent === classBody),
  );

const isDeferredFunction = (path: NodePath<types.Function>): boolean => {
  if (path.node.async || path.node.generator) return true;
  const call = path.parentPath;
  if (!call.isCallExpression() || call.node.callee === path.node) return false;
  const { callee } = call.node;
  return !(
    types.isMemberExpression(callee) &&
    types.isIdentifier(callee.property) &&
    SYNCHRONOUS_CALLBACK_METHODS.has(callee.property.name)
  );
};

const isReadLater = (path: NodePath, owner: NodePath): boolean => {
  const deferred = path.findParent(
    (parent) => parent.node === owner.node || (parent.isFunction() && isDeferredFunction(parent)),
  );
  return deferred !== null && deferred.node !== owner.node;
};

const isClassMember = (path: NodePath | null, classBody: types.ClassBody): boolean =>
  path !== null &&
  (path.parent === classBody ||
    (path.parentPath?.isClassProperty() === true && path.parentPath.parent === classBody));

const usesThis = (value: MethodValue): boolean => {
  let isFound = false;
  types.traverseFast(value.body, (node) => {
    if (types.isThisExpression(node)) isFound = true;
  });
  return isFound;
};

const isUnboundMethodValue = (
  member: NodePath<types.MemberExpression>,
  parts: ClassParts,
): boolean => {
  const name = types.isIdentifier(member.node.property) ? member.node.property.name : null;
  const value = name === null ? undefined : parts.methods.get(name);
  if (!name || !value || types.isArrowFunctionExpression(value) || parts.boundNames.has(name))
    return false;
  const { parent } = member;
  const isCalled = types.isCallExpression(parent) && parent.callee === member.node;
  const isBound =
    types.isMemberExpression(parent) &&
    parent.object === member.node &&
    types.isIdentifier(parent.property) &&
    BINDING_METHODS.has(parent.property.name);
  return !isCalled && !isBound && usesThis(value);
};

const isNullishNode = (node: types.Expression): boolean =>
  types.isNullLiteral(node) || types.isIdentifier(node, { name: "undefined" });

const mergeUpdaterResult = (
  result: types.Expression,
  previous: types.Identifier,
): types.Expression | null => {
  if (types.isConditionalExpression(result)) {
    const consequent = mergeUpdaterResult(result.consequent, previous);
    const alternate = mergeUpdaterResult(result.alternate, previous);
    return consequent && alternate
      ? types.conditionalExpression(result.test, consequent, alternate)
      : null;
  }
  if (isNullishNode(result)) return previous;
  return types.isObjectExpression(result)
    ? types.objectExpression([types.spreadElement(previous), ...result.properties])
    : null;
};

const createMergedState = (
  argument: types.Expression,
  previous: types.Identifier,
  props: types.Identifier,
): types.Expression => {
  if (types.isObjectExpression(argument))
    return types.objectExpression([types.spreadElement(previous), ...argument.properties]);
  const isUpdater =
    types.isArrowFunctionExpression(argument) || types.isFunctionExpression(argument);
  const [updaterPrevious] = isUpdater ? argument.params : [];
  const mergedResult =
    isUpdater &&
    types.isArrowFunctionExpression(argument) &&
    types.isIdentifier(updaterPrevious) &&
    types.isExpression(argument.body)
      ? mergeUpdaterResult(argument.body, updaterPrevious)
      : null;
  if (mergedResult && types.isArrowFunctionExpression(argument))
    return types.callExpression(types.arrowFunctionExpression(argument.params, mergedResult), [
      previous,
      props,
    ]);
  const partial = isUpdater ? types.callExpression(argument, [previous, props]) : argument;
  return types.objectExpression([types.spreadElement(previous), types.spreadElement(partial)]);
};

const withLoc = <Node extends types.Node>(
  node: Node,
  loc: types.SourceLocation | null | undefined,
) => {
  node.loc = loc ?? null;
  return node;
};

const rewriteThis = (
  classPath: NodePath<types.Class>,
  parts: ClassParts,
  introducedNames: Set<string>,
  isApplied: boolean,
): { usesState: boolean } | null => {
  const classBody = classPath.node.body;
  const insertedNodes = new WeakSet<types.Node>();
  const insert = <Node extends types.Node>(node: Node): Node => {
    insertedNodes.add(node);
    return node;
  };
  let isLowerable = true;
  let usesState = false;
  const isShadowed = (path: NodePath, name: string): boolean => {
    const binding = path.scope.getBinding(name);
    return binding !== undefined && isInsideNode(binding.path, classBody);
  };
  classPath.get("body").traverse({
    CallExpression(path) {
      const name = getInlineBoundName(path.node);
      if (!name || !parts.methods.has(name) || isShadowed(path, name)) return;
      if (isApplied) path.replaceWith(insert(withLoc(types.identifier(name), path.node.loc)));
      path.skip();
    },
    ExpressionStatement(path) {
      const { expression } = path.node;
      const isConstructorStatement =
        path.parentPath.parentPath?.isClassMethod({ kind: "constructor" }) === true;
      if (!isConstructorStatement || !types.isAssignmentExpression(expression)) return;
      if (isBindCall(expression.right)) {
        path.skip();
        return;
      }
      path.get("expression.left").skip();
    },
    Identifier(path) {
      if (insertedNodes.has(path.node)) return;
      if (!introducedNames.has(path.node.name) || !path.isReferencedIdentifier()) return;
      if (!isShadowed(path, path.node.name)) isLowerable = false;
    },
    ThisExpression(path) {
      const { parent } = path;
      const isThisObject =
        types.isMemberExpression(parent) && parent.object === path.node && !parent.computed;
      if (!isThisObject || isApplied) isLowerable = false;
    },
    MemberExpression(member) {
      if (!isLowerable || !types.isThisExpression(member.node.object) || member.node.computed)
        return;
      const owner = getOwnerMember(member, classBody);
      const property = member.node.property;
      const name = types.isIdentifier(property) ? property.name : null;
      if (!isClassMember(owner, classBody) || !name || isShadowed(member, name)) {
        isLowerable = false;
        return;
      }
      if (name === SET_STATE_NAME) {
        const call = member.parentPath;
        const [argument] = call.isCallExpression() ? call.node.arguments : [];
        if (
          !call.isCallExpression() ||
          call.node.callee !== member.node ||
          call.node.arguments.length !== 1 ||
          !types.isExpression(argument)
        ) {
          isLowerable = false;
          return;
        }
        usesState = true;
        if (!isApplied) return;
        const previous = call.scope.generateUidIdentifier("previous");
        const updater = types.arrowFunctionExpression(
          [previous],
          createMergedState(argument, previous, insert(types.identifier(PROPS_NAME))),
        );
        member.replaceWith(insert(withLoc(types.identifier(SET_STATE_NAME), member.node.loc)));
        call.node.arguments = [withLoc(updater, argument.loc)];
        return;
      }
      if (name === STATE_NAME) usesState = true;
      const isInstanceRead = name === STATE_NAME || name === PROPS_NAME;
      const isOwnerDeferred = owner?.isFunction() === true && isDeferredFunction(owner);
      const isDeferred = owner !== null && (isOwnerDeferred || isReadLater(member, owner));
      if (isInstanceRead && !isApplied && isDeferred) {
        isLowerable = false;
        return;
      }
      if (!isInstanceRead && !introducedNames.has(name)) {
        isLowerable = false;
        return;
      }
      if (!isApplied && isUnboundMethodValue(member, parts)) {
        isLowerable = false;
        return;
      }
      if (isApplied) member.replaceWith(insert(withLoc(types.identifier(name), member.node.loc)));
    },
  });
  return isLowerable ? { usesState } : null;
};

const toBlock = (body: types.BlockStatement | types.Expression): types.BlockStatement =>
  types.isBlockStatement(body) ? body : types.blockStatement([types.returnStatement(body)]);

const createMethodDeclaration = (name: string, value: MethodValue): types.FunctionDeclaration => {
  const params = [...value.params].filter(
    (param): param is types.Identifier | types.Pattern | types.RestElement =>
      !types.isTSParameterProperty(param),
  );
  const declaration = types.functionDeclaration(
    withLoc(types.identifier(name), types.isClassMethod(value) ? value.key.loc : value.loc),
    params,
    toBlock(value.body),
    value.generator ?? false,
    value.async ?? false,
  );
  return withLoc(declaration, value.loc);
};

const hasReturn = (body: types.BlockStatement): boolean => {
  let isFound = false;
  types.traverseFast(body, (node) => {
    if (types.isReturnStatement(node)) isFound = true;
  });
  return isFound;
};

const createLifecycleEffect = (
  mount: MethodValue | undefined,
  unmount: MethodValue | undefined,
): types.Statement | null => {
  if (!mount && !unmount) return null;
  const mountBody = mount ? toBlock(mount.body) : types.blockStatement([]);
  if (unmount && mount && hasReturn(mountBody)) return null;
  const cleanup = unmount
    ? [types.returnStatement(types.arrowFunctionExpression([], toBlock(unmount.body)))]
    : [];
  const effect = types.arrowFunctionExpression(
    [],
    types.blockStatement([...mountBody.body, ...cleanup]),
  );
  return withLoc(
    types.expressionStatement(
      types.callExpression(types.identifier("useLayoutEffect"), [
        effect,
        types.arrayExpression([]),
      ]),
    ),
    (mount ?? unmount)?.loc,
  );
};

const hasForeignHook = (programPath: NodePath<types.Program>): boolean =>
  HOOK_NAMES.some((hookName) => {
    const specifier = programPath.scope.getBinding(hookName)?.path;
    if (!specifier) return false;
    return !(
      specifier.isImportSpecifier() &&
      types.isImportDeclaration(specifier.parent) &&
      specifier.parent.source.value === "react" &&
      types.isIdentifier(specifier.node.imported, { name: hookName })
    );
  });

const createComponentBody = (
  parts: ClassParts,
  render: types.ClassMethod,
  usesState: boolean,
): types.Statement[] | null => {
  const lifecycleMethods = [parts.methods.get(MOUNT_METHOD), parts.methods.get(UNMOUNT_METHOD)];
  const effect = createLifecycleEffect(lifecycleMethods[0], lifecycleMethods[1]);
  if (lifecycleMethods.some(Boolean) && !effect) return null;
  const stateDeclaration =
    usesState || parts.initialState
      ? withLoc(
          types.variableDeclaration("const", [
            types.variableDeclarator(
              types.arrayPattern([
                withLoc(types.identifier(STATE_NAME), parts.stateNameLoc),
                types.identifier(SET_STATE_NAME),
              ]),
              withLoc(
                types.callExpression(types.identifier("useState"), [
                  parts.initialState ?? types.nullLiteral(),
                ]),
                parts.stateLoc,
              ),
            ),
          ]),
          parts.stateLoc,
        )
      : null;
  const methods = [...parts.methods]
    .filter(([name]) => name !== MOUNT_METHOD && name !== UNMOUNT_METHOD)
    .map(([name, value]) => createMethodDeclaration(name, value));
  return [
    ...(stateDeclaration ? [stateDeclaration] : []),
    ...methods,
    ...(effect ? [effect] : []),
    ...render.body.body,
  ];
};

const lowerClass = (path: NodePath<types.Class>, name: string): boolean => {
  const parts = readClassParts(path.node);
  if (!parts?.render) return false;
  const { render } = parts;
  const introducedNames = new Set([
    STATE_NAME,
    SET_STATE_NAME,
    PROPS_NAME,
    ...parts.methods.keys(),
  ]);
  const checked = rewriteThis(path, parts, introducedNames, false);
  if (!checked || !createComponentBody(parts, render, checked.usesState)) return false;
  if (!rewriteThis(path, parts, introducedNames, true)) return false;
  const body = createComponentBody(parts, render, checked.usesState) ?? [];
  const params = [types.identifier(PROPS_NAME)];
  const block = types.blockStatement(body);
  const id = withLoc(types.identifier(name), path.node.id?.loc ?? path.node.loc);
  const lowered = path.isClassDeclaration()
    ? types.functionDeclaration(id, params, block)
    : types.functionExpression(id, params, block);
  if (path.isClassDeclaration()) path.parentPath.scope.removeBinding(name);
  path.replaceWith(withLoc(lowered, path.node.loc));
  return true;
};

const getClassName = (path: NodePath<types.Class>): string | null => {
  if (path.node.id) return path.node.id.name;
  const { parent } = path;
  return types.isVariableDeclarator(parent) && types.isIdentifier(parent.id)
    ? parent.id.name
    : null;
};

const importMissingHooks = (programPath: NodePath<types.Program>): void => {
  const missingHooks = HOOK_NAMES.filter((hookName) => !programPath.scope.hasBinding(hookName));
  if (missingHooks.length === 0) return;
  const specifiers = missingHooks.map((hookName) =>
    types.importSpecifier(types.identifier(hookName), types.identifier(hookName)),
  );
  programPath.unshiftContainer(
    "body",
    types.importDeclaration(specifiers, types.stringLiteral("react")),
  );
};

export const lowerClassComponents = (ast: types.File): void => {
  traverse(ast, {
    Program(programPath) {
      if (hasForeignHook(programPath)) return;
      let isLowered = false;
      programPath.traverse({
        Class(path) {
          const name = getClassName(path);
          if (name && isComponentBaseClass(path.node.superClass) && lowerClass(path, name))
            isLowered = true;
        },
      });
      if (isLowered) importMissingHooks(programPath);
    },
  });
};

import type {
  CallExpression,
  Expression,
  Node,
  ObjectExpression,
  Program,
  Statement,
} from "oxc-parser";
import type { FunctionLikeNode } from "../types.js";
import { forEachChildNode, getPatternNames } from "../parse/ast-walk.js";

/**
 * `react-native-worklets/plugin` (`name: "worklets"`), which Reanimated and
 * Gesture Handler require: it turns functions into worklets by replacing each
 * with a factory call that builds the function afresh where the expression
 * stood and sets `__closure` (the outer bindings the body references, by name)
 * and `__workletHash` (a hash of the generated code) on it. On web that is all
 * Reanimated reads: `useAnimatedStyle`/`useDerivedValue`/`useAnimatedReaction`
 * take `Object.values(updater.__closure)` and the hash as their dependencies.
 *
 * A function is workletized when its body has a `'worklet'` directive, when a
 * `'worklet'` file declares it at the top level, or when a pre-pass adds the
 * directive to it as a callback of a Reanimated hook, animation modifier,
 * scheduling function, gesture builder method or gesture hook (following
 * identifiers to their declaration). Worklet classes and context objects only
 * matter to the native UI runtime and are not modeled.
 */
export const WORKLETS_PLUGIN_NAME = "worklets";

const WORKLET_DIRECTIVE = "worklet";

const GESTURE_OBJECTS = new Set([
  "Tap",
  "Pan",
  "Pinch",
  "Rotation",
  "Fling",
  "LongPress",
  "ForceTouch",
  "Native",
  "Manual",
  "Race",
  "Simultaneous",
  "Exclusive",
  "Hover",
]);

const GESTURE_BUILDER_METHODS = new Set([
  "onBegin",
  "onStart",
  "onEnd",
  "onFinalize",
  "onUpdate",
  "onChange",
  "onTouchesDown",
  "onTouchesMove",
  "onTouchesUp",
  "onTouchesCancelled",
]);

const GESTURE_OBJECT_HOOKS = [
  "useTapGesture",
  "usePanGesture",
  "usePinchGesture",
  "useRotationGesture",
  "useFlingGesture",
  "useLongPressGesture",
  "useNativeGesture",
  "useManualGesture",
  "useHoverGesture",
];

const OBJECT_HOOKS = new Set(["useAnimatedScrollHandler", ...GESTURE_OBJECT_HOOKS]);

const FUNCTION_HOOKS = new Set([
  "useFrameCallback",
  "useAnimatedStyle",
  "useAnimatedProps",
  "createAnimatedPropAdapter",
  "useDerivedValue",
  "useAnimatedScrollHandler",
  "useAnimatedReaction",
  "withTiming",
  "withSpring",
  "withDecay",
  "withRepeat",
  "runOnUI",
  "executeOnUIRuntimeSync",
  "scheduleOnUI",
  "runOnUISync",
  "runOnUIAsync",
  "runOnRuntime",
  "runOnRuntimeSync",
  "runOnRuntimeAsync",
  "scheduleOnRuntime",
  "runOnRuntimeSyncWithId",
  "scheduleOnRuntimeWithId",
]);

const WORKLETIZED_ARGUMENT_INDICES = new Map<string, number[]>([
  ["useFrameCallback", [0]],
  ["useAnimatedStyle", [0]],
  ["useAnimatedProps", [0]],
  ["createAnimatedPropAdapter", [0]],
  ["useDerivedValue", [0]],
  ["useAnimatedScrollHandler", [0]],
  ["useAnimatedReaction", [0, 1]],
  ["withTiming", [2]],
  ["withSpring", [2]],
  ["withDecay", [1]],
  ["withRepeat", [3]],
  ["runOnUI", [0]],
  ["executeOnUIRuntimeSync", [0]],
  ["scheduleOnUI", [0]],
  ["runOnUISync", [0]],
  ["runOnUIAsync", [0]],
  ["runOnRuntime", [1]],
  ["runOnRuntimeSync", [1]],
  ["runOnRuntimeAsync", [1]],
  ["scheduleOnRuntime", [1]],
  ["runOnRuntimeSyncWithId", [1]],
  ["scheduleOnRuntimeWithId", [1]],
  ...GESTURE_OBJECT_HOOKS.map((name): [string, number[]] => [name, [0]]),
]);

const LAYOUT_ANIMATIONS = new Set([
  "BounceIn",
  "BounceInDown",
  "BounceInLeft",
  "BounceInRight",
  "BounceInUp",
  "BounceOut",
  "BounceOutDown",
  "BounceOutLeft",
  "BounceOutRight",
  "BounceOutUp",
  "FadeIn",
  "FadeInDown",
  "FadeInLeft",
  "FadeInRight",
  "FadeInUp",
  "FadeOut",
  "FadeOutDown",
  "FadeOutLeft",
  "FadeOutRight",
  "FadeOutUp",
  "FlipInEasyX",
  "FlipInEasyY",
  "FlipInXDown",
  "FlipInXUp",
  "FlipInYLeft",
  "FlipInYRight",
  "FlipOutEasyX",
  "FlipOutEasyY",
  "FlipOutXDown",
  "FlipOutXUp",
  "FlipOutYLeft",
  "FlipOutYRight",
  "LightSpeedInLeft",
  "LightSpeedInRight",
  "LightSpeedOutLeft",
  "LightSpeedOutRight",
  "PinwheelIn",
  "PinwheelOut",
  "RollInLeft",
  "RollInRight",
  "RollOutLeft",
  "RollOutRight",
  "RotateInDownLeft",
  "RotateInDownRight",
  "RotateInUpLeft",
  "RotateInUpRight",
  "RotateOutDownLeft",
  "RotateOutDownRight",
  "RotateOutUpLeft",
  "RotateOutUpRight",
  "SlideInDown",
  "SlideInLeft",
  "SlideInRight",
  "SlideInUp",
  "SlideOutDown",
  "SlideOutLeft",
  "SlideOutRight",
  "SlideOutUp",
  "StretchInX",
  "StretchInY",
  "StretchOutX",
  "StretchOutY",
  "ZoomIn",
  "ZoomInDown",
  "ZoomInEasyDown",
  "ZoomInEasyUp",
  "ZoomInLeft",
  "ZoomInRight",
  "ZoomInRotate",
  "ZoomInUp",
  "ZoomOut",
  "ZoomOutDown",
  "ZoomOutEasyDown",
  "ZoomOutEasyUp",
  "ZoomOutLeft",
  "ZoomOutRight",
  "ZoomOutRotate",
  "ZoomOutUp",
  "Layout",
  "LinearTransition",
  "SequencedTransition",
  "FadingTransition",
  "JumpingTransition",
  "CurvedTransition",
  "EntryExitTransition",
]);

const LAYOUT_ANIMATION_CHAINABLE_METHODS = new Set([
  "build",
  "duration",
  "delay",
  "getDuration",
  "randomDelay",
  "getDelay",
  "getDelayFunction",
  "easing",
  "rotate",
  "springify",
  "damping",
  "mass",
  "stiffness",
  "overshootClamping",
  "energyThreshold",
  "restDisplacementThreshold",
  "restSpeedThreshold",
  "withInitialValues",
  "getAnimationAndConfig",
  "easingX",
  "easingY",
  "easingWidth",
  "easingHeight",
  "entering",
  "exiting",
  "reverse",
]);

const LAYOUT_ANIMATION_CALLBACKS = new Set(["withCallback"]);

/** Identifiers the plugin never captures when nothing in the file binds them. */
const UNCAPTURED_GLOBALS = new Set([
  "globalThis",
  "Infinity",
  "NaN",
  "undefined",
  "eval",
  "isFinite",
  "isNaN",
  "parseFloat",
  "parseInt",
  "decodeURI",
  "decodeURIComponent",
  "encodeURI",
  "encodeURIComponent",
  "escape",
  "unescape",
  "Object",
  "Function",
  "Boolean",
  "Symbol",
  "Error",
  "AggregateError",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
  "InternalError",
  "Number",
  "BigInt",
  "Math",
  "Date",
  "String",
  "RegExp",
  "Array",
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "BigInt64Array",
  "BigUint64Array",
  "Float32Array",
  "Float64Array",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "ArrayBuffer",
  "SharedArrayBuffer",
  "DataView",
  "Atomics",
  "JSON",
  "WeakRef",
  "FinalizationRegistry",
  "Iterator",
  "AsyncIterator",
  "Promise",
  "GeneratorFunction",
  "AsyncGeneratorFunction",
  "Generator",
  "AsyncGenerator",
  "AsyncFunction",
  "Reflect",
  "Proxy",
  "Intl",
  "null",
  "this",
  "global",
  "window",
  "self",
  "console",
  "performance",
  "arguments",
  "require",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "queueMicrotask",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "setTimeout",
  "clearTimeout",
  "setImmediate",
  "clearImmediate",
  "setInterval",
  "clearInterval",
  "HermesInternal",
  "_WORKLET",
]);

const isFunctionLike = (node: Node): node is FunctionLikeNode =>
  node.type === "FunctionDeclaration" ||
  node.type === "FunctionExpression" ||
  node.type === "ArrowFunctionExpression";

const hasWorkletDirective = (body: ReadonlyArray<Statement>): boolean =>
  body.some(
    (statement) =>
      statement.type === "ExpressionStatement" && statement.directive === WORKLET_DIRECTIVE,
  );

const getCalleeName = (callee: Expression): string | null => {
  const target =
    callee.type === "SequenceExpression"
      ? callee.expressions[callee.expressions.length - 1]
      : callee;
  if (target === undefined) return null;
  if (target.type === "Identifier") return target.name;
  if (
    target.type === "MemberExpression" &&
    !target.computed &&
    target.property.type === "Identifier"
  ) {
    return target.property.name;
  }
  return null;
};

const isGestureObject = (expression: Expression): boolean =>
  expression.type === "CallExpression" &&
  expression.callee.type === "MemberExpression" &&
  expression.callee.object.type === "Identifier" &&
  expression.callee.object.name === "Gesture" &&
  expression.callee.property.type === "Identifier" &&
  GESTURE_OBJECTS.has(expression.callee.property.name);

const containsGestureObject = (expression: Expression): boolean =>
  isGestureObject(expression) ||
  (expression.type === "CallExpression" &&
    expression.callee.type === "MemberExpression" &&
    containsGestureObject(expression.callee.object));

/** `Gesture.Pan().onStart(...)`: a builder method of a gesture object. */
const isGestureEventCallbackMethod = (callee: Expression): boolean =>
  callee.type === "MemberExpression" &&
  callee.property.type === "Identifier" &&
  GESTURE_BUILDER_METHODS.has(callee.property.name) &&
  containsGestureObject(callee.object);

const isLayoutAnimationChain = (expression: Expression): boolean => {
  if (expression.type === "Identifier") return LAYOUT_ANIMATIONS.has(expression.name);
  if (expression.type === "NewExpression") {
    return expression.callee.type === "Identifier" && LAYOUT_ANIMATIONS.has(expression.callee.name);
  }
  return (
    expression.type === "CallExpression" &&
    expression.callee.type === "MemberExpression" &&
    expression.callee.property.type === "Identifier" &&
    LAYOUT_ANIMATION_CHAINABLE_METHODS.has(expression.callee.property.name) &&
    isLayoutAnimationChain(expression.callee.object)
  );
};

/** `FadeIn.duration(300).withCallback(...)`: a callback method of a layout animation chain. */
const isLayoutAnimationCallbackMethod = (callee: Expression): boolean =>
  callee.type === "MemberExpression" &&
  callee.property.type === "Identifier" &&
  LAYOUT_ANIMATION_CALLBACKS.has(callee.property.name) &&
  isLayoutAnimationChain(callee.object);

const isScopeNode = (node: Node): boolean =>
  node.type === "Program" || node.type === "BlockStatement" || isFunctionLike(node);

const getScopeStatements = (node: Node): ReadonlyArray<Statement> => {
  if (node.type === "Program" || node.type === "BlockStatement") return node.body;
  if (isFunctionLike(node) && node.body?.type === "BlockStatement") return node.body.body;
  return [];
};

const unwrapDeclaration = (statement: Statement): Node | null => {
  if (statement.type === "ExportNamedDeclaration") return statement.declaration;
  if (statement.type === "ExportDefaultDeclaration") return statement.declaration;
  return statement;
};

/**
 * What `name` refers to as the plugin's binding lookup finds it: the function
 * declaration, the constant's initializer, or the last function/object assigned
 * to a non-constant binding.
 */
const findBoundExpression = (
  name: string,
  ancestors: ReadonlyArray<Node>,
  acceptFunction: boolean,
  acceptObject: boolean,
): Node | null => {
  const accepts = (node: Node): boolean =>
    (acceptFunction && isFunctionLike(node)) || (acceptObject && node.type === "ObjectExpression");
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const scope = ancestors[index];
    if (scope === undefined || !isScopeNode(scope)) continue;
    let declared: Expression | null | undefined;
    let isReassigned = false;
    let lastAssigned: Expression | null = null;
    for (const statement of getScopeStatements(scope)) {
      const declaration = unwrapDeclaration(statement);
      if (declaration?.type === "FunctionDeclaration" && declaration.id?.name === name) {
        return acceptFunction ? declaration : null;
      }
      if (declaration?.type === "VariableDeclaration") {
        for (const declarator of declaration.declarations) {
          if (declarator.id.type === "Identifier" && declarator.id.name === name) {
            declared = declarator.init;
          }
        }
      }
      if (
        statement.type === "ExpressionStatement" &&
        statement.expression.type === "AssignmentExpression" &&
        statement.expression.left.type === "Identifier" &&
        statement.expression.left.name === name
      ) {
        isReassigned = true;
        if (accepts(unwrapNode(statement.expression.right))) {
          lastAssigned = statement.expression.right;
        }
      }
    }
    if (declared !== undefined) return isReassigned ? lastAssigned : declared;
  }
  return null;
};

interface WorkletCollector {
  mark: (node: FunctionLikeNode) => void;
  ancestors: Node[];
}

/** The plugin's `forEachWorkletizableFunction`: the function(s) an argument denotes, through identifiers. */
const forEachWorkletizableFunction = (
  argument: Node,
  acceptFunction: boolean,
  acceptObject: boolean,
  collector: WorkletCollector,
): void => {
  const target = unwrapNode(argument);
  if (acceptFunction && isFunctionLike(target)) {
    collector.mark(target);
    return;
  }
  if (acceptObject && target.type === "ObjectExpression") {
    forEachObjectFunction(target, collector);
    return;
  }
  if (target.type === "Identifier") {
    const bound = findBoundExpression(
      target.name,
      collector.ancestors,
      acceptFunction,
      acceptObject,
    );
    if (bound !== null && bound !== target) {
      forEachWorkletizableFunction(bound, acceptFunction, acceptObject, collector);
    }
  }
};

const unwrapNode = (node: Node): Node => {
  switch (node.type) {
    case "ParenthesizedExpression":
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
    case "TSTypeAssertion":
    case "TSInstantiationExpression":
      return unwrapNode(node.expression);
    default:
      return node;
  }
};

const forEachObjectFunction = (object: ObjectExpression, collector: WorkletCollector): void => {
  for (const property of object.properties) {
    if (property.type === "Property") {
      forEachWorkletizableFunction(property.value, true, false, collector);
    }
  }
};

/** The pre-pass that adds `'worklet'` to the callbacks of known hooks, gesture builders and layout animations. */
const collectCallbackWorklets = (call: CallExpression, collector: WorkletCollector): void => {
  const name = getCalleeName(call.callee);
  const acceptsFunction = name !== null && FUNCTION_HOOKS.has(name);
  const acceptsObject = name !== null && OBJECT_HOOKS.has(name);
  if (name !== null && (acceptsFunction || acceptsObject)) {
    const indices = WORKLETIZED_ARGUMENT_INDICES.get(name) ?? [];
    call.arguments.forEach((argument, index) => {
      if (indices.includes(index)) {
        forEachWorkletizableFunction(argument, acceptsFunction, acceptsObject, collector);
      }
    });
    return;
  }
  const isGestureCallback = isGestureEventCallbackMethod(call.callee);
  if (isGestureCallback) {
    for (const argument of call.arguments) {
      forEachWorkletizableFunction(argument, true, true, collector);
    }
  }
  if (isGestureCallback || isLayoutAnimationCallbackMethod(call.callee)) {
    for (const argument of call.arguments) {
      const unwrapped = unwrapNode(argument);
      if (isFunctionLike(unwrapped)) collector.mark(unwrapped);
    }
  }
};

/** `processWorkletFile`: everything a `'worklet'` file declares at the top level. */
const collectFileWorklets = (node: Node, collector: WorkletCollector): void => {
  if (isFunctionLike(node)) {
    collector.mark(node);
  } else if (node.type === "ObjectExpression") {
    forEachObjectFunction(node, collector);
  } else if (node.type === "VariableDeclaration") {
    for (const declarator of node.declarations) {
      if (declarator.init) collectFileWorklets(unwrapNode(declarator.init), collector);
    }
  }
};

const workletsByProgram = new WeakMap<Program, Set<FunctionLikeNode>>();

/** The functions the plugin workletizes in `program`, by node. */
export const getWorkletizedFunctions = (program: Program): Set<FunctionLikeNode> => {
  const cached = workletsByProgram.get(program);
  if (cached) return cached;
  const worklets = new Set<FunctionLikeNode>();
  const collector: WorkletCollector = { mark: (node) => worklets.add(node), ancestors: [] };
  const visit = (node: Node): void => {
    if (node.type === "CallExpression") collectCallbackWorklets(node, collector);
    if (
      isFunctionLike(node) &&
      node.body?.type === "BlockStatement" &&
      hasWorkletDirective(node.body.body)
    ) {
      worklets.add(node);
    }
    collector.ancestors.push(node);
    forEachChildNode(node, visit);
    collector.ancestors.pop();
  };
  visit(program);
  if (hasWorkletDirective(program.body)) {
    for (const statement of program.body) {
      const declaration = unwrapDeclaration(statement);
      if (declaration !== null) collectFileWorklets(declaration, collector);
    }
  }
  workletsByProgram.set(program, worklets);
  return worklets;
};

const TYPE_ONLY_KEYS = new Set(["typeAnnotation", "typeParameters", "returnType", "typeArguments"]);

const isTypeOnlyNode = (node: Node): boolean =>
  node.type.startsWith("TS") &&
  node.type !== "TSAsExpression" &&
  node.type !== "TSSatisfiesExpression" &&
  node.type !== "TSNonNullExpression" &&
  node.type !== "TSTypeAssertion" &&
  node.type !== "TSInstantiationExpression";

const collectDeclaredNames = (node: Node, names: Set<string>): void => {
  if (isFunctionLike(node)) {
    if (node.id) names.add(node.id.name);
    for (const param of node.params) {
      const pattern = param.type === "TSParameterProperty" ? param.parameter : param;
      getPatternNames(pattern.type === "RestElement" ? pattern.argument : pattern).forEach((name) =>
        names.add(name),
      );
    }
  } else if (node.type === "VariableDeclarator") {
    getPatternNames(node.id).forEach((name) => names.add(name));
  } else if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
    if (node.id) names.add(node.id.name);
  } else if (node.type === "CatchClause" && node.param) {
    getPatternNames(node.param).forEach((name) => names.add(name));
  }
  forEachChildNode(node, (child) => collectDeclaredNames(child, names));
};

/** Whether the child at `key` of `parent` is an identifier used as a name rather than a reference. */
const isNameOnlyChild = (parent: Node, key: string): boolean => {
  switch (parent.type) {
    case "MemberExpression":
      return key === "property" && !parent.computed;
    case "Property":
    case "PropertyDefinition":
    case "MethodDefinition":
      return key === "key" && !parent.computed;
    case "VariableDeclarator":
      return key === "id";
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ClassDeclaration":
    case "ClassExpression":
      return key === "id";
    case "LabeledStatement":
    case "BreakStatement":
    case "ContinueStatement":
      return key === "label";
    case "MetaProperty":
    case "ImportSpecifier":
    case "ImportDefaultSpecifier":
    case "ImportNamespaceSpecifier":
    case "ExportSpecifier":
      return true;
    default:
      return false;
  }
};

const isBindingChild = (parent: Node, key: string): boolean =>
  (parent.type === "CatchClause" && key === "param") ||
  (isFunctionLike(parent) && key === "params");

const collectBindingPatternDefaults = (node: Node, visit: (child: Node) => void): void => {
  switch (node.type) {
    case "AssignmentPattern":
      visit(node.right);
      collectBindingPatternDefaults(node.left, visit);
      return;
    case "ObjectPattern":
      for (const property of node.properties) {
        if (property.type === "RestElement")
          collectBindingPatternDefaults(property.argument, visit);
        else {
          if (property.computed) visit(property.key);
          collectBindingPatternDefaults(property.value, visit);
        }
      }
      return;
    case "ArrayPattern":
      for (const element of node.elements) {
        if (element) collectBindingPatternDefaults(element, visit);
      }
      return;
    case "RestElement":
      collectBindingPatternDefaults(node.argument, visit);
      return;
    case "TSParameterProperty":
      collectBindingPatternDefaults(node.parameter, visit);
      return;
    default:
      return;
  }
};

const closureNamesByFunction = new WeakMap<FunctionLikeNode, string[]>();

/**
 * The plugin's `getClosure`: the names `worklet` references without declaring,
 * in first-reference order. Whether an unbound name is captured depends on the
 * scope the function is created in, so the caller filters with `isBound`.
 */
export const getWorkletClosureNames = (worklet: FunctionLikeNode): string[] => {
  const cached = closureNamesByFunction.get(worklet);
  if (cached) return cached;
  const declared = new Set<string>();
  collectDeclaredNames(worklet, declared);
  const referenced: string[] = [];
  const seen = new Set<string>();
  const visitReference = (node: Node): void => {
    if (node.type === "Identifier") {
      if (!declared.has(node.name) && !seen.has(node.name)) {
        seen.add(node.name);
        referenced.push(node.name);
      }
      return;
    }
    if (isTypeOnlyNode(node)) return;
    forEachChildNode(node, (child, key) => {
      if (TYPE_ONLY_KEYS.has(key) || isNameOnlyChild(node, key)) return;
      if (isBindingChild(node, key) || (node.type === "VariableDeclarator" && key === "id")) {
        collectBindingPatternDefaults(child, visitReference);
        return;
      }
      visitReference(child);
    });
  };
  for (const param of worklet.params) collectBindingPatternDefaults(param, visitReference);
  if (worklet.body) visitReference(worklet.body);
  closureNamesByFunction.set(worklet, referenced);
  return referenced;
};

/** Whether an unbound `name` is one the plugin leaves to the global scope. */
export const isUncapturedGlobal = (name: string): boolean => UNCAPTURED_GLOBALS.has(name);

/** The plugin's `hash`: a 53-bit number from two rolling hashes of the worklet's code. */
export const getWorkletHash = (code: string): number => {
  let index = code.length;
  let hash1 = 5381;
  let hash2 = 52711;
  while (index--) {
    const char = code.charCodeAt(index);
    hash1 = (hash1 * 33) ^ char;
    hash2 = (hash2 * 33) ^ char;
  }
  return (hash1 >>> 0) * 4096 + (hash2 >>> 0);
};

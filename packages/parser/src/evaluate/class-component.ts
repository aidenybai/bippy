import type { Class, ClassElement, ParamPattern } from "oxc-parser";
import type {
  ClassBody,
  ClassFunctionMember,
  ClassMember,
  FunctionLikeNode,
  SourceLocation,
  StaticClassValue,
  StaticFunctionValue,
  StaticNativeFunctionValue,
  StaticObjectValue,
  StaticValue,
  SuperBinding,
} from "../types.js";
import type { EvaluationContext } from "./context.js";
import {
  applyPendingState,
  createHookFrame,
  escapeStateCell,
  type EffectCall,
  type HookFrame,
  nextStateCell,
  queueStateUpdate,
  type StateCell,
} from "./hooks.js";
import type { Interpreter } from "./interpreter.js";
import { createScope } from "./scope.js";
import {
  accessorEntry,
  describeValue,
  getObjectProperty,
  getTruthiness,
  isNullish,
  NULL_VALUE,
  objectFromRecord,
  objectValue,
  setObjectProperty,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

const MAX_INHERITANCE_DEPTH = 8;

const getElementName = (element: ClassElement): string | null => {
  if (element.type === "StaticBlock" || element.type === "TSIndexSignature") return null;
  if (element.computed) return null;
  const key = element.key;
  if (key.type === "Identifier") return key.name;
  if (key.type === "PrivateIdentifier") return `#${key.name}`;
  if (key.type === "Literal") return String(key.value);
  return null;
};

export const collectClassMembers = (node: Class): ClassMember[] => {
  const members: ClassMember[] = [];
  for (const element of node.body.body) {
    const key = getElementName(element);
    if (key === null) continue;
    if (element.type === "MethodDefinition" || element.type === "TSAbstractMethodDefinition") {
      if (element.kind === "set" || element.value.body === null) continue;
      const kind = element.kind === "get" ? "getter" : element.kind;
      members.push({ key, isStatic: element.static, kind, functionNode: element.value });
    } else if (
      element.type === "PropertyDefinition" ||
      element.type === "TSAbstractPropertyDefinition"
    ) {
      members.push({ key, isStatic: element.static, kind: "field", value: element.value });
    }
  }
  return members;
};

export const isErrorBoundaryClass = (body: ClassBody): boolean =>
  body.members.some(
    (member) =>
      (member.key === "getDerivedStateFromError" && member.isStatic) ||
      (member.key === "componentDidCatch" && !member.isStatic),
  ) ||
  (body.superValue?.kind === "class" && isErrorBoundaryClass(body.superValue.body));

const collectClassChain = (classValue: StaticClassValue): StaticClassValue[] => {
  const chain: StaticClassValue[] = [classValue];
  let current: StaticClassValue = classValue;
  while (chain.length < MAX_INHERITANCE_DEPTH) {
    const superValue = current.body.superValue;
    if (superValue?.kind !== "class" || chain.includes(superValue)) break;
    chain.push(superValue);
    current = superValue;
  }
  return chain;
};

interface InstanceGetter {
  key: string;
  functionValue: StaticFunctionValue;
}

interface InstanceMembers {
  constructor: StaticFunctionValue | null;
  fields: ClassMember[];
  getters: InstanceGetter[];
}

const methodContextFor = (
  classValue: StaticClassValue,
  context: EvaluationContext,
  thisValue: StaticValue,
): EvaluationContext => ({
  ...context,
  module: classValue.module,
  scope: classValue.scope,
  thisValue,
  superBinding: { construct: null, parent: classValue.body.superValue },
});

/** Binds `classValue`'s own prototype members onto `target` with `this` as the receiver. */
const bindMethods = (
  interpreter: Interpreter,
  classValue: StaticClassValue,
  target: StaticObjectValue,
  methodContext: EvaluationContext,
  seen: Set<string>,
): InstanceMembers => {
  const members: InstanceMembers = { constructor: null, fields: [], getters: [] };
  const bind = (member: ClassFunctionMember, name: string): StaticFunctionValue | null => {
    const functionValue = interpreter.createFunctionValue(member.functionNode, methodContext, name);
    return functionValue.kind === "function"
      ? {
          ...functionValue,
          thisValue: methodContext.thisValue,
          superBinding: methodContext.superBinding,
        }
      : null;
  };
  for (const member of classValue.body.members) {
    if (member.isStatic) continue;
    if (member.kind === "constructor") {
      members.constructor = bind(member, "constructor");
      continue;
    }
    if (seen.has(member.key)) continue;
    seen.add(member.key);
    if (member.kind === "field") {
      members.fields.push(member);
      continue;
    }
    const boundMethod = bind(member, member.key);
    if (!boundMethod) continue;
    if (member.kind === "getter") {
      members.getters.push({ key: member.key, functionValue: boundMethod });
    } else {
      target.entries.push({ kind: "property", key: member.key, value: boundMethod });
    }
  }
  return members;
};

/**
 * `super` as a value: in a static member the parent class itself, in an instance
 * member the parent's prototype methods bound to the current `this`.
 */
export const getSuperObject = (
  interpreter: Interpreter,
  context: EvaluationContext,
  location: SourceLocation | null,
): StaticValue => {
  const parent = context.superBinding?.parent;
  if (!parent) return unknownValue("super outside a derived class", location);
  const thisValue = context.thisValue;
  if (parent.kind !== "class" || !thisValue || thisValue.kind === "class") return parent;
  const prototype = objectFromRecord({});
  const seen = new Set<string>();
  for (const current of collectClassChain(parent)) {
    const methodContext = methodContextFor(current, context, thisValue);
    const members = bindMethods(interpreter, current, prototype, methodContext, seen);
    for (const getter of members.getters) {
      prototype.entries.push({
        kind: "property",
        key: getter.key,
        value: interpreter.callFunction(getter.functionValue, [], methodContext, { thisValue }),
      });
    }
  }
  return prototype;
};

const classPrototypes = new WeakMap<StaticClassValue, StaticObjectValue>();
const prototypeOwners = new WeakMap<StaticObjectValue, StaticClassValue>();

/** The class whose `.prototype` this object is, or null for any other object. */
export const getPrototypeOwner = (value: StaticObjectValue): StaticClassValue | null =>
  prototypeOwners.get(value) ?? null;

/** `Object.getPrototypeOf(Base.prototype)` is `Object.prototype` when `Base` has no `extends` clause. */
export const isBaseClassPrototype = (value: StaticObjectValue): boolean =>
  getPrototypeOwner(value)?.body.superValue === null;

export const isClassPrototype = (value: StaticObjectValue): boolean => prototypeOwners.has(value);

/**
 * `Class.prototype`: the chain's methods and accessors with the prototype as
 * their receiver, inheriting like an instance of the parent class does.
 */
export const getClassPrototypeObject = (
  interpreter: Interpreter,
  classValue: StaticClassValue,
  context: EvaluationContext,
): StaticObjectValue => {
  const cached = classPrototypes.get(classValue);
  if (cached) return cached;
  const superValue = classValue.body.superValue;
  const prototype = objectFromRecord({ constructor: classValue });
  if (superValue?.kind === "class") prototype.constructedBy = superValue;
  classPrototypes.set(classValue, prototype);
  prototypeOwners.set(prototype, classValue);
  const seen = new Set<string>();
  for (const current of collectClassChain(classValue)) {
    const methodContext = methodContextFor(current, context, prototype);
    const members = bindMethods(interpreter, current, prototype, methodContext, seen);
    for (const getter of members.getters) {
      prototype.entries.push(
        accessorEntry(getter.key, { get: getter.functionValue, set: null }, null),
      );
    }
  }
  return prototype;
};

/** The parameters that receive arguments: a leading TypeScript `this` annotation is not one. */
export const getValueParams = (params: ParamPattern[]): ParamPattern[] => {
  const [firstParam] = params;
  return firstParam?.type === "Identifier" && firstParam.name === "this" ? params.slice(1) : params;
};

/** `Function.length`: the leading parameters before the first default or rest parameter. */
export const getFunctionLength = (functionNode: FunctionLikeNode): number => {
  const valueParams = getValueParams(functionNode.params);
  const optionalIndex = valueParams.findIndex((parameter) => {
    const pattern = parameter.type === "TSParameterProperty" ? parameter.parameter : parameter;
    return pattern.type === "AssignmentPattern" || pattern.type === "RestElement";
  });
  return optionalIndex === -1 ? valueParams.length : optionalIndex;
};

/** `Class.length`: the constructor's `Function.length`; 0 without a constructor. */
export const getClassLength = (classValue: StaticClassValue): number => {
  const constructor = classValue.body.members.find(
    (member) => member.kind === "constructor" && !member.isStatic,
  );
  return constructor?.kind === "constructor" ? getFunctionLength(constructor.functionNode) : 0;
};

/** The class's own or inherited static property, or null when no class in the chain defines it. */
export const getStaticProperty = (
  classValue: StaticClassValue,
  key: string,
): StaticValue | null => {
  for (const current of collectClassChain(classValue)) {
    const property = current.properties.get(key);
    if (property) return property;
  }
  return null;
};

const caughtErrorValue = (): StaticValue =>
  objectFromRecord({
    name: unknownPrimitiveValue("string", "caught error name"),
    message: unknownPrimitiveValue("string", "caught error message"),
    stack: unknownPrimitiveValue("string", "caught error stack"),
  });

const getStaticMethod = (
  classValue: StaticClassValue,
  name: string,
): StaticFunctionValue | null => {
  const property = getStaticProperty(classValue, name);
  return property?.kind === "function" ? property : null;
};

const getInstanceMethod = (
  instance: StaticObjectValue,
  name: string,
): StaticFunctionValue | null => {
  const method = getObjectProperty(instance, name);
  return method.kind === "function" ? method : null;
};

/** `assign({}, prevState, partialState)` of `getStateFromUpdate`; null and undefined leave the state as is. */
const mergeState = (state: StaticValue, partialState: StaticValue): StaticValue =>
  isNullish(partialState) === true
    ? state
    : objectValue([
        { kind: "spread", value: state },
        { kind: "spread", value: partialState },
      ]);

export interface ClassInstanceRecord {
  instance: StaticObjectValue;
  stateCell: StateCell;
  isMounted: boolean;
  committedProps: StaticValue;
  committedState: StaticValue;
  pendingCallbacks: StaticValue[];
  rendered: StaticValue | null;
}

const classInstances = new WeakMap<HookFrame, ClassInstanceRecord>();

/**
 * `constructClassInstance` + `adoptClassInstance`: builds the `this` a class
 * component observes (props, fields and methods from the base classes down,
 * then whatever the constructors assigned) and installs the updater methods.
 * `setState` queues a merge into the instance's single state cell, so an
 * update from a lifecycle, a store listener or an escaped handler re-renders
 * exactly like a hook update would.
 */
const mountClassInstance = (
  interpreter: Interpreter,
  classValue: StaticClassValue,
  props: StaticValue,
  context: EvaluationContext,
  frame: HookFrame,
): ClassInstanceRecord => {
  const instance = objectFromRecord({
    props,
    state: UNDEFINED_VALUE,
    context: unknownValue("legacy class context"),
    refs: objectFromRecord({}),
  });
  initializeInstance(interpreter, classValue, instance, [props], context);
  const initialState = getObjectProperty(instance, "state");
  const stateCell = nextStateCell(frame, `${classValue.name ?? "class"} state`, () => initialState);
  const record: ClassInstanceRecord = {
    instance,
    stateCell,
    isMounted: false,
    committedProps: props,
    committedState: initialState,
    pendingCallbacks: [],
    rendered: null,
  };
  const setState: StaticNativeFunctionValue = {
    kind: "native-function",
    name: "setState",
    call: ([partialState, callback], tools) => {
      const previousState = stateCell.next ?? stateCell.current;
      const resolvedPartial =
        partialState?.kind === "function" || partialState?.kind === "native-function"
          ? tools.call(partialState, [previousState, getObjectProperty(instance, "props")])
          : (partialState ?? UNDEFINED_VALUE);
      if (callback) record.pendingCallbacks.push(callback);
      queueStateUpdate(
        frame,
        stateCell,
        mergeState(previousState, resolvedPartial),
        tools.isDeferred(),
      );
      return UNDEFINED_VALUE;
    },
    onEscape: () => escapeStateCell(frame, stateCell),
  };
  setObjectProperty(instance, "setState", setState);
  setObjectProperty(instance, "forceUpdate", {
    kind: "native-function",
    name: "forceUpdate",
    call: ([callback]) => {
      if (callback) record.pendingCallbacks.push(callback);
      return UNDEFINED_VALUE;
    },
  });
  return record;
};

/**
 * `commitClassLayoutLifecycles` for the pass that just committed:
 * `componentDidMount` on the first commit, `componentDidUpdate(prevProps,
 * prevState)` afterwards unless the update was bailed out of, then the
 * `setState` callbacks in order.
 */
const lifecycleEffect = (
  record: ClassInstanceRecord,
  props: StaticValue,
  state: StaticValue,
  didBailOut: boolean,
): StaticNativeFunctionValue => ({
  kind: "native-function",
  name: "commitClassLayoutLifecycles",
  call: (_args, tools) => {
    const { instance } = record;
    const previousProps = record.committedProps;
    const previousState = record.committedState;
    record.committedProps = props;
    record.committedState = state;
    if (!record.isMounted) {
      record.isMounted = true;
      const didMount = getInstanceMethod(instance, "componentDidMount");
      if (didMount) tools.call(didMount, []);
    } else if (!didBailOut) {
      const didUpdate = getInstanceMethod(instance, "componentDidUpdate");
      if (didUpdate) tools.call(didUpdate, [previousProps, previousState]);
    }
    const callbacks = record.pendingCallbacks;
    record.pendingCallbacks = [];
    for (const callback of callbacks) tools.call(callback, []);
    return UNDEFINED_VALUE;
  },
});

/**
 * `checkShouldComponentUpdate` for an update pass: `false` only when the
 * instance's `shouldComponentUpdate(nextProps, nextState)` decidedly declines,
 * so an undecided answer renders as a forced update would.
 */
const shouldClassUpdate = (
  interpreter: Interpreter,
  instance: StaticObjectValue,
  props: StaticValue,
  state: StaticValue,
  context: EvaluationContext,
): boolean => {
  const shouldComponentUpdate = getInstanceMethod(instance, "shouldComponentUpdate");
  if (!shouldComponentUpdate) return true;
  const decision = interpreter.callFunction(shouldComponentUpdate, [props, state], context, {
    thisValue: instance,
  });
  return getTruthiness(decision) !== false;
};

/**
 * `safelyCallComponentWillUnmount` for the instance rendered against `frame`;
 * the next lifecycle effect then mounts it again, as after a Strict Mode
 * `disappearLayoutEffects`/`reappearLayoutEffects` pair.
 */
export const unmountClassInstance = (frame: HookFrame, call: EffectCall): void => {
  const record = classInstances.get(frame);
  if (!record?.isMounted) return;
  record.isMounted = false;
  const willUnmount = getInstanceMethod(record.instance, "componentWillUnmount");
  if (willUnmount) call(willUnmount);
};

/**
 * One render of a class component as `updateClassComponent` performs it: the
 * instance is created once per hook frame and reused, `getDerivedStateFromProps`
 * (or, without it, `componentWillMount` on mount) adjusts the state before
 * `render()`, and the layout lifecycles are queued as an effect of the pass.
 * With `caughtError` the instance renders as React re-renders an error
 * boundary: with `getDerivedStateFromError` merged into state, or with null
 * children when the class only defines `componentDidCatch` (`finishClassComponent`).
 */
export const renderClassComponent = (
  interpreter: Interpreter,
  classValue: StaticClassValue,
  props: StaticValue,
  context: EvaluationContext,
  caughtError = false,
): StaticValue => {
  const frame = context.hooks ?? createHookFrame();
  let record = classInstances.get(frame);
  if (record) {
    const { stateCell } = record;
    nextStateCell(frame, stateCell.name, () => stateCell.initial);
  } else {
    record = mountClassInstance(interpreter, classValue, props, context, frame);
    classInstances.set(frame, record);
  }
  const { instance, stateCell } = record;
  let state = stateCell.current;
  const deriveStateFromProps = getStaticMethod(classValue, "getDerivedStateFromProps");
  if (deriveStateFromProps) {
    state = mergeState(
      state,
      interpreter.callFunction(deriveStateFromProps, [props, state], context, {
        thisValue: classValue,
      }),
    );
  } else if (!record.isMounted && !getInstanceMethod(instance, "getSnapshotBeforeUpdate")) {
    const willMount =
      getInstanceMethod(instance, "UNSAFE_componentWillMount") ??
      getInstanceMethod(instance, "componentWillMount");
    if (willMount) {
      setObjectProperty(instance, "state", state);
      interpreter.callFunction(willMount, [], context, { thisValue: instance });
      applyPendingState(stateCell);
      state = stateCell.current;
    }
  }
  if (caughtError) {
    const deriveStateFromError = getStaticMethod(classValue, "getDerivedStateFromError");
    if (!deriveStateFromError) return NULL_VALUE;
    state = mergeState(
      state,
      interpreter.callFunction(deriveStateFromError, [caughtErrorValue()], context, {
        thisValue: classValue,
      }),
    );
  }
  const didBailOut =
    record.isMounted &&
    !caughtError &&
    record.rendered !== null &&
    !shouldClassUpdate(interpreter, instance, props, state, context);
  setObjectProperty(instance, "props", props);
  stateCell.current = state;
  setObjectProperty(instance, "state", state);
  frame.effects.push({
    isLayout: true,
    callback: lifecycleEffect(record, props, state, didBailOut),
    deps: null,
    cleanup: null,
  });
  if (didBailOut && record.rendered !== null) return record.rendered;
  const render = getInstanceMethod(instance, "render");
  if (!render) {
    return unknownValue(`class ${classValue.name ?? "component"} has no static render method`);
  }
  record.rendered = interpreter.callFunction(render, [], context, { thisValue: instance });
  return record.rendered;
};

/** `new Class(...args)`: the instance as it is right after construction. */
export const constructClassInstance = (
  interpreter: Interpreter,
  classValue: StaticClassValue,
  args: StaticValue[],
  context: EvaluationContext,
): StaticObjectValue => {
  const instance = objectFromRecord({});
  const chain = initializeInstance(interpreter, classValue, instance, args, context);
  const baseValue = chain[chain.length - 1].body.superValue;
  if (baseValue && baseValue.kind !== "class") {
    instance.entries.unshift({
      kind: "spread",
      value: unknownValue(`members inherited from ${describeValue(baseValue)}`),
    });
  }
  return instance;
};

interface ClassLayer {
  current: StaticClassValue;
  methodContext: EvaluationContext;
  members: InstanceMembers;
}

const initializeFields = (
  interpreter: Interpreter,
  layer: ClassLayer,
  instance: StaticObjectValue,
): void => {
  for (const field of layer.members.fields) {
    const fieldContext: EvaluationContext = {
      ...layer.methodContext,
      scope: createScope(layer.current.scope),
    };
    const value =
      field.kind === "field" && field.value
        ? interpreter.evaluateExpression(field.value, fieldContext, field.key)
        : UNDEFINED_VALUE;
    instance.entries.push({ kind: "property", key: field.key, value });
  }
};

/**
 * Runs the constructors as `new` does: a base class initializes its fields and
 * then runs its body; a derived class runs its body, and its fields initialize
 * when `super(...)` returns. A derived constructor whose `super(...)` the
 * interpreter never reached still gets its parent built and fields set
 * afterwards, so the instance never lacks members it definitely has.
 */
const constructLayer = (
  interpreter: Interpreter,
  layers: ClassLayer[],
  index: number,
  args: StaticValue[],
  instance: StaticObjectValue,
): void => {
  const layer = layers[index];
  if (!layer) return;
  const isDerived = layer.current.body.superValue !== null;
  let hasConstructedParent = false;
  const constructParent = (superArgs: StaticValue[]): void => {
    if (hasConstructedParent) return;
    hasConstructedParent = true;
    constructLayer(interpreter, layers, index + 1, superArgs, instance);
    initializeFields(interpreter, layer, instance);
  };
  if (!isDerived) initializeFields(interpreter, layer, instance);
  if (layer.members.constructor) {
    const superBinding: SuperBinding = {
      construct: isDerived ? constructParent : null,
      parent: layer.current.body.superValue,
    };
    interpreter.callFunction(
      { ...layer.members.constructor, superBinding },
      args,
      { ...layer.methodContext, superBinding },
      { thisValue: instance },
    );
  }
  if (isDerived) constructParent(args);
};

const initializeInstance = (
  interpreter: Interpreter,
  classValue: StaticClassValue,
  instance: StaticObjectValue,
  args: StaticValue[],
  context: EvaluationContext,
): StaticClassValue[] => {
  instance.constructedBy = classValue;
  const chain = collectClassChain(classValue);
  const seen = new Set<string>();
  const layers: ClassLayer[] = chain.map((current) => {
    const methodContext = methodContextFor(current, context, instance);
    return {
      current,
      methodContext,
      members: bindMethods(interpreter, current, instance, methodContext, seen),
    };
  });
  for (const { members } of layers) {
    for (const getter of members.getters) {
      instance.entries.push(
        accessorEntry(getter.key, { get: getter.functionValue, set: null }, null),
      );
    }
  }
  constructLayer(interpreter, layers, 0, args, instance);
  return chain;
};

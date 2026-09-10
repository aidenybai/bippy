import semver from "semver";
import { evaluateMediaQuery } from "../evaluate/media-query.js";
import {
  NULL_VALUE,
  UNDEFINED_VALUE,
  branchValue,
  getObjectProperty,
  getTruthiness,
  listValue,
  objectFromRecord,
  objectValue,
  primitiveValue,
  unknownPrimitiveValue,
  unknownValue,
} from "../evaluate/values.js";
import {
  element,
  emptyStub,
  nativeFunction,
  passthroughStub,
  stubValue,
} from "../evaluate/stubs.js";
import { toElementType } from "../react/element-type.js";
import type {
  ContextDefinition,
  LibraryValueProvider,
  ModeledExports,
  ProjectContext,
  StaticElementType,
  StaticElementValue,
  StaticObjectEntry,
  StaticObjectValue,
  StaticValue,
  StubComponent,
} from "../types.js";
import { ClassComponentTag, ForwardRefTag } from "../work-tags.js";

// Motion components and motion values are modeled; `AnimatePresence`, `MotionConfig`,
// `LayoutGroup` and the rest of the package are plain React and analyzed from source.
// A motion component (`createMotionComponent`) is a `forwardRef` named
// `motion.<tag>` / `motion.create(<name>)` since 11.16.1 (before that only its
// render function `MotionComponent` names it) rendering `MotionContext.Provider`
// around an optional `MeasureLayout` (only with `layout`/`layoutId`/`drag`/
// `dragControls`) and the wrapped component with the motion props filtered out
// (`filterProps`). Before 9, gesture and animation features were renderless
// components (`useFeatures`) rendered as a keyed array next to the provider:
// under a `VisualElementHandler` class in 5-8, in a fragment in 4. A motion
// value's current value is animation state only the runtime knows; its identity
// is what `filterProps` and `useRender` test.

export const FRAMER_MOTION_PACKAGES = ["framer-motion", "motion"];

const FRAMER_MOTION_SPECIFIERS: ReadonlySet<string> = new Set([
  "framer-motion",
  "motion/react",
  "motion/react-client",
]);

const MOTION_VALUE_HOOKS = [
  "useMotionValue",
  "useTransform",
  "useSpring",
  "useVelocity",
  "useTime",
  "useMotionTemplate",
];

const MODELED_EXPORT_NAMES = [
  "motion",
  "m",
  "useReducedMotion",
  "useScroll",
  "useAnimation",
  "useAnimationControls",
  "useAnimate",
  "useInView",
  "useMotionValueEvent",
  "useDragControls",
  ...MOTION_VALUE_HOOKS,
];

export const FRAMER_MOTION_MODELED_EXPORTS: ModeledExports = Object.fromEntries(
  [...FRAMER_MOTION_SPECIFIERS].map((specifier) => [specifier, MODELED_EXPORT_NAMES]),
);

const MOTION_CONTEXT: ContextDefinition = {
  name: "MotionContext",
  displayName: null,
  defaultValue: objectValue(),
  location: null,
};

const VALID_MOTION_PROPS: ReadonlySet<string> = new Set([
  "animate",
  "exit",
  "variants",
  "initial",
  "style",
  "values",
  "transition",
  "transformTemplate",
  "custom",
  "inherit",
  "onBeforeLayoutMeasure",
  "onAnimationStart",
  "onAnimationComplete",
  "onUpdate",
  "onDragStart",
  "onDrag",
  "onDragEnd",
  "onMeasureDragConstraints",
  "onDirectionLock",
  "onDragTransitionEnd",
  "_dragX",
  "_dragY",
  "onHoverStart",
  "onHoverEnd",
  "onViewportEnter",
  "onViewportLeave",
  "globalTapTarget",
  "propagate",
  "ignoreStrict",
  "viewport",
]);

const isValidMotionProp = (key: string): boolean =>
  key.startsWith("while") ||
  (key.startsWith("drag") && key !== "draggable") ||
  key.startsWith("layout") ||
  key.startsWith("onTap") ||
  key.startsWith("onPan") ||
  key.startsWith("onLayout") ||
  VALID_MOTION_PROPS.has(key);

const MEASURE_LAYOUT_PROPS = ["layout", "layoutId", "drag", "dragControls"];

/** A feature `featureDefinitions` enables when any of `propNames` is truthy, rendered as `<Component key={name} {...props} visualElement />`. */
interface MotionFeature {
  name: string;
  versions: string;
  propNames: string[];
  type: StaticElementType;
}

const MOTION_VALUES = new WeakSet<StaticObjectValue>();

const isMotionValue = (value: StaticValue): boolean =>
  value.kind === "object" && MOTION_VALUES.has(value);

const motionValue = (description: string): StaticObjectValue => {
  const current = (): StaticValue => unknownValue(`${description} current value`);
  const unsubscribe = nativeFunction("unsubscribe", () => UNDEFINED_VALUE);
  const value = objectFromRecord({
    get: nativeFunction("get", current),
    getPrevious: nativeFunction("getPrevious", current),
    getVelocity: nativeFunction("getVelocity", () =>
      unknownPrimitiveValue("number", `${description} velocity`),
    ),
    set: nativeFunction("set", () => UNDEFINED_VALUE),
    jump: nativeFunction("jump", () => UNDEFINED_VALUE),
    stop: nativeFunction("stop", () => UNDEFINED_VALUE),
    destroy: nativeFunction("destroy", () => UNDEFINED_VALUE),
    on: nativeFunction("on", () => unsubscribe),
    onChange: nativeFunction("onChange", () => unsubscribe),
    isAnimating: nativeFunction("isAnimating", () =>
      unknownPrimitiveValue("boolean", `${description} isAnimating`),
    ),
    hasAnimated: unknownPrimitiveValue("boolean", `${description} hasAnimated`),
    version: primitiveValue("12"),
  });
  MOTION_VALUES.add(value);
  return value;
};

const animationControls = (): StaticValue =>
  objectFromRecord({
    mount: nativeFunction("mount", () => nativeFunction("unmount", () => UNDEFINED_VALUE)),
    start: nativeFunction("start", () => unknownValue("animation promise")),
    set: nativeFunction("set", () => UNDEFINED_VALUE),
    stop: nativeFunction("stop", () => UNDEFINED_VALUE),
    subscribe: nativeFunction("subscribe", () =>
      nativeFunction("unsubscribe", () => UNDEFINED_VALUE),
    ),
  });

/** `Component.displayName ?? Component.name ?? ""`, as `createMotionComponent` names the wrapper. */
const describeWrapped = (type: StaticElementType): string => {
  switch (type.kind) {
    case "host":
      return type.tagName;
    case "function":
    case "class": {
      const displayName = type.component.properties.get("displayName");
      if (displayName?.kind === "primitive" && typeof displayName.value === "string")
        return displayName.value;
      return type.component.name ?? "";
    }
    case "memo":
    case "forward-ref":
    case "lazy":
      return type.displayName ?? "";
    case "stub":
      return type.stub.displayName ?? "";
    case "external":
      return type.displayName;
    default:
      return "";
  }
};

const filterProps = (
  props: StaticObjectValue,
  forwardMotionProps: boolean,
): StaticObjectEntry[] => {
  const entries: StaticObjectEntry[] = [];
  const isDraggable = getTruthiness(getObjectProperty(props, "draggable")) !== false;
  for (const entry of props.entries) {
    if (entry.kind === "spread") {
      if (entry.value.kind === "object") {
        entries.push(...filterProps(entry.value, forwardMotionProps));
      } else {
        entries.push(entry);
      }
      continue;
    }
    if (entry.key === "children" || entry.key === "style" || isMotionValue(entry.value)) continue;
    if (entry.key === "values" && entry.value.kind === "object") continue;
    if (
      !isValidMotionProp(entry.key) ||
      forwardMotionProps ||
      (isDraggable && entry.key.startsWith("onDrag"))
    ) {
      entries.push(entry);
    }
  }
  return entries;
};

const MEASURE_LAYOUT_WITH_CONTEXT_STUB: StubComponent = {
  ...emptyStub("MeasureLayoutWithContext"),
  tag: ClassComponentTag,
};

const MEASURE_LAYOUT_STUB: StubComponent = {
  displayName: "MeasureLayout",
  render: () => element({ kind: "stub", stub: MEASURE_LAYOUT_WITH_CONTEXT_STUB }, objectValue()),
};

const classStubType = (displayName: string): StaticElementType => ({
  kind: "stub",
  stub: { ...emptyStub(displayName), tag: ClassComponentTag },
});

/** A function component wrapping a class that renders nothing (`MeasureContextProvider` around `Measure`). */
const classWrapperStubType = (displayName: string, className: string): StaticElementType => {
  const inner = classStubType(className);
  return {
    kind: "stub",
    stub: { displayName, render: (props) => element(inner, props) },
  };
};

const RENDERLESS_TYPE: StaticElementType = { kind: "stub", stub: emptyStub(null) };

const VISUAL_ELEMENT_HANDLER_TYPE: StaticElementType = {
  kind: "stub",
  stub: { ...passthroughStub("VisualElementHandler"), tag: ClassComponentTag },
};

const ANIMATION_PROPS = [
  "animate",
  "exit",
  "variants",
  "whileHover",
  "whileTap",
  "whileFocus",
  "whileDrag",
];

const FEATURE_VERSIONS = "<9";

const MOTION_FEATURES: MotionFeature[] = [
  {
    name: "measureLayout",
    versions: "<5",
    propNames: ["layout", "layoutId", "drag", "_layoutResetTransform"],
    type: classWrapperStubType("MeasureContextProvider", "Measure"),
  },
  {
    name: "measureLayout",
    versions: ">=5 <9",
    propNames: ["layout", "layoutId", "drag"],
    type: { kind: "stub", stub: MEASURE_LAYOUT_STUB },
  },
  { name: "animation", versions: "<5", propNames: ANIMATION_PROPS, type: RENDERLESS_TYPE },
  {
    name: "animation",
    versions: ">=5 <9",
    propNames: [...ANIMATION_PROPS, "whileInView"],
    type: RENDERLESS_TYPE,
  },
  { name: "exit", versions: FEATURE_VERSIONS, propNames: ["exit"], type: RENDERLESS_TYPE },
  {
    name: "drag",
    versions: FEATURE_VERSIONS,
    propNames: ["drag", "dragControls"],
    type: RENDERLESS_TYPE,
  },
  { name: "focus", versions: FEATURE_VERSIONS, propNames: ["whileFocus"], type: RENDERLESS_TYPE },
  {
    name: "hover",
    versions: FEATURE_VERSIONS,
    propNames: ["whileHover", "onHoverStart", "onHoverEnd"],
    type: RENDERLESS_TYPE,
  },
  {
    name: "tap",
    versions: FEATURE_VERSIONS,
    propNames: ["whileTap", "onTap", "onTapStart", "onTapCancel"],
    type: RENDERLESS_TYPE,
  },
  {
    name: "pan",
    versions: FEATURE_VERSIONS,
    propNames: ["onPan", "onPanStart", "onPanSessionStart", "onPanEnd"],
    type: RENDERLESS_TYPE,
  },
  {
    name: "inView",
    versions: ">=5.3.0 <9",
    propNames: ["whileInView", "onViewportEnter", "onViewportLeave"],
    type: RENDERLESS_TYPE,
  },
  {
    name: "layoutAnimation",
    versions: "<5",
    propNames: ["layout", "layoutId"],
    type: classWrapperStubType("AnimateLayoutContextProvider", "Animate"),
  },
];

/** `propNames.some((name) => !!props[name])`; null when a prop's truthiness is not statically known. */
const hasTruthyProp = (props: StaticObjectValue, propNames: string[]): boolean | null => {
  let isUnknown = false;
  for (const key of propNames) {
    const truthiness = getTruthiness(getObjectProperty(props, key));
    if (truthiness === true) return true;
    if (truthiness === null) isUnknown = true;
  }
  return isUnknown ? null : false;
};

const optionalElement = (
  isRendered: boolean | null,
  rendered: StaticElementValue,
  description: string,
): StaticValue => {
  if (isRendered === true) return rendered;
  if (isRendered === false) return NULL_VALUE;
  return branchValue(
    [NULL_VALUE, rendered],
    `whether the motion component has ${description} props is not statically known`,
  );
};

const measureLayoutElement = (props: StaticObjectValue): StaticValue =>
  optionalElement(
    hasTruthyProp(props, MEASURE_LAYOUT_PROPS),
    element({ kind: "stub", stub: MEASURE_LAYOUT_STUB }, objectValue()),
    "layout or drag",
  );

const featureElements = (
  version: string,
  props: StaticObjectValue,
  visualElement: StaticValue,
): StaticValue =>
  listValue(
    MOTION_FEATURES.filter((feature) => satisfiesVersion(version, feature.versions)).map(
      (feature) =>
        optionalElement(
          hasTruthyProp(props, feature.propNames),
          element(
            feature.type,
            objectValue([
              { kind: "spread", value: props },
              { kind: "property", key: "visualElement", value: visualElement },
            ]),
            primitiveValue(feature.name),
          ),
          feature.name,
        ),
    ),
  );

const satisfiesVersion = (version: string, range: string): boolean =>
  semver.satisfies(version, range, { includePrerelease: true });

/** `motion/index.mjs` names the component (`motion.div`) since 11.16.1; before, only the render function (`MotionComponent`). */
const NAMED_MOTION_COMPONENT_VERSIONS = ">=11.16.1";

const FRAGMENT_TREE_VERSIONS = "<5";

const describeMotionComponent = (wrappedType: StaticElementType, version: string): string => {
  if (!satisfiesVersion(version, NAMED_MOTION_COMPONENT_VERSIONS)) return "MotionComponent";
  const wrapped = describeWrapped(wrappedType);
  return wrappedType.kind === "host" ? `motion.${wrapped}` : `motion.create(${wrapped})`;
};

const motionContextProvider = (children: StaticValue): StaticElementValue =>
  element(
    { kind: "context-provider", context: MOTION_CONTEXT, displayName: null },
    objectFromRecord({ value: unknownValue("motion tree variants"), children }),
  );

const motionTree = (
  version: string,
  props: StaticObjectValue,
  wrapped: StaticElementValue,
): StaticElementValue => {
  if (!satisfiesVersion(version, FEATURE_VERSIONS))
    return motionContextProvider(listValue([measureLayoutElement(props), wrapped]));
  const visualElement = unknownValue("motion visual element");
  const features = featureElements(version, props, visualElement);
  const provider = motionContextProvider(wrapped);
  if (satisfiesVersion(version, FRAGMENT_TREE_VERSIONS))
    return element(
      { kind: "fragment" },
      objectFromRecord({ children: listValue([provider, features]) }),
    );
  return element(
    VISUAL_ELEMENT_HANDLER_TYPE,
    objectFromRecord({ visualElement, props, children: listValue([features, provider]) }),
  );
};

const createMotionComponent = (
  wrapped: StaticValue,
  forwardMotionProps: boolean,
  version: string,
): StaticValue => {
  const wrappedType = toElementType(wrapped, null);
  const stub: StubComponent = {
    displayName: describeMotionComponent(wrappedType, version),
    tag: ForwardRefTag,
    render: (props) => {
      const children = getObjectProperty(props, "children");
      const entries = filterProps(props, forwardMotionProps);
      entries.push(
        { kind: "property", key: "style", value: unknownValue("motion visual styles") },
        {
          kind: "property",
          key: "children",
          value: isMotionValue(children) ? unknownValue("motion value rendered as text") : children,
        },
      );
      return motionTree(version, props, element(wrappedType, objectValue(entries)));
    },
  };
  return stubValue(stub);
};

const forwardsMotionProps = (options: StaticValue | undefined): boolean =>
  options?.kind === "object" &&
  getTruthiness(getObjectProperty(options, "forwardMotionProps")) === true;

/** The installed version, or the latest modeled shape when the package is not resolvable. */
const readMotionVersion = (specifier: string, project: ProjectContext): string =>
  project.readPackageVersion(specifier.split("/")[0]) ?? "12.0.0";

/** `motion.div`, `motion.create(Component, options?)`, and the deprecated `motion(Component)`. */
const motionProxy = (specifier: string, project: ProjectContext): StaticValue => {
  const version = readMotionVersion(specifier, project);
  const create = nativeFunction("motion.create", ([wrapped = UNDEFINED_VALUE, options]) =>
    createMotionComponent(wrapped, forwardsMotionProps(options), version),
  );
  return {
    kind: "proxy",
    target: create,
    handler: objectFromRecord({
      get: nativeFunction("motion.<tag>", ([, key]) => {
        if (key?.kind !== "primitive" || typeof key.value !== "string")
          return unknownValue("motion tag name");
        return key.value === "create"
          ? create
          : createMotionComponent(primitiveValue(key.value), false, version);
      }),
    }),
  };
};

const useScroll = (): StaticValue =>
  objectFromRecord({
    scrollX: motionValue("scrollX"),
    scrollY: motionValue("scrollY"),
    scrollXProgress: motionValue("scrollXProgress"),
    scrollYProgress: motionValue("scrollYProgress"),
  });

const useAnimate = (): StaticValue =>
  listValue([
    objectFromRecord({ current: NULL_VALUE, animations: listValue([]) }),
    nativeFunction("animate", () => unknownValue("animation playback controls")),
  ]);

export const framerMotionValue: LibraryValueProvider = (specifier, importedName, { project }) => {
  if (!FRAMER_MOTION_SPECIFIERS.has(specifier)) return null;
  if (MOTION_VALUE_HOOKS.includes(importedName))
    return nativeFunction(importedName, () => motionValue(importedName));
  switch (importedName) {
    case "motion":
    case "m":
      return motionProxy(specifier, project);
    case "useReducedMotion":
      return nativeFunction("useReducedMotion", () =>
        primitiveValue(evaluateMediaQuery("(prefers-reduced-motion)") === true),
      );
    case "useScroll":
      return nativeFunction("useScroll", useScroll);
    case "useAnimation":
    case "useAnimationControls":
      return nativeFunction(importedName, animationControls);
    case "useAnimate":
      return nativeFunction("useAnimate", useAnimate);
    case "useInView":
      return nativeFunction("useInView", () =>
        unknownPrimitiveValue("boolean", "whether the element is in view"),
      );
    case "useMotionValueEvent":
      return nativeFunction("useMotionValueEvent", () => UNDEFINED_VALUE);
    case "useDragControls":
      return nativeFunction("useDragControls", () =>
        objectFromRecord({ start: nativeFunction("start", () => UNDEFINED_VALUE) }),
      );
    default:
      return null;
  }
};

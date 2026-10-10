/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// Ported from babel-plugin-react-compiler/src/HIR/Globals.ts at b618bbb.

import { Effect, ValueKind, ValueReason } from "./hir.js";
import {
  BUILTIN_SHAPES,
  BuiltInArrayId,
  BuiltInMapId,
  BuiltInObjectId,
  BuiltInSetId,
  BuiltInUseActionStateId,
  BuiltInUseContextHookId,
  BuiltInUseEffectEventId,
  BuiltInUseEffectHookId,
  BuiltInUseInsertionEffectHookId,
  BuiltInUseLayoutEffectHookId,
  BuiltInUseOperatorId,
  BuiltInUseOptimisticId,
  BuiltInUseReducerId,
  BuiltInUseRefId,
  BuiltInUseStateId,
  BuiltInUseTransitionId,
  BuiltInWeakMapId,
  BuiltInWeakSetId,
  BuiltInEffectEventId,
  type ShapeRegistry,
  addFunction,
  addHook,
  addObject,
} from "./object-shape.js";
import type { BuiltInType, PolyType } from "./types.js";

/*
 * This file exports types and defaults for JavaScript global objects.
 * A Forget `Environment` stores the GlobalRegistry and ShapeRegistry
 * used for the current project. These ultimately help Forget refine
 * its inference of types (i.e. Object vs Primitive) and effects
 * (i.e. read vs mutate) in source programs.
 */

// ShapeRegistry with default definitions for builtins and global objects.
export const DEFAULT_SHAPES: ShapeRegistry = new Map(BUILTIN_SHAPES);

// Hack until we add ObjectShapes for all globals
const UNTYPED_GLOBALS: Set<string> = new Set([
  "Object",
  "Function",
  "RegExp",
  "Date",
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "URIError",
  "EvalError",
  "DataView",
  "Float32Array",
  "Float64Array",
  "Int8Array",
  "Int16Array",
  "Int32Array",
  "WeakMap",
  "Uint8Array",
  "Uint8ClampedArray",
  "Uint16Array",
  "Uint32Array",
  "ArrayBuffer",
  "JSON",
  "console",
  "eval",
]);

const TYPED_GLOBALS: Array<[string, BuiltInType]> = [
  [
    "Object",
    addObject(DEFAULT_SHAPES, "Object", [
      [
        "keys",
        addFunction(DEFAULT_SHAPES, [], {
          positionalParams: [Effect.Read],
          restParam: null,
          returnType: { kind: "Object", shapeId: BuiltInArrayId },
          calleeEffect: Effect.Read,
          returnValueKind: ValueKind.Mutable,
        }),
      ],
      [
        /**
         * Object.fromEntries(iterable)
         * iterable: An iterable, such as an Array or Map, containing a list of
         *           objects. Each object should have two properties.
         * Returns a new object whose properties are given by the entries of the
         * iterable.
         */
        "fromEntries",
        addFunction(DEFAULT_SHAPES, [], {
          positionalParams: [Effect.ConditionallyMutate],
          restParam: null,
          returnType: { kind: "Object", shapeId: BuiltInObjectId },
          calleeEffect: Effect.Read,
          returnValueKind: ValueKind.Mutable,
        }),
      ],
      [
        "entries",
        addFunction(DEFAULT_SHAPES, [], {
          positionalParams: [Effect.Capture],
          restParam: null,
          returnType: { kind: "Object", shapeId: BuiltInArrayId },
          calleeEffect: Effect.Read,
          returnValueKind: ValueKind.Mutable,
        }),
      ],
      [
        "keys",
        addFunction(DEFAULT_SHAPES, [], {
          positionalParams: [Effect.Read],
          restParam: null,
          returnType: { kind: "Object", shapeId: BuiltInArrayId },
          calleeEffect: Effect.Read,
          returnValueKind: ValueKind.Mutable,
        }),
      ],
      [
        "values",
        addFunction(DEFAULT_SHAPES, [], {
          positionalParams: [Effect.Capture],
          restParam: null,
          returnType: { kind: "Object", shapeId: BuiltInArrayId },
          calleeEffect: Effect.Read,
          returnValueKind: ValueKind.Mutable,
        }),
      ],
    ]),
  ],
  [
    "Array",
    addObject(DEFAULT_SHAPES, "Array", [
      [
        "isArray",
        // Array.isArray(value)
        addFunction(DEFAULT_SHAPES, [], {
          positionalParams: [Effect.Read],
          restParam: null,
          returnType: { kind: "Primitive" },
          calleeEffect: Effect.Read,
          returnValueKind: ValueKind.Primitive,
        }),
      ],
      /*
       * https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.from
       * Array.from(arrayLike, optionalFn, optionalThis)
       * Note that the Effect of `arrayLike` is polymorphic i.e.
       *  - Effect.read if
       *     - it does not have an @iterator property and is array-like
       *       (i.e. has a length property)
       *    - it is an iterable object whose iterator does not mutate itself
       *  - Effect.mutate if it is a self-mutative iterator (e.g. a generator
       *    function)
       */
      [
        "from",
        addFunction(DEFAULT_SHAPES, [], {
          positionalParams: [
            Effect.ConditionallyMutateIterator,
            Effect.ConditionallyMutate,
            Effect.ConditionallyMutate,
          ],
          restParam: Effect.Read,
          returnType: { kind: "Object", shapeId: BuiltInArrayId },
          calleeEffect: Effect.Read,
          returnValueKind: ValueKind.Mutable,
        }),
      ],
      [
        "of",
        // Array.of(element0, ..., elementN)
        addFunction(DEFAULT_SHAPES, [], {
          positionalParams: [],
          restParam: Effect.Read,
          returnType: { kind: "Object", shapeId: BuiltInArrayId },
          calleeEffect: Effect.Read,
          returnValueKind: ValueKind.Mutable,
        }),
      ],
    ]),
  ],
  [
    "performance",
    addObject(DEFAULT_SHAPES, "performance", [
      // Static methods (TODO)
      [
        "now",
        // Date.now()
        addFunction(DEFAULT_SHAPES, [], {
          positionalParams: [],
          restParam: Effect.Read,
          returnType: { kind: "Poly" }, // TODO: could be Primitive, but that would change existing compilation
          calleeEffect: Effect.Read,
          returnValueKind: ValueKind.Mutable, // same here
          impure: true,
          canonicalName: "performance.now",
        }),
      ],
    ]),
  ],
  [
    "Date",
    addFunction(
      DEFAULT_SHAPES,
      [
        // Static methods (TODO)
        [
          "now",
          // Date.now()
          addFunction(DEFAULT_SHAPES, [], {
            positionalParams: [],
            restParam: Effect.Read,
            returnType: { kind: "Poly" }, // TODO: could be Primitive, but that would change existing compilation
            calleeEffect: Effect.Read,
            returnValueKind: ValueKind.Mutable, // same here
            impure: true,
            canonicalName: "Date.now",
          }),
        ],
      ],
      {
        positionalParams: [],
        restParam: Effect.Read,
        returnType: { kind: "Poly" },
        calleeEffect: Effect.Read,
        returnValueKind: ValueKind.Mutable,
        /*
         * Zero-arg `new Date()` / `Date()` reads the current clock.
         * `new Date(timestamp)` is treated as pure via `impureIfNoArgs`.
         */
        impure: true,
        impureIfNoArgs: true,
        canonicalName: "Date",
      },
      "Date",
    ),
  ],
  [
    "Math",
    addObject(DEFAULT_SHAPES, "Math", [
      // Static properties (TODO)
      ["PI", { kind: "Primitive" }],
      // Static methods (TODO)
      [
        "max",
        // Math.max(value0, ..., valueN)
        addFunction(DEFAULT_SHAPES, [], {
          positionalParams: [],
          restParam: Effect.Read,
          returnType: { kind: "Primitive" },
          calleeEffect: Effect.Read,
          returnValueKind: ValueKind.Primitive,
        }),
      ],
      [
        "min",
        // Math.min(value0, ..., valueN)
        addFunction(DEFAULT_SHAPES, [], {
          positionalParams: [],
          restParam: Effect.Read,
          returnType: { kind: "Primitive" },
          calleeEffect: Effect.Read,
          returnValueKind: ValueKind.Primitive,
        }),
      ],
      [
        "trunc",
        addFunction(DEFAULT_SHAPES, [], {
          positionalParams: [],
          restParam: Effect.Read,
          returnType: { kind: "Primitive" },
          calleeEffect: Effect.Read,
          returnValueKind: ValueKind.Primitive,
        }),
      ],
      [
        "ceil",
        addFunction(DEFAULT_SHAPES, [], {
          positionalParams: [],
          restParam: Effect.Read,
          returnType: { kind: "Primitive" },
          calleeEffect: Effect.Read,
          returnValueKind: ValueKind.Primitive,
        }),
      ],
      [
        "floor",
        addFunction(DEFAULT_SHAPES, [], {
          positionalParams: [],
          restParam: Effect.Read,
          returnType: { kind: "Primitive" },
          calleeEffect: Effect.Read,
          returnValueKind: ValueKind.Primitive,
        }),
      ],
      [
        "pow",
        addFunction(DEFAULT_SHAPES, [], {
          positionalParams: [],
          restParam: Effect.Read,
          returnType: { kind: "Primitive" },
          calleeEffect: Effect.Read,
          returnValueKind: ValueKind.Primitive,
        }),
      ],
      [
        "random",
        addFunction(DEFAULT_SHAPES, [], {
          positionalParams: [],
          restParam: Effect.Read,
          returnType: { kind: "Poly" }, // TODO: could be Primitive, but that would change existing compilation
          calleeEffect: Effect.Read,
          returnValueKind: ValueKind.Mutable, // same here
          impure: true,
          canonicalName: "Math.random",
        }),
      ],
    ]),
  ],
  ["Infinity", { kind: "Primitive" }],
  ["NaN", { kind: "Primitive" }],
  [
    "console",
    addObject(DEFAULT_SHAPES, "console", [
      [
        "error",
        addFunction(DEFAULT_SHAPES, [], {
          positionalParams: [],
          restParam: Effect.Read,
          returnType: { kind: "Primitive" },
          calleeEffect: Effect.Read,
          returnValueKind: ValueKind.Primitive,
        }),
      ],
      [
        "info",
        addFunction(DEFAULT_SHAPES, [], {
          positionalParams: [],
          restParam: Effect.Read,
          returnType: { kind: "Primitive" },
          calleeEffect: Effect.Read,
          returnValueKind: ValueKind.Primitive,
        }),
      ],
      [
        "log",
        addFunction(DEFAULT_SHAPES, [], {
          positionalParams: [],
          restParam: Effect.Read,
          returnType: { kind: "Primitive" },
          calleeEffect: Effect.Read,
          returnValueKind: ValueKind.Primitive,
        }),
      ],
      [
        "table",
        addFunction(DEFAULT_SHAPES, [], {
          positionalParams: [],
          restParam: Effect.Read,
          returnType: { kind: "Primitive" },
          calleeEffect: Effect.Read,
          returnValueKind: ValueKind.Primitive,
        }),
      ],
      [
        "trace",
        addFunction(DEFAULT_SHAPES, [], {
          positionalParams: [],
          restParam: Effect.Read,
          returnType: { kind: "Primitive" },
          calleeEffect: Effect.Read,
          returnValueKind: ValueKind.Primitive,
        }),
      ],
      [
        "warn",
        addFunction(DEFAULT_SHAPES, [], {
          positionalParams: [],
          restParam: Effect.Read,
          returnType: { kind: "Primitive" },
          calleeEffect: Effect.Read,
          returnValueKind: ValueKind.Primitive,
        }),
      ],
    ]),
  ],
  [
    "Boolean",
    addFunction(DEFAULT_SHAPES, [], {
      positionalParams: [],
      restParam: Effect.Read,
      returnType: { kind: "Primitive" },
      calleeEffect: Effect.Read,
      returnValueKind: ValueKind.Primitive,
    }),
  ],
  [
    "Number",
    addFunction(DEFAULT_SHAPES, [], {
      positionalParams: [],
      restParam: Effect.Read,
      returnType: { kind: "Primitive" },
      calleeEffect: Effect.Read,
      returnValueKind: ValueKind.Primitive,
    }),
  ],
  [
    "String",
    addFunction(DEFAULT_SHAPES, [], {
      positionalParams: [],
      restParam: Effect.Read,
      returnType: { kind: "Primitive" },
      calleeEffect: Effect.Read,
      returnValueKind: ValueKind.Primitive,
    }),
  ],
  [
    "parseInt",
    addFunction(DEFAULT_SHAPES, [], {
      positionalParams: [],
      restParam: Effect.Read,
      returnType: { kind: "Primitive" },
      calleeEffect: Effect.Read,
      returnValueKind: ValueKind.Primitive,
    }),
  ],
  [
    "parseFloat",
    addFunction(DEFAULT_SHAPES, [], {
      positionalParams: [],
      restParam: Effect.Read,
      returnType: { kind: "Primitive" },
      calleeEffect: Effect.Read,
      returnValueKind: ValueKind.Primitive,
    }),
  ],
  [
    "isNaN",
    addFunction(DEFAULT_SHAPES, [], {
      positionalParams: [],
      restParam: Effect.Read,
      returnType: { kind: "Primitive" },
      calleeEffect: Effect.Read,
      returnValueKind: ValueKind.Primitive,
    }),
  ],
  [
    "isFinite",
    addFunction(DEFAULT_SHAPES, [], {
      positionalParams: [],
      restParam: Effect.Read,
      returnType: { kind: "Primitive" },
      calleeEffect: Effect.Read,
      returnValueKind: ValueKind.Primitive,
    }),
  ],
  [
    "encodeURI",
    addFunction(DEFAULT_SHAPES, [], {
      positionalParams: [],
      restParam: Effect.Read,
      returnType: { kind: "Primitive" },
      calleeEffect: Effect.Read,
      returnValueKind: ValueKind.Primitive,
    }),
  ],
  [
    "encodeURIComponent",
    addFunction(DEFAULT_SHAPES, [], {
      positionalParams: [],
      restParam: Effect.Read,
      returnType: { kind: "Primitive" },
      calleeEffect: Effect.Read,
      returnValueKind: ValueKind.Primitive,
    }),
  ],
  [
    "decodeURI",
    addFunction(DEFAULT_SHAPES, [], {
      positionalParams: [],
      restParam: Effect.Read,
      returnType: { kind: "Primitive" },
      calleeEffect: Effect.Read,
      returnValueKind: ValueKind.Primitive,
    }),
  ],
  [
    "decodeURIComponent",
    addFunction(DEFAULT_SHAPES, [], {
      positionalParams: [],
      restParam: Effect.Read,
      returnType: { kind: "Primitive" },
      calleeEffect: Effect.Read,
      returnValueKind: ValueKind.Primitive,
    }),
  ],
  [
    "Map",
    addFunction(
      DEFAULT_SHAPES,
      [],
      {
        positionalParams: [Effect.ConditionallyMutateIterator],
        restParam: null,
        returnType: { kind: "Object", shapeId: BuiltInMapId },
        calleeEffect: Effect.Read,
        returnValueKind: ValueKind.Mutable,
      },
      null,
      true,
    ),
  ],
  [
    "Set",
    addFunction(
      DEFAULT_SHAPES,
      [],
      {
        positionalParams: [Effect.ConditionallyMutateIterator],
        restParam: null,
        returnType: { kind: "Object", shapeId: BuiltInSetId },
        calleeEffect: Effect.Read,
        returnValueKind: ValueKind.Mutable,
      },
      null,
      true,
    ),
  ],
  [
    "WeakMap",
    addFunction(
      DEFAULT_SHAPES,
      [],
      {
        positionalParams: [Effect.ConditionallyMutateIterator],
        restParam: null,
        returnType: { kind: "Object", shapeId: BuiltInWeakMapId },
        calleeEffect: Effect.Read,
        returnValueKind: ValueKind.Mutable,
      },
      null,
      true,
    ),
  ],
  [
    "WeakSet",
    addFunction(
      DEFAULT_SHAPES,
      [],
      {
        positionalParams: [Effect.ConditionallyMutateIterator],
        restParam: null,
        returnType: { kind: "Object", shapeId: BuiltInWeakSetId },
        calleeEffect: Effect.Read,
        returnValueKind: ValueKind.Mutable,
      },
      null,
      true,
    ),
  ],
  // TODO: rest of Global objects
];

/*
 * TODO(mofeiZ): We currently only store rest param effects for hooks.
 * now that FeatureFlag `enableTreatHooksAsFunctions` is removed we can
 * use positional params too (?)
 */
const REACT_APIS: Array<[string, BuiltInType]> = [
  [
    "useContext",
    addHook(
      DEFAULT_SHAPES,
      {
        positionalParams: [],
        restParam: Effect.Read,
        returnType: { kind: "Poly" },
        calleeEffect: Effect.Read,
        hookKind: "useContext",
        returnValueKind: ValueKind.Frozen,
        returnValueReason: ValueReason.Context,
      },
      BuiltInUseContextHookId,
    ),
  ],
  [
    "useState",
    addHook(DEFAULT_SHAPES, {
      positionalParams: [],
      restParam: Effect.Freeze,
      returnType: { kind: "Object", shapeId: BuiltInUseStateId },
      calleeEffect: Effect.Read,
      hookKind: "useState",
      returnValueKind: ValueKind.Frozen,
      returnValueReason: ValueReason.State,
    }),
  ],
  [
    "useActionState",
    addHook(DEFAULT_SHAPES, {
      positionalParams: [],
      restParam: Effect.Freeze,
      returnType: { kind: "Object", shapeId: BuiltInUseActionStateId },
      calleeEffect: Effect.Read,
      hookKind: "useActionState",
      returnValueKind: ValueKind.Frozen,
      returnValueReason: ValueReason.State,
    }),
  ],
  [
    "useReducer",
    addHook(DEFAULT_SHAPES, {
      positionalParams: [],
      restParam: Effect.Freeze,
      returnType: { kind: "Object", shapeId: BuiltInUseReducerId },
      calleeEffect: Effect.Read,
      hookKind: "useReducer",
      returnValueKind: ValueKind.Frozen,
      returnValueReason: ValueReason.ReducerState,
    }),
  ],
  [
    "useRef",
    addHook(DEFAULT_SHAPES, {
      positionalParams: [],
      restParam: Effect.Capture,
      returnType: { kind: "Object", shapeId: BuiltInUseRefId },
      calleeEffect: Effect.Read,
      hookKind: "useRef",
      returnValueKind: ValueKind.Mutable,
    }),
  ],
  [
    "useImperativeHandle",
    addHook(DEFAULT_SHAPES, {
      positionalParams: [],
      restParam: Effect.Freeze,
      returnType: { kind: "Primitive" },
      calleeEffect: Effect.Read,
      hookKind: "useImperativeHandle",
      returnValueKind: ValueKind.Frozen,
    }),
  ],
  [
    "useMemo",
    addHook(DEFAULT_SHAPES, {
      positionalParams: [],
      restParam: Effect.Freeze,
      returnType: { kind: "Poly" },
      calleeEffect: Effect.Read,
      hookKind: "useMemo",
      returnValueKind: ValueKind.Frozen,
    }),
  ],
  [
    "useCallback",
    addHook(DEFAULT_SHAPES, {
      positionalParams: [],
      restParam: Effect.Freeze,
      returnType: { kind: "Poly" },
      calleeEffect: Effect.Read,
      hookKind: "useCallback",
      returnValueKind: ValueKind.Frozen,
    }),
  ],
  [
    "useEffect",
    addHook(
      DEFAULT_SHAPES,
      {
        positionalParams: [],
        restParam: Effect.Freeze,
        returnType: { kind: "Primitive" },
        calleeEffect: Effect.Read,
        hookKind: "useEffect",
        returnValueKind: ValueKind.Frozen,
      },
      BuiltInUseEffectHookId,
    ),
  ],
  [
    "useLayoutEffect",
    addHook(
      DEFAULT_SHAPES,
      {
        positionalParams: [],
        restParam: Effect.Freeze,
        returnType: { kind: "Poly" },
        calleeEffect: Effect.Read,
        hookKind: "useLayoutEffect",
        returnValueKind: ValueKind.Frozen,
      },
      BuiltInUseLayoutEffectHookId,
    ),
  ],
  [
    "useInsertionEffect",
    addHook(
      DEFAULT_SHAPES,
      {
        positionalParams: [],
        restParam: Effect.Freeze,
        returnType: { kind: "Poly" },
        calleeEffect: Effect.Read,
        hookKind: "useInsertionEffect",
        returnValueKind: ValueKind.Frozen,
      },
      BuiltInUseInsertionEffectHookId,
    ),
  ],
  [
    "useTransition",
    addHook(DEFAULT_SHAPES, {
      positionalParams: [],
      restParam: null,
      returnType: { kind: "Object", shapeId: BuiltInUseTransitionId },
      calleeEffect: Effect.Read,
      hookKind: "useTransition",
      returnValueKind: ValueKind.Frozen,
    }),
  ],
  [
    "useOptimistic",
    addHook(DEFAULT_SHAPES, {
      positionalParams: [],
      restParam: Effect.Freeze,
      returnType: { kind: "Object", shapeId: BuiltInUseOptimisticId },
      calleeEffect: Effect.Read,
      hookKind: "useOptimistic",
      returnValueKind: ValueKind.Frozen,
      returnValueReason: ValueReason.State,
    }),
  ],
  [
    "use",
    addFunction(
      DEFAULT_SHAPES,
      [],
      {
        positionalParams: [],
        restParam: Effect.Freeze,
        returnType: { kind: "Poly" },
        calleeEffect: Effect.Read,
        returnValueKind: ValueKind.Frozen,
      },
      BuiltInUseOperatorId,
    ),
  ],
  [
    "useEffectEvent",
    addHook(
      DEFAULT_SHAPES,
      {
        positionalParams: [],
        restParam: Effect.Freeze,
        returnType: {
          kind: "Function",
          return: { kind: "Poly" },
          shapeId: BuiltInEffectEventId,
          isConstructor: false,
        },
        calleeEffect: Effect.Read,
        hookKind: "useEffectEvent",
        // Frozen because it should not mutate any locally-bound values
        returnValueKind: ValueKind.Frozen,
      },
      BuiltInUseEffectEventId,
    ),
  ],
];

TYPED_GLOBALS.push(
  [
    "React",
    addObject(DEFAULT_SHAPES, null, [
      ...REACT_APIS,
      [
        "createElement",
        addFunction(DEFAULT_SHAPES, [], {
          positionalParams: [],
          restParam: Effect.Freeze,
          returnType: { kind: "Poly" },
          calleeEffect: Effect.Read,
          returnValueKind: ValueKind.Frozen,
        }),
      ],
      [
        "cloneElement",
        addFunction(DEFAULT_SHAPES, [], {
          positionalParams: [],
          restParam: Effect.Freeze,
          returnType: { kind: "Poly" },
          calleeEffect: Effect.Read,
          returnValueKind: ValueKind.Frozen,
        }),
      ],
      [
        "createRef",
        addFunction(DEFAULT_SHAPES, [], {
          positionalParams: [],
          restParam: Effect.Capture, // createRef takes no paramters
          returnType: { kind: "Object", shapeId: BuiltInUseRefId },
          calleeEffect: Effect.Read,
          returnValueKind: ValueKind.Mutable,
        }),
      ],
    ]),
  ],
  [
    "_jsx",
    addFunction(DEFAULT_SHAPES, [], {
      positionalParams: [],
      restParam: Effect.Freeze,
      returnType: { kind: "Poly" },
      calleeEffect: Effect.Read,
      returnValueKind: ValueKind.Frozen,
    }),
  ],
);

export type Global = BuiltInType | PolyType;
export type GlobalRegistry = Map<string, Global>;
export const DEFAULT_GLOBALS: GlobalRegistry = new Map(REACT_APIS);

// Hack until we add ObjectShapes for all globals
for (const name of UNTYPED_GLOBALS) {
  DEFAULT_GLOBALS.set(name, {
    kind: "Poly",
  });
}

for (const [name, globalType] of TYPED_GLOBALS) {
  DEFAULT_GLOBALS.set(name, globalType);
}

// Recursive global types
DEFAULT_GLOBALS.set("globalThis", addObject(DEFAULT_SHAPES, "globalThis", TYPED_GLOBALS));
DEFAULT_GLOBALS.set("global", addObject(DEFAULT_SHAPES, "global", TYPED_GLOBALS));

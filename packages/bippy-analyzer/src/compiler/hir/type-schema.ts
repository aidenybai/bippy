/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// Ported from babel-plugin-react-compiler/src/HIR/TypeSchema.ts at b618bbb.

import type { Effect, ValueKind, ValueReason } from "./hir.js";

/*
 * Only the config types are ported. The zod schemas validate user-provided module
 * type configs, which we do not accept: the builtin shapes and the default module
 * type provider declare theirs in this form.
 */

export interface ObjectTypeConfig {
  kind: "object";
  properties: Record<string, TypeConfig> | null;
}

export interface FunctionTypeConfig {
  kind: "function";
  positionalParams: Array<Effect>;
  restParam: Effect | null;
  calleeEffect: Effect;
  returnType: TypeConfig;
  returnValueKind: ValueKind;
  noAlias?: boolean | null | undefined;
  mutableOnlyIfOperandsAreMutable?: boolean | null | undefined;
  impure?: boolean | null | undefined;
  canonicalName?: string | null | undefined;
  aliasing?: AliasingSignatureConfig | null | undefined;
  knownIncompatible?: string | null | undefined;
}

export interface HookTypeConfig {
  kind: "hook";
  positionalParams?: Array<Effect> | null | undefined;
  restParam?: Effect | null | undefined;
  returnType: TypeConfig;
  returnValueKind?: ValueKind | null | undefined;
  noAlias?: boolean | null | undefined;
  aliasing?: AliasingSignatureConfig | null | undefined;
  knownIncompatible?: string | null | undefined;
}

export type BuiltInTypeConfig = "Any" | "Ref" | "Array" | "Primitive" | "MixedReadonly";

export interface TypeReferenceConfig {
  kind: "type";
  name: BuiltInTypeConfig;
}

export type TypeConfig =
  | ObjectTypeConfig
  | FunctionTypeConfig
  | HookTypeConfig
  | TypeReferenceConfig;

export interface FreezeEffectConfig {
  kind: "Freeze";
  value: string;
  reason: ValueReason;
}

export interface MutateEffectConfig {
  kind: "Mutate";
  value: string;
}

export interface MutateTransitiveConditionallyConfig {
  kind: "MutateTransitiveConditionally";
  value: string;
}

export interface CreateEffectConfig {
  kind: "Create";
  into: string;
  value: ValueKind;
  reason: ValueReason;
}

export interface AssignEffectConfig {
  kind: "Assign";
  from: string;
  into: string;
}

export interface AliasEffectConfig {
  kind: "Alias";
  from: string;
  into: string;
}

export interface ImmutableCaptureEffectConfig {
  kind: "ImmutableCapture";
  from: string;
  into: string;
}

export interface CaptureEffectConfig {
  kind: "Capture";
  from: string;
  into: string;
}

export interface CreateFromEffectConfig {
  kind: "CreateFrom";
  from: string;
  into: string;
}

export type ApplyArgConfig = string | { kind: "Spread"; place: string } | { kind: "Hole" };

export interface ApplyEffectConfig {
  kind: "Apply";
  receiver: string;
  function: string;
  mutatesFunction: boolean;
  args: Array<ApplyArgConfig>;
  into: string;
}

export interface ImpureEffectConfig {
  kind: "Impure";
  place: string;
}

export type AliasingEffectConfig =
  | FreezeEffectConfig
  | CreateEffectConfig
  | CreateFromEffectConfig
  | AssignEffectConfig
  | AliasEffectConfig
  | CaptureEffectConfig
  | ImmutableCaptureEffectConfig
  | ImpureEffectConfig
  | MutateEffectConfig
  | MutateTransitiveConditionallyConfig
  | ApplyEffectConfig;

export interface AliasingSignatureConfig {
  receiver: string;
  params: Array<string>;
  rest: string | null;
  returns: string;
  effects: Array<AliasingEffectConfig>;
  temporaries: Array<string>;
}

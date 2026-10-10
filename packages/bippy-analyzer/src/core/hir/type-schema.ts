/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// Ported from babel-plugin-react-compiler/src/HIR/TypeSchema.ts at b618bbb.

import type { ValueKind, ValueReason } from "./hir.js";

/*
 * Only the aliasing signature config types are ported: the builtin shapes in
 * ObjectShape.ts and Globals.ts declare their signatures in this form. The zod
 * schemas validate user-provided module type configs, which we do not accept.
 */

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

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// Ported from babel-plugin-react-compiler/src/Optimization/index.ts at b618bbb.

export { constantPropagation } from "./constant-propagation.js";
export { deadCodeElimination } from "./dead-code-elimination.js";

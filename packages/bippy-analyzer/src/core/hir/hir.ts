/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// Ported from babel-plugin-react-compiler/src/HIR/HIR.ts at b618bbb.

import type { Node, TypeNode } from "typescript/unstable/ast";
import { CompilerDiagnostic, CompilerError, ErrorCategory } from "../compiler-error.js";
import { assertExhaustive } from "../utils/utils.js";
import { isReservedWord } from "../utils/keyword.js";
import { Err, Ok, type Result } from "../utils/result.js";
import type { Environment, ReactFunctionType } from "./environment.js";
import type { HookKind } from "./object-shape.js";
import type { BindingKind } from "./scope.js";
import { type Type, makeType } from "./types.js";

/*
 * *******************************************************************************************
 * *******************************************************************************************
 * ************************************* Core Data Model *************************************
 * *******************************************************************************************
 * *******************************************************************************************
 */

// AST -> (lowering) -> HIR -> (analysis) -> Reactive Scopes -> (codegen) -> AST

/*
 * A location in a source file, intended to be used for providing diagnostic information and
 * transforming code while preserving source information (ie to emit source maps).
 *
 * `GeneratedSource` indicates that there is no single source location from which the code derives.
 */
export const GeneratedSource = Symbol();
export interface SourceRange {
  filename: string;
  start: number;
  end: number;
  line: number;
  column: number;
}
export type SourceLocation = SourceRange | typeof GeneratedSource;

export const getSourceLocation = (node: Node): SourceRange => {
  const sourceFile = node.getSourceFile();
  const start = node.getStart(sourceFile);
  const lineStarts = sourceFile.getLineStarts();
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((lineStarts[middle] ?? 0) <= start) low = middle;
    else high = middle - 1;
  }
  return {
    filename: sourceFile.fileName,
    start,
    end: node.getEnd(),
    line: low + 1,
    column: start - (lineStarts[low] ?? 0),
  };
};

export type LogicalOperator = "||" | "&&" | "??";
export type BinaryOperator =
  | "+"
  | "-"
  | "/"
  | "%"
  | "*"
  | "**"
  | "&"
  | "|"
  | ">>"
  | ">>>"
  | "<<"
  | "^"
  | "=="
  | "==="
  | "!="
  | "!=="
  | "in"
  | "instanceof"
  | ">"
  | "<"
  | ">="
  | "<=";
export type UnaryOperator = "-" | "+" | "!" | "~" | "typeof" | "void";
export type UpdateOperator = "++" | "--";

// A function lowered to HIR form, ie where its body is lowered to an HIR control-flow graph
export interface HIRFunction {
  loc: SourceLocation;
  id: ValidIdentifierName | null;
  nameHint: string | null;
  fnType: ReactFunctionType;
  env: Environment;
  params: Array<Place | SpreadPattern>;
  returnTypeAnnotation: TypeNode | null;
  returns: Place;
  context: Array<Place>;
  body: HIR;
  generator: boolean;
  async: boolean;
  directives: Array<string>;
}

/*
 * Each reactive scope may have its own control-flow, so the instructions form
 * a control-flow graph. The graph comprises a set of basic blocks which reference
 * each other via terminal statements, as well as a reference to the entry block.
 */
export interface HIR {
  entry: BlockId;

  /*
   * Basic blocks are stored as a map to aid certain operations that need to
   * lookup blocks by their id. However, the order of the items in the map is
   * reverse postorder, that is, barring cycles, predecessors appear before
   * successors. This is designed to facilitate forward data flow analysis.
   */
  blocks: Map<BlockId, BasicBlock>;
}

/*
 * Each basic block within an instruction graph contains zero or more instructions
 * followed by a terminal node. Note that basic blocks always execute consecutively,
 * there can be no branching within a block other than for an exception. Exceptions
 * can occur pervasively and React runtime is responsible for resetting state when
 * an exception occurs, therefore the block model only represents explicit throw
 * statements and not implicit exceptions which may occur.
 */
export type BlockKind = "block" | "value" | "loop" | "sequence" | "catch";

/**
 * Returns true for "block" and "catch" block kinds which correspond to statements
 * in the source, including BlockStatement, CatchStatement.
 *
 * Inverse of isExpressionBlockKind()
 */
export const isStatementBlockKind = (kind: BlockKind): boolean =>
  kind === "block" || kind === "catch";

/**
 * Returns true for "value", "loop", and "sequence" block kinds which correspond to
 * expressions in the source, such as ConditionalExpression, LogicalExpression, loop
 * initializer/test/updaters, etc
 *
 * Inverse of isStatementBlockKind()
 */
export const isExpressionBlockKind = (kind: BlockKind): boolean => !isStatementBlockKind(kind);

export interface BasicBlock {
  kind: BlockKind;
  id: BlockId;
  instructions: Array<Instruction>;
  terminal: Terminal;
  preds: Set<BlockId>;
  phis: Set<Phi>;
}
export type TBasicBlock<T extends Terminal> = BasicBlock & { terminal: T };

/*
 * Terminal nodes generally represent statements that affect control flow, such as
 * for-of, if-else, return, etc.
 */
export type Terminal =
  | UnsupportedTerminal
  | UnreachableTerminal
  | ThrowTerminal
  | ReturnTerminal
  | GotoTerminal
  | IfTerminal
  | BranchTerminal
  | SwitchTerminal
  | ForTerminal
  | ForOfTerminal
  | ForInTerminal
  | DoWhileTerminal
  | WhileTerminal
  | LogicalTerminal
  | TernaryTerminal
  | OptionalTerminal
  | LabelTerminal
  | SequenceTerminal
  | MaybeThrowTerminal
  | TryTerminal;

export type TerminalWithFallthrough = Terminal & { fallthrough: BlockId };

/*
 * Terminal nodes allowed for a value block
 * A terminal that couldn't be lowered correctly.
 */
export interface UnsupportedTerminal {
  kind: "unsupported";
  id: InstructionId;
  loc: SourceLocation;
  fallthrough?: never;
}

/**
 * Terminal for an unreachable block.
 * Unreachable blocks are emitted when all control flow paths of a if/switch/try block diverge
 * before reaching the fallthrough.
 */
export interface UnreachableTerminal {
  kind: "unreachable";
  id: InstructionId;
  loc: SourceLocation;
  fallthrough?: never;
}

export interface ThrowTerminal {
  kind: "throw";
  value: Place;
  id: InstructionId;
  loc: SourceLocation;
  fallthrough?: never;
}
export interface Case {
  test: Place | null;
  block: BlockId;
}

export type ReturnVariant = "Void" | "Implicit" | "Explicit";
export interface ReturnTerminal {
  kind: "return";
  /**
   * Void:
   *   () => { ... }
   *   function() { ... }
   * Implicit (ArrowFunctionExpression only):
   *   () => foo
   * Explicit:
   *   () => { return ... }
   *   function () { return ... }
   */
  returnVariant: ReturnVariant;
  loc: SourceLocation;
  value: Place;
  id: InstructionId;
  fallthrough?: never;
}

export interface GotoTerminal {
  kind: "goto";
  block: BlockId;
  variant: GotoVariant;
  id: InstructionId;
  loc: SourceLocation;
  fallthrough?: never;
}

export enum GotoVariant {
  Break = "Break",
  Continue = "Continue",
  Try = "Try",
}

export interface IfTerminal {
  kind: "if";
  test: Place;
  consequent: BlockId;
  alternate: BlockId;
  fallthrough: BlockId;
  id: InstructionId;
  loc: SourceLocation;
}

export interface BranchTerminal {
  kind: "branch";
  test: Place;
  consequent: BlockId;
  alternate: BlockId;
  id: InstructionId;
  loc: SourceLocation;
  fallthrough: BlockId;
}

export interface SwitchTerminal {
  kind: "switch";
  test: Place;
  cases: Array<Case>;
  fallthrough: BlockId;
  id: InstructionId;
  loc: SourceLocation;
}

export interface DoWhileTerminal {
  kind: "do-while";
  loop: BlockId;
  test: BlockId;
  fallthrough: BlockId;
  id: InstructionId;
  loc: SourceLocation;
}

export interface WhileTerminal {
  kind: "while";
  loc: SourceLocation;
  test: BlockId;
  loop: BlockId;
  fallthrough: BlockId;
  id: InstructionId;
}

export interface ForTerminal {
  kind: "for";
  loc: SourceLocation;
  init: BlockId;
  test: BlockId;
  update: BlockId | null;
  loop: BlockId;
  fallthrough: BlockId;
  id: InstructionId;
}

export interface ForOfTerminal {
  kind: "for-of";
  loc: SourceLocation;
  init: BlockId;
  test: BlockId;
  loop: BlockId;
  fallthrough: BlockId;
  id: InstructionId;
}

export interface ForInTerminal {
  kind: "for-in";
  loc: SourceLocation;
  init: BlockId;
  loop: BlockId;
  fallthrough: BlockId;
  id: InstructionId;
}

export interface LogicalTerminal {
  kind: "logical";
  operator: LogicalOperator;
  test: BlockId;
  fallthrough: BlockId;
  id: InstructionId;
  loc: SourceLocation;
}

export interface TernaryTerminal {
  kind: "ternary";
  test: BlockId;
  fallthrough: BlockId;
  id: InstructionId;
  loc: SourceLocation;
}

export interface LabelTerminal {
  kind: "label";
  block: BlockId;
  fallthrough: BlockId;
  id: InstructionId;
  loc: SourceLocation;
}

export interface OptionalTerminal {
  kind: "optional";
  /*
   * Specifies whether this node was optional. If false, it means that the original
   * node was part of an optional chain but this specific item was non-optional.
   * For example, in `a?.b.c?.()`, the `.b` access is non-optional but appears within
   * an optional chain.
   */
  optional: boolean;
  test: BlockId;
  fallthrough: BlockId;
  id: InstructionId;
  loc: SourceLocation;
}

export interface SequenceTerminal {
  kind: "sequence";
  block: BlockId;
  fallthrough: BlockId;
  id: InstructionId;
  loc: SourceLocation;
}

export interface TryTerminal {
  kind: "try";
  block: BlockId;
  handlerBinding: Place | null;
  handler: BlockId;
  // TODO: support `finally`
  fallthrough: BlockId;
  id: InstructionId;
  loc: SourceLocation;
}

export interface MaybeThrowTerminal {
  kind: "maybe-throw";
  continuation: BlockId;
  handler: BlockId | null;
  id: InstructionId;
  loc: SourceLocation;
  fallthrough?: never;
}

/*
 * Instructions generally represent expressions but with all nesting flattened away,
 * such that all operands to each instruction are either primitive values OR are
 * references to a place, which may be a temporary that holds the results of a
 * previous instruction. So `foo(bar(a))` would decompose into two instructions,
 * one to store `tmp0 = bar(a)`, one for `foo(tmp0)`.
 *
 * Instructions generally store their value into a Place, though some instructions
 * may not produce a value that is necessary to track (for example, class definitions)
 * or may occur only for side-effects (many expression statements).
 */
export interface Instruction {
  id: InstructionId;
  lvalue: Place;
  value: InstructionValue;
  loc: SourceLocation;
}

export interface TInstruction<T extends InstructionValue> {
  id: InstructionId;
  lvalue: Place;
  value: T;
  loc: SourceLocation;
}

export interface LValue {
  place: Place;
  kind: InstructionKind;
}

export interface LValuePattern {
  pattern: Pattern;
  kind: InstructionKind;
}

export interface ArrayExpression {
  kind: "ArrayExpression";
  elements: Array<Place | SpreadPattern | Hole>;
  loc: SourceLocation;
}

export type Pattern = ArrayPattern | ObjectPattern;

export interface Hole {
  kind: "Hole";
}

export interface SpreadPattern {
  kind: "Spread";
  place: Place;
}

export interface ArrayPattern {
  kind: "ArrayPattern";
  items: Array<Place | SpreadPattern | Hole>;
  loc: SourceLocation;
}

export interface ObjectPattern {
  kind: "ObjectPattern";
  properties: Array<ObjectProperty | SpreadPattern>;
  loc: SourceLocation;
}

export type ObjectPropertyKey =
  | {
      kind: "string";
      name: string;
    }
  | {
      kind: "identifier";
      name: string;
    }
  | {
      kind: "computed";
      name: Place;
    }
  | {
      kind: "number";
      name: number;
    };

export interface ObjectProperty {
  kind: "ObjectProperty";
  key: ObjectPropertyKey;
  type: "property" | "method";
  place: Place;
}

export interface LoweredFunction {
  func: HIRFunction;
}

export interface ObjectMethod {
  kind: "ObjectMethod";
  loc: SourceLocation;
  loweredFunc: LoweredFunction;
}

export enum InstructionKind {
  // const declaration
  Const = "Const",
  // let declaration
  Let = "Let",
  // assing a new value to a let binding
  Reassign = "Reassign",
  // catch clause binding
  Catch = "Catch",

  // hoisted const declarations
  HoistedConst = "HoistedConst",

  // hoisted const declarations
  HoistedLet = "HoistedLet",

  HoistedFunction = "HoistedFunction",
  Function = "Function",
}

export const convertHoistedLValueKind = (kind: InstructionKind): InstructionKind | null => {
  switch (kind) {
    case InstructionKind.HoistedLet:
      return InstructionKind.Let;
    case InstructionKind.HoistedConst:
      return InstructionKind.Const;
    case InstructionKind.HoistedFunction:
      return InstructionKind.Function;
    case InstructionKind.Let:
    case InstructionKind.Const:
    case InstructionKind.Function:
    case InstructionKind.Reassign:
    case InstructionKind.Catch:
      return null;
    default:
      return assertExhaustive(kind, "Unexpected lvalue kind");
  }
};

export interface Phi {
  kind: "Phi";
  place: Place;
  operands: Map<BlockId, Place>;
}

/**
 * Valid ManualMemoDependencies are always of the form
 * `sourceDeclaredVariable.a.b?.c`, since this is documented
 * and enforced by the `react-hooks/exhaustive-deps` rule.
 *
 * `root` must either reference a ValidatedIdentifier or a global
 * variable.
 */
export interface ManualMemoDependency {
  root:
    | {
        kind: "NamedLocal";
        value: Place;
        constant: boolean;
      }
    | { kind: "Global"; identifierName: string };
  path: DependencyPath;
  loc: SourceLocation;
}

export interface StartMemoize {
  kind: "StartMemoize";
  // Start/FinishMemoize markers should have matching ids
  manualMemoId: number;
  /**
   * deps-list from source code, or null if one was not provided
   * (e.g. useMemo without a second arg)
   */
  deps: Array<ManualMemoDependency> | null;
  /**
   * The source location of the dependencies argument. Used for
   * emitting diagnostics with a suggested replacement
   */
  depsLoc: SourceLocation | null;
  hasInvalidDeps?: true;
  loc: SourceLocation;
}
export interface FinishMemoize {
  kind: "FinishMemoize";
  // Start/FinishMemoize markers should have matching ids
  manualMemoId: number;
  decl: Place;
  pruned?: true;
  loc: SourceLocation;
}

/*
 * Forget currently does not handle MethodCall correctly in
 * all cases. Specifically, we do not bind the receiver and method property
 * before calling to args. Until we add a SequenceExpression to inline all
 * instructions generated when lowering args, we have a limited representation
 * with some constraints.
 *
 * Forget currently makes these assumptions (checked in codegen):
 *   - {@link MethodCall.property} is a temporary produced by a PropertyLoad or ComputedLoad
 *     on {@link MethodCall.receiver}
 *   - {@link MethodCall.property} remains an rval (i.e. never promoted to a
 *     named identifier). We currently rely on this for codegen.
 *
 * Type inference does not currently guarantee that {@link MethodCall.property}
 * is a FunctionType.
 */
export interface MethodCall {
  kind: "MethodCall";
  receiver: Place;
  property: Place;
  args: Array<Place | SpreadPattern>;
  loc: SourceLocation;
}

export interface CallExpression {
  kind: "CallExpression";
  callee: Place;
  args: Array<Place | SpreadPattern>;
  loc: SourceLocation;
}

export interface NewExpression {
  kind: "NewExpression";
  callee: Place;
  args: Array<Place | SpreadPattern>;
  loc: SourceLocation;
}

export interface LoadLocal {
  kind: "LoadLocal";
  place: Place;
  loc: SourceLocation;
}
export interface LoadContext {
  kind: "LoadContext";
  place: Place;
  loc: SourceLocation;
}

/*
 * The value of a given instruction. Note that values are not recursive: complex
 * values such as objects or arrays are always defined by instructions to define
 * their operands (saving to a temporary), then passing those temporaries as
 * the operands to the final instruction (ObjectExpression, ArrayExpression, etc).
 *
 * Operands are therefore always a Place.
 */

export type InstructionValue =
  | LoadLocal
  | LoadContext
  | {
      kind: "DeclareLocal";
      lvalue: LValue;
      type: TypeNode | null;
      loc: SourceLocation;
    }
  | {
      kind: "DeclareContext";
      lvalue: {
        kind:
          | InstructionKind.Let
          | InstructionKind.HoistedConst
          | InstructionKind.HoistedLet
          | InstructionKind.HoistedFunction;
        place: Place;
      };
      loc: SourceLocation;
    }
  | StoreLocal
  | {
      kind: "StoreContext";
      /**
       * StoreContext kinds:
       * Reassign: context variable reassignment in source
       * Const:    const declaration + assignment in source
       *           ('const' context vars are ones whose declarations are hoisted)
       * Let:      let declaration + assignment in source
       * Function: function declaration in source (similar to `const`)
       */
      lvalue: {
        kind:
          | InstructionKind.Reassign
          | InstructionKind.Const
          | InstructionKind.Let
          | InstructionKind.Function;
        place: Place;
      };
      value: Place;
      loc: SourceLocation;
    }
  | Destructure
  | {
      kind: "Primitive";
      value: number | boolean | string | null | undefined;
      loc: SourceLocation;
    }
  | JSXText
  | {
      kind: "BinaryExpression";
      operator: BinaryOperator;
      left: Place;
      right: Place;
      loc: SourceLocation;
    }
  | NewExpression
  | CallExpression
  | MethodCall
  | {
      kind: "UnaryExpression";
      operator: UnaryOperator;
      value: Place;
      loc: SourceLocation;
    }
  | {
      kind: "TypeCastExpression";
      value: Place;
      type: Type;
      typeAnnotation: TypeNode;
      typeAnnotationKind: "as" | "satisfies";
      loc: SourceLocation;
    }
  | JsxExpression
  | {
      kind: "ObjectExpression";
      properties: Array<ObjectProperty | SpreadPattern>;
      loc: SourceLocation;
    }
  | ObjectMethod
  | ArrayExpression
  | { kind: "JsxFragment"; children: Array<Place>; loc: SourceLocation }
  | {
      kind: "RegExpLiteral";
      pattern: string;
      flags: string;
      loc: SourceLocation;
    }
  | {
      kind: "MetaProperty";
      meta: string;
      property: string;
      loc: SourceLocation;
    }

  // store `object.property = value`
  | {
      kind: "PropertyStore";
      object: Place;
      property: PropertyLiteral;
      value: Place;
      loc: SourceLocation;
    }
  // load `object.property`
  | PropertyLoad
  // `delete object.property`
  | {
      kind: "PropertyDelete";
      object: Place;
      property: PropertyLiteral;
      loc: SourceLocation;
    }

  // store `object[index] = value` - like PropertyStore but with a dynamic property
  | {
      kind: "ComputedStore";
      object: Place;
      property: Place;
      value: Place;
      loc: SourceLocation;
    }
  // load `object[index]` - like PropertyLoad but with a dynamic property
  | {
      kind: "ComputedLoad";
      object: Place;
      property: Place;
      loc: SourceLocation;
    }
  // `delete object[property]`
  | {
      kind: "ComputedDelete";
      object: Place;
      property: Place;
      loc: SourceLocation;
    }
  | LoadGlobal
  | StoreGlobal
  | FunctionExpression
  | {
      kind: "TaggedTemplateExpression";
      tag: Place;
      value: { raw: string; cooked?: string };
      loc: SourceLocation;
    }
  | {
      kind: "TemplateLiteral";
      subexprs: Array<Place>;
      quasis: Array<{ raw: string; cooked?: string }>;
      loc: SourceLocation;
    }
  | {
      kind: "Await";
      value: Place;
      loc: SourceLocation;
    }
  | {
      kind: "GetIterator";
      collection: Place; // the collection
      loc: SourceLocation;
    }
  | {
      kind: "IteratorNext";
      iterator: Place; // the iterator created with GetIterator
      collection: Place; // the collection being iterated over (which may be an iterable or iterator)
      loc: SourceLocation;
    }
  | {
      kind: "NextPropertyOf";
      value: Place; // the collection
      loc: SourceLocation;
    }
  /*
   * Models a prefix update expression such as --x or ++y
   * This instructions increments or decrements the <lvalue>
   * but evaluates to the value of <value> prior to the update.
   */
  | {
      kind: "PrefixUpdateLocal";
      lvalue: Place;
      operation: UpdateOperator;
      value: Place;
      loc: SourceLocation;
    }
  | {
      kind: "PrefixUpdateContext";
      lvalue: Place;
      operation: UpdateOperator;
      value: Place;
      loc: SourceLocation;
    }
  /*
   * Models a postfix update expression such as x-- or y++
   * This instructions increments or decrements the <lvalue>
   * and evaluates to the value after the update
   */
  | {
      kind: "PostfixUpdateLocal";
      lvalue: Place;
      operation: UpdateOperator;
      value: Place;
      loc: SourceLocation;
    }
  | {
      kind: "PostfixUpdateContext";
      lvalue: Place;
      operation: UpdateOperator;
      value: Place;
      loc: SourceLocation;
    }
  // `debugger` statement
  | { kind: "Debugger"; loc: SourceLocation }
  /*
   * Represents semantic information from useMemo/useCallback that the developer
   * has indicated a particular value should be memoized. This value is ignored
   * unless the TODO flag is enabled.
   *
   * NOTE: the Memoize instruction is intended for side-effects only, and is pruned
   * during codegen. It can't be pruned during DCE because we need to preserve the
   * instruction so it can be visible in InferReferenceEffects.
   */
  | StartMemoize
  | FinishMemoize
  /*
   * Catch-all for statements such as type imports, nested class declarations, etc
   * which are not directly represented, but included for completeness and to allow
   * passing through in codegen.
   */
  | {
      kind: "UnsupportedNode";
      node: Node;
      loc: SourceLocation;
    };

export interface JsxExpression {
  kind: "JsxExpression";
  tag: Place | BuiltinTag;
  props: Array<JsxAttribute>;
  children: Array<Place> | null; // null === no children
  loc: SourceLocation;
  openingLoc: SourceLocation;
  closingLoc: SourceLocation;
}

export type JsxAttribute =
  | { kind: "JsxSpreadAttribute"; argument: Place }
  | { kind: "JsxAttribute"; name: string; place: Place };

export interface FunctionExpression {
  kind: "FunctionExpression";
  name: ValidIdentifierName | null;
  nameHint: string | null;
  loweredFunc: LoweredFunction;
  type: "ArrowFunctionExpression" | "FunctionExpression" | "FunctionDeclaration";
  loc: SourceLocation;
}

export interface Destructure {
  kind: "Destructure";
  lvalue: LValuePattern;
  value: Place;
  loc: SourceLocation;
}

/*
 * A place where data may be read from / written to:
 * - a variable (identifier)
 * - a path into an identifier
 */
export interface Place {
  kind: "Identifier";
  identifier: Identifier;
  loc: SourceLocation;
}

// A primitive value with a specific (constant) value.
export interface Primitive {
  kind: "Primitive";
  value: number | boolean | string | null | undefined;
  loc: SourceLocation;
}

export interface JSXText {
  kind: "JSXText";
  value: string;
  loc: SourceLocation;
}

export interface StoreLocal {
  kind: "StoreLocal";
  lvalue: LValue;
  value: Place;
  type: TypeNode | null;
  loc: SourceLocation;
}
export interface PropertyLoad {
  kind: "PropertyLoad";
  object: Place;
  property: PropertyLiteral;
  loc: SourceLocation;
}

export interface LoadGlobal {
  kind: "LoadGlobal";
  binding: NonLocalBinding;
  loc: SourceLocation;
}

export interface StoreGlobal {
  kind: "StoreGlobal";
  name: string;
  value: Place;
  loc: SourceLocation;
}

export interface BuiltinTag {
  kind: "BuiltinTag";
  name: string;
  loc: SourceLocation;
}

export type VariableBinding =
  // let, const, etc declared within the current component/hook
  | { kind: "Identifier"; identifier: Identifier; bindingKind: BindingKind }
  // bindings declard outside the current component/hook
  | NonLocalBinding;

// `import {bar as baz} from 'foo'`: name=baz, module=foo, imported=bar
export interface NonLocalImportSpecifier {
  kind: "ImportSpecifier";
  name: string;
  module: string;
  imported: string;
}

export type NonLocalBinding =
  // `import Foo from 'foo'`: name=Foo, module=foo
  | { kind: "ImportDefault"; name: string; module: string }
  // `import * as Foo from 'foo'`: name=Foo, module=foo
  | { kind: "ImportNamespace"; name: string; module: string }
  // `import {bar as baz} from 'foo'`
  | NonLocalImportSpecifier
  // let, const, function, etc declared in the module but outside the current component/hook
  | { kind: "ModuleLocal"; name: string }
  // an unresolved binding
  | { kind: "Global"; name: string };

// Represents a user-defined variable (has a name) or a temporary variable (no name).
export interface Identifier {
  /**
   * After EnterSSA, `id` uniquely identifies an SSA instance of a variable.
   * Before EnterSSA, `id` matches `declarationId`.
   */
  id: IdentifierId;

  /**
   * Uniquely identifies a given variable in the original program. If a value is
   * reassigned in the original program each reassigned value will have a distinct
   * `id` (after EnterSSA), but they will still have the same `declarationId`.
   */
  declarationId: DeclarationId;

  // null for temporaries. name is primarily used for debugging.
  name: IdentifierName | null;
  type: Type;
  loc: SourceLocation;
}

export type IdentifierName = ValidatedIdentifier | PromotedIdentifier;
export interface ValidatedIdentifier {
  kind: "named";
  value: ValidIdentifierName;
}
export interface PromotedIdentifier {
  kind: "promoted";
  value: string;
}

/**
 * Simulated opaque type for identifier names to ensure values can only be created
 * through the below helpers.
 */
const opaqueValidIdentifierName = Symbol();
export type ValidIdentifierName = string & {
  [opaqueValidIdentifierName]: "ValidIdentifierName";
};

export const makeTemporaryIdentifier = (
  identifierId: IdentifierId,
  loc: SourceLocation,
): Identifier => ({
  id: identifierId,
  name: null,
  declarationId: makeDeclarationId(identifierId),
  type: makeType(),
  loc,
});

export const forkTemporaryIdentifier = (
  identifierId: IdentifierId,
  source: Identifier,
): Identifier => ({
  ...source,
  id: identifierId,
});

export const validateIdentifierName = (
  name: string,
): Result<ValidatedIdentifier, CompilerError> => {
  if (isReservedWord(name)) {
    const error = new CompilerError();
    error.pushDiagnostic(
      CompilerDiagnostic.create({
        category: ErrorCategory.Syntax,
        reason: "Expected a non-reserved identifier name",
        description: `\`${name}\` is a reserved word in JavaScript and cannot be used as an identifier name`,
        suggestions: null,
      }).withDetails({
        kind: "error",
        loc: GeneratedSource,
        message: "reserved word",
      }),
    );
    return Err(error);
  }
  return Ok({
    kind: "named",
    value: name as ValidIdentifierName,
  });
};

/**
 * Creates a valid identifier name. This should *not* be used for synthesizing
 * identifier names: only call this method for identifier names that appear in the
 * original source code.
 */
export const makeIdentifierName = (name: string): ValidatedIdentifier =>
  validateIdentifierName(name).unwrap();

/**
 * Given an unnamed identifier, promote it to a named identifier.
 *
 * Note: this uses the identifier's DeclarationId to ensure that all
 * instances of the same declaration will have the same name.
 */
export const promoteTemporary = (identifier: Identifier): void => {
  CompilerError.invariant(identifier.name === null, {
    reason: `Expected a temporary (unnamed) identifier`,
    description: `Identifier already has a name, \`${identifier.name?.value}\``,
    loc: GeneratedSource,
  });
  identifier.name = {
    kind: "promoted",
    value: `#t${identifier.declarationId}`,
  };
};

export const isPromotedTemporary = (name: string): boolean => name.startsWith("#t");

/**
 * Given an unnamed identifier, promote it to a named identifier, distinguishing
 * it as a value that needs to be capitalized since it appears in JSX element tag position
 *
 * Note: this uses the identifier's DeclarationId to ensure that all
 * instances of the same declaration will have the same name.
 */
export const promoteTemporaryJsxTag = (identifier: Identifier): void => {
  CompilerError.invariant(identifier.name === null, {
    reason: `Expected a temporary (unnamed) identifier`,
    description: `Identifier already has a name, \`${identifier.name?.value}\``,
    loc: GeneratedSource,
  });
  identifier.name = {
    kind: "promoted",
    value: `#T${identifier.declarationId}`,
  };
};

export const isPromotedJsxTemporary = (name: string): boolean => name.startsWith("#T");

/**
 * The reason for the kind of a value.
 */
export enum ValueReason {
  /**
   * Defined outside the React function.
   */
  Global = "global",

  /**
   * Used in a JSX expression.
   */
  JsxCaptured = "jsx-captured",

  /**
   * Argument to a hook
   */
  HookCaptured = "hook-captured",

  /**
   * Return value of a hook
   */
  HookReturn = "hook-return",

  /**
   * Passed to an effect
   */
  Effect = "effect",

  /**
   * Return value of a function with known frozen return value, e.g. `useState`.
   */
  KnownReturnSignature = "known-return-signature",

  /**
   * A value returned from `useContext`
   */
  Context = "context",

  /**
   * A value returned from `useState`
   */
  State = "state",

  /**
   * A value returned from `useReducer`
   */
  ReducerState = "reducer-state",

  /**
   * Props of a component or arguments of a hook.
   */
  ReactiveFunctionArgument = "reactive-function-argument",

  Other = "other",
}

/*
 * Distinguish between different kinds of values relevant to inference purposes:
 * see the main docblock for the module for details.
 */
export enum ValueKind {
  MaybeFrozen = "maybefrozen",
  Frozen = "frozen",
  Primitive = "primitive",
  Global = "global",
  Mutable = "mutable",
  Context = "context",
}

// The effect with which a value is modified.
export enum Effect {
  // Default value: not allowed after lifetime inference
  Unknown = "<unknown>",
  // This reference freezes the value (corresponds to a place where codegen should emit a freeze instruction)
  Freeze = "freeze",
  // This reference reads the value
  Read = "read",
  // This reference reads and stores the value
  Capture = "capture",
  ConditionallyMutateIterator = "mutate-iterator?",
  /*
   * This reference *may* write to (mutate) the value. This covers two similar cases:
   * - The compiler is being conservative and assuming that a value *may* be mutated
   * - The effect is polymorphic: mutable values may be mutated, non-mutable values
   *   will not be mutated.
   * In both cases, we conservatively assume that mutable values will be mutated.
   * But we do not error if the value is known to be immutable.
   */
  ConditionallyMutate = "mutate?",

  /*
   * This reference *does* write to (mutate) the value. It is an error (invalid input)
   * if an immutable value flows into a location with this effect.
   */
  Mutate = "mutate",
  // This reference may alias to (mutate) the value
  Store = "store",
}

const opaquePropertyLiteral = Symbol();
export type PropertyLiteral = (string | number) & {
  [opaquePropertyLiteral]: "PropertyLiteral";
};
export const makePropertyLiteral = (value: string | number): PropertyLiteral =>
  value as PropertyLiteral;
export interface DependencyPathEntry {
  property: PropertyLiteral;
  optional: boolean;
  loc: SourceLocation;
}
export type DependencyPath = Array<DependencyPathEntry>;

/*
 * Simulated opaque type for BlockIds to prevent using normal numbers as block ids
 * accidentally.
 */
const opaqueBlockId = Symbol();
export type BlockId = number & { [opaqueBlockId]: "BlockId" };

export const makeBlockId = (value: number): BlockId => {
  CompilerError.invariant(value >= 0 && Number.isInteger(value), {
    reason: "Expected block id to be a non-negative integer",
    loc: GeneratedSource,
  });
  return value as BlockId;
};

/*
 * Simulated opaque type for IdentifierId to prevent using normal numbers as ids
 * accidentally.
 */
const opaqueIdentifierId = Symbol();
export type IdentifierId = number & { [opaqueIdentifierId]: "IdentifierId" };

export const makeIdentifierId = (value: number): IdentifierId => {
  CompilerError.invariant(value >= 0 && Number.isInteger(value), {
    reason: "Expected identifier id to be a non-negative integer",
    loc: GeneratedSource,
  });
  return value as IdentifierId;
};

/*
 * Simulated opaque type for IdentifierId to prevent using normal numbers as ids
 * accidentally.
 */
const opageDeclarationId = Symbol();
export type DeclarationId = number & { [opageDeclarationId]: "DeclarationId" };

export const makeDeclarationId = (value: number): DeclarationId => {
  CompilerError.invariant(value >= 0 && Number.isInteger(value), {
    reason: "Expected declaration id to be a non-negative integer",
    loc: GeneratedSource,
  });
  return value as DeclarationId;
};

/*
 * Simulated opaque type for InstructionId to prevent using normal numbers as ids
 * accidentally.
 */
const opaqueInstructionId = Symbol();
export type InstructionId = number & { [opaqueInstructionId]: "IdentifierId" };

export const makeInstructionId = (value: number): InstructionId => {
  CompilerError.invariant(value >= 0 && Number.isInteger(value), {
    reason: "Expected instruction id to be a non-negative integer",
    loc: GeneratedSource,
  });
  return value as InstructionId;
};

export const isObjectMethodType = (identifier: Identifier): boolean =>
  identifier.type.kind === "ObjectMethod";

export const isObjectType = (identifier: Identifier): boolean => identifier.type.kind === "Object";

export const isPrimitiveType = (identifier: Identifier): boolean =>
  identifier.type.kind === "Primitive";

export const isPlainObjectType = (identifier: Identifier): boolean =>
  identifier.type.kind === "Object" && identifier.type.shapeId === "BuiltInObject";

export const isArrayType = (identifier: Identifier): boolean =>
  identifier.type.kind === "Object" && identifier.type.shapeId === "BuiltInArray";

export const isMapType = (identifier: Identifier): boolean =>
  identifier.type.kind === "Object" && identifier.type.shapeId === "BuiltInMap";

export const isSetType = (identifier: Identifier): boolean =>
  identifier.type.kind === "Object" && identifier.type.shapeId === "BuiltInSet";

export const isPropsType = (identifier: Identifier): boolean =>
  identifier.type.kind === "Object" && identifier.type.shapeId === "BuiltInProps";

export const isRefValueType = (identifier: Identifier): boolean =>
  identifier.type.kind === "Object" && identifier.type.shapeId === "BuiltInRefValue";

export const isUseRefType = (identifier: Identifier): boolean =>
  identifier.type.kind === "Object" && identifier.type.shapeId === "BuiltInUseRefId";

export const isUseStateType = (identifier: Identifier): boolean =>
  identifier.type.kind === "Object" && identifier.type.shapeId === "BuiltInUseState";

export const isJsxType = (type: Type): boolean =>
  type.kind === "Object" && type.shapeId === "BuiltInJsx";

export const isRefOrRefValue = (identifier: Identifier): boolean =>
  isUseRefType(identifier) || isRefValueType(identifier);

/*
 * Returns true if the type is a Ref or a custom user type that acts like a ref when it
 * shouldn't. For now the only other case of this is Reanimated's shared values.
 */
export const isRefOrRefLikeMutableType = (type: Type): boolean =>
  type.kind === "Object" &&
  (type.shapeId === "BuiltInUseRefId" || type.shapeId === "ReanimatedSharedValueId");

export const isSetStateType = (identifier: Identifier): boolean =>
  identifier.type.kind === "Function" && identifier.type.shapeId === "BuiltInSetState";

export const isUseActionStateType = (identifier: Identifier): boolean =>
  identifier.type.kind === "Object" && identifier.type.shapeId === "BuiltInUseActionState";

export const isStartTransitionType = (identifier: Identifier): boolean =>
  identifier.type.kind === "Function" && identifier.type.shapeId === "BuiltInStartTransition";

export const isUseOptimisticType = (identifier: Identifier): boolean =>
  identifier.type.kind === "Object" && identifier.type.shapeId === "BuiltInUseOptimistic";

export const isSetOptimisticType = (identifier: Identifier): boolean =>
  identifier.type.kind === "Function" && identifier.type.shapeId === "BuiltInSetOptimistic";

export const isSetActionStateType = (identifier: Identifier): boolean =>
  identifier.type.kind === "Function" && identifier.type.shapeId === "BuiltInSetActionState";

export const isUseReducerType = (identifier: Identifier): boolean =>
  identifier.type.kind === "Function" && identifier.type.shapeId === "BuiltInUseReducer";

export const isDispatcherType = (identifier: Identifier): boolean =>
  identifier.type.kind === "Function" && identifier.type.shapeId === "BuiltInDispatch";

export const isEffectEventFunctionType = (identifier: Identifier): boolean =>
  identifier.type.kind === "Function" && identifier.type.shapeId === "BuiltInEffectEventFunction";

export const isStableType = (identifier: Identifier): boolean =>
  isSetStateType(identifier) ||
  isSetActionStateType(identifier) ||
  isDispatcherType(identifier) ||
  isUseRefType(identifier) ||
  isStartTransitionType(identifier) ||
  isSetOptimisticType(identifier);

export const isStableTypeContainer = (identifier: Identifier): boolean => {
  const type = identifier.type;
  if (type.kind !== "Object") {
    return false;
  }
  return (
    isUseStateType(identifier) || // setState
    isUseActionStateType(identifier) || // setActionState
    isUseReducerType(identifier) || // dispatcher
    isUseOptimisticType(identifier) || // setOptimistic
    type.shapeId === "BuiltInUseTransition" // startTransition
  );
};

export const evaluatesToStableTypeOrContainer = (
  env: Environment,
  instruction: Instruction,
): boolean => {
  const value = instruction.value;
  if (value.kind === "CallExpression" || value.kind === "MethodCall") {
    const callee = value.kind === "CallExpression" ? value.callee : value.property;

    const calleeHookKind = getHookKind(env, callee.identifier);
    switch (calleeHookKind) {
      case "useState":
      case "useReducer":
      case "useActionState":
      case "useRef":
      case "useTransition":
      case "useOptimistic":
        return true;
    }
  }
  return false;
};

export const isUseEffectHookType = (identifier: Identifier): boolean =>
  identifier.type.kind === "Function" && identifier.type.shapeId === "BuiltInUseEffectHook";
export const isUseLayoutEffectHookType = (identifier: Identifier): boolean =>
  identifier.type.kind === "Function" && identifier.type.shapeId === "BuiltInUseLayoutEffectHook";
export const isUseInsertionEffectHookType = (identifier: Identifier): boolean =>
  identifier.type.kind === "Function" &&
  identifier.type.shapeId === "BuiltInUseInsertionEffectHook";
export const isUseEffectEventType = (identifier: Identifier): boolean =>
  identifier.type.kind === "Function" && identifier.type.shapeId === "BuiltInUseEffectEvent";

export const isUseContextHookType = (identifier: Identifier): boolean =>
  identifier.type.kind === "Function" && identifier.type.shapeId === "BuiltInUseContextHook";

export const getHookKind = (env: Environment, identifier: Identifier): HookKind | null =>
  getHookKindForType(env, identifier.type);

export const isUseOperator = (identifier: Identifier): boolean =>
  identifier.type.kind === "Function" && identifier.type.shapeId === "BuiltInUseOperator";

export const getHookKindForType = (env: Environment, type: Type): HookKind | null => {
  if (type.kind === "Function") {
    const signature = env.getFunctionSignature(type);
    return signature?.hookKind ?? null;
  }
  return null;
};

export * from "./types.js";

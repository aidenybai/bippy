/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// Ported from babel-plugin-react-compiler/src/HIR/HIR.ts at b618bbb.

import type { Node, TypeNode } from "typescript/unstable/ast";
import { CompilerError, CompilerErrorDetail, ErrorCategory } from "../compiler-error.js";
import { isReservedWord } from "../utils/keyword.js";
import { Err, Ok, type Result } from "../utils/result.js";
import type { Environment, ReactFunctionType } from "./environment.js";
import type { BindingKind } from "./scope.js";

/*
 * *******************************************************************************************
 * *******************************************************************************************
 * ************************************* Core Data Model *************************************
 * *******************************************************************************************
 * *******************************************************************************************
 */

/*
 * A location in a source file, intended to be used for providing diagnostic information and
 * transforming code while preserving source information (ie to emit source maps).
 *
 * `GeneratedSource` indicates that there is no single source location from which the code derives.
 */
export const GeneratedSource = Symbol();
interface SourceRange {
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
type UpdateOperator = "++" | "--";

// A function lowered to HIR form, ie where its body is lowered to an HIR control-flow graph
export interface HIRFunction {
  loc: SourceLocation;
  id: ValidIdentifierName | null;
  fnType: ReactFunctionType;
  env: Environment;
  params: Array<Place | SpreadPattern>;
  returns: Place;
  context: Array<Place>;
  body: HIR;
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

export interface BasicBlock {
  kind: BlockKind;
  id: BlockId;
  instructions: Array<Instruction>;
  terminal: Terminal;
  preds: Set<BlockId>;
  phis: Set<Phi>;
}
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

interface UnsupportedTerminal {
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
interface UnreachableTerminal {
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

type ReturnVariant = "Void" | "Implicit" | "Explicit";
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

interface GotoTerminal {
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

interface SwitchTerminal {
  kind: "switch";
  test: Place;
  cases: Array<Case>;
  fallthrough: BlockId;
  id: InstructionId;
  loc: SourceLocation;
}

interface DoWhileTerminal {
  kind: "do-while";
  loop: BlockId;
  test: BlockId;
  fallthrough: BlockId;
  id: InstructionId;
  loc: SourceLocation;
}

interface WhileTerminal {
  kind: "while";
  loc: SourceLocation;
  test: BlockId;
  loop: BlockId;
  fallthrough: BlockId;
  id: InstructionId;
}

interface ForTerminal {
  kind: "for";
  loc: SourceLocation;
  init: BlockId;
  test: BlockId;
  update: BlockId | null;
  loop: BlockId;
  fallthrough: BlockId;
  id: InstructionId;
}

interface ForOfTerminal {
  kind: "for-of";
  loc: SourceLocation;
  init: BlockId;
  test: BlockId;
  loop: BlockId;
  fallthrough: BlockId;
  id: InstructionId;
}

interface ForInTerminal {
  kind: "for-in";
  loc: SourceLocation;
  init: BlockId;
  loop: BlockId;
  fallthrough: BlockId;
  id: InstructionId;
}

interface LogicalTerminal {
  kind: "logical";
  operator: LogicalOperator;
  test: BlockId;
  fallthrough: BlockId;
  id: InstructionId;
  loc: SourceLocation;
}

interface TernaryTerminal {
  kind: "ternary";
  test: BlockId;
  fallthrough: BlockId;
  id: InstructionId;
  loc: SourceLocation;
}

interface LabelTerminal {
  kind: "label";
  block: BlockId;
  fallthrough: BlockId;
  id: InstructionId;
  loc: SourceLocation;
}

interface OptionalTerminal {
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

interface SequenceTerminal {
  kind: "sequence";
  block: BlockId;
  fallthrough: BlockId;
  id: InstructionId;
  loc: SourceLocation;
}

interface TryTerminal {
  kind: "try";
  block: BlockId;
  handlerBinding: Place | null;
  handler: BlockId;
  // TODO: support `finally`
  fallthrough: BlockId;
  id: InstructionId;
  loc: SourceLocation;
}

interface MaybeThrowTerminal {
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

interface LValue {
  place: Place;
  kind: InstructionKind;
}

interface LValuePattern {
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

export interface Phi {
  kind: "Phi";
  place: Place;
  operands: Map<BlockId, Place>;
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
}

export type JsxAttribute =
  | { kind: "JsxSpreadAttribute"; argument: Place }
  | { kind: "JsxAttribute"; name: string; place: Place };

export interface FunctionExpression {
  kind: "FunctionExpression";
  name: ValidIdentifierName | null;
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
interface NonLocalImportSpecifier {
  kind: "ImportSpecifier";
  name: string;
  module: string;
  imported: string;
}

type NonLocalBinding =
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
  loc: SourceLocation;
}

export type IdentifierName = ValidatedIdentifier | PromotedIdentifier;
interface ValidatedIdentifier {
  kind: "named";
  value: ValidIdentifierName;
}
interface PromotedIdentifier {
  kind: "promoted";
  value: string;
}

/**
 * Simulated opaque type for identifier names to ensure values can only be created
 * through the below helpers.
 */
const opaqueValidIdentifierName = Symbol();
type ValidIdentifierName = string & {
  [opaqueValidIdentifierName]: "ValidIdentifierName";
};

export const makeTemporaryIdentifier = (
  identifierId: IdentifierId,
  loc: SourceLocation,
): Identifier => ({
  id: identifierId,
  name: null,
  declarationId: makeDeclarationId(identifierId),
  loc,
});

export const validateIdentifierName = (
  name: string,
): Result<ValidatedIdentifier, CompilerError> => {
  if (isReservedWord(name)) {
    const error = new CompilerError();
    error.details.push(
      new CompilerErrorDetail({
        category: ErrorCategory.Syntax,
        reason: "Expected a non-reserved identifier name",
        description: `\`${name}\` is a reserved word in JavaScript and cannot be used as an identifier name`,
        loc: GeneratedSource,
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

const opaquePropertyLiteral = Symbol();
export type PropertyLiteral = (string | number) & {
  [opaquePropertyLiteral]: "PropertyLiteral";
};
export const makePropertyLiteral = (value: string | number): PropertyLiteral =>
  value as PropertyLiteral;
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
type DeclarationId = number & { [opageDeclarationId]: "DeclarationId" };

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

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// Ported from babel-plugin-react-compiler/src/HIR/PrintHIR.ts at b618bbb.

import { SyntaxKind } from "typescript/unstable/ast";
import type { AliasingEffect, AliasingSignature } from "../compiler-inference/aliasing-effects.js";
import { CompilerError } from "../compiler-error.js";
import { assertExhaustive } from "../utils/utils.js";
import {
  type FunctionExpression,
  GotoVariant,
  type HIR,
  type HIRFunction,
  type Identifier,
  type IdentifierName,
  type Instruction,
  InstructionKind,
  type InstructionValue,
  type LValue,
  type ManualMemoDependency,
  type MutableRange,
  type ObjectMethod,
  type ObjectPropertyKey,
  type Pattern,
  type Phi,
  type Place,
  type ReactiveScope,
  type SourceLocation,
  type SpreadPattern,
  type Terminal,
  type Type,
} from "./hir.js";

export interface Options {
  indent: number;
}

export const printFunction = (fn: HIRFunction): string => {
  const name = fn.id !== null ? fn.id : "<<anonymous>>";
  const nameHint = fn.nameHint !== null ? ` ${fn.nameHint}` : "";
  const params =
    fn.params.length !== 0
      ? "(" +
        fn.params
          .map((param) => {
            if (param.kind === "Identifier") {
              return printPlace(param);
            }
            return `...${printPlace(param.place)}`;
          })
          .join(", ") +
        ")"
      : "()";
  const definition = `${name}${nameHint}${params}: ${printPlace(fn.returns)}`;
  return [definition, ...fn.directives, printHIR(fn.body)].join("\n");
};

export const printHIR = (ir: HIR, options: Options | null = null): string => {
  const output: Array<string> = [];
  const indent = " ".repeat(options?.indent ?? 0);
  const push = (text: string, indent: string = "  "): void => {
    output.push(`${indent}${text}`);
  };
  for (const [blockId, block] of ir.blocks) {
    output.push(`bb${blockId} (${block.kind}):`);
    if (block.preds.size > 0) {
      const preds = ["predecessor blocks:"];
      for (const pred of block.preds) {
        preds.push(`bb${pred}`);
      }
      push(preds.join(" "));
    }
    for (const phi of block.phis) {
      push(printPhi(phi));
    }
    for (const instr of block.instructions) {
      push(printInstruction(instr));
    }
    const terminal = printTerminal(block.terminal);
    if (Array.isArray(terminal)) {
      terminal.forEach((line) => push(line));
    } else {
      push(terminal);
    }
  }
  return output.map((line) => indent + line).join("\n");
};

export const printMixedHIR = (value: Instruction | InstructionValue | Terminal): string => {
  if (!("kind" in value)) {
    return printInstruction(value);
  }
  switch (value.kind) {
    case "try":
    case "maybe-throw":
    case "sequence":
    case "label":
    case "optional":
    case "branch":
    case "if":
    case "logical":
    case "ternary":
    case "return":
    case "switch":
    case "throw":
    case "while":
    case "for":
    case "unreachable":
    case "unsupported":
    case "goto":
    case "do-while":
    case "for-in":
    case "for-of": {
      const terminal = printTerminal(value);
      if (Array.isArray(terminal)) {
        return terminal.join("; ");
      }
      return terminal;
    }
    default: {
      return printInstructionValue(value);
    }
  }
};

export const printInstruction = (instr: Instruction): string => {
  const id = `[${instr.id}]`;
  const value =
    instr.effects !== null
      ? `${printInstructionValue(instr.value)}\n    ${instr.effects.map(printAliasingEffect).join("\n    ")}`
      : printInstructionValue(instr.value);
  return `${id} ${printPlace(instr.lvalue)} = ${value}`;
};

export const printPhi = (phi: Phi): string => {
  const items = [];
  items.push(printPlace(phi.place));
  items.push(printMutableRange(phi.place.identifier));
  items.push(printType(phi.place.identifier.type));
  items.push(": phi(");
  const phis = [];
  for (const [blockId, place] of phi.operands) {
    phis.push(`bb${blockId}: ${printPlace(place)}`);
  }

  items.push(phis.join(", "));
  items.push(")");
  return items.join("");
};

export const printTerminal = (terminal: Terminal): Array<string> | string => {
  switch (terminal.kind) {
    case "if": {
      return `[${terminal.id}] If (${printPlace(terminal.test)}) then:bb${
        terminal.consequent
      } else:bb${terminal.alternate}${
        terminal.fallthrough ? ` fallthrough=bb${terminal.fallthrough}` : ""
      }`;
    }
    case "branch": {
      return `[${terminal.id}] Branch (${printPlace(terminal.test)}) then:bb${
        terminal.consequent
      } else:bb${terminal.alternate} fallthrough:bb${terminal.fallthrough}`;
    }
    case "logical": {
      return `[${terminal.id}] Logical ${terminal.operator} test:bb${terminal.test} fallthrough=bb${terminal.fallthrough}`;
    }
    case "ternary": {
      return `[${terminal.id}] Ternary test:bb${terminal.test} fallthrough=bb${terminal.fallthrough}`;
    }
    case "optional": {
      return `[${terminal.id}] Optional (optional=${terminal.optional}) test:bb${terminal.test} fallthrough=bb${terminal.fallthrough}`;
    }
    case "throw": {
      return `[${terminal.id}] Throw ${printPlace(terminal.value)}`;
    }
    case "return": {
      const value = `[${terminal.id}] Return ${terminal.returnVariant} ${printPlace(terminal.value)}`;
      return terminal.effects !== null
        ? `${value}\n    ${terminal.effects.map(printAliasingEffect).join("\n    ")}`
        : value;
    }
    case "goto": {
      return `[${terminal.id}] Goto${
        terminal.variant === GotoVariant.Continue ? "(Continue)" : ""
      } bb${terminal.block}`;
    }
    case "switch": {
      const output = [];
      output.push(`[${terminal.id}] Switch (${printPlace(terminal.test)})`);
      terminal.cases.forEach((switchCase) => {
        if (switchCase.test !== null) {
          output.push(`  Case ${printPlace(switchCase.test)}: bb${switchCase.block}`);
        } else {
          output.push(`  Default: bb${switchCase.block}`);
        }
      });
      if (terminal.fallthrough) {
        output.push(`  Fallthrough: bb${terminal.fallthrough}`);
      }
      return output;
    }
    case "do-while": {
      return `[${terminal.id}] DoWhile loop=${`bb${terminal.loop}`} test=bb${
        terminal.test
      } fallthrough=${`bb${terminal.fallthrough}`}`;
    }
    case "while": {
      return `[${terminal.id}] While test=bb${terminal.test} loop=bb${terminal.loop} fallthrough=${
        terminal.fallthrough ? `bb${terminal.fallthrough}` : ""
      }`;
    }
    case "for": {
      return `[${terminal.id}] For init=bb${terminal.init} test=bb${terminal.test} loop=bb${terminal.loop} update=bb${terminal.update} fallthrough=bb${terminal.fallthrough}`;
    }
    case "for-of": {
      return `[${terminal.id}] ForOf init=bb${terminal.init} test=bb${terminal.test} loop=bb${terminal.loop} fallthrough=bb${terminal.fallthrough}`;
    }
    case "for-in": {
      return `[${terminal.id}] ForIn init=bb${terminal.init} loop=bb${terminal.loop} fallthrough=bb${terminal.fallthrough}`;
    }
    case "label": {
      return `[${terminal.id}] Label block=bb${terminal.block} fallthrough=${
        terminal.fallthrough ? `bb${terminal.fallthrough}` : ""
      }`;
    }
    case "sequence": {
      return `[${terminal.id}] Sequence block=bb${terminal.block} fallthrough=bb${terminal.fallthrough}`;
    }
    case "unreachable": {
      return `[${terminal.id}] Unreachable`;
    }
    case "unsupported": {
      return `[${terminal.id}] Unsupported`;
    }
    case "maybe-throw": {
      const handlerStr = terminal.handler !== null ? `bb${terminal.handler}` : "(none)";
      const value = `[${terminal.id}] MaybeThrow continuation=bb${terminal.continuation} handler=${handlerStr}`;
      return terminal.effects !== null
        ? `${value}\n    ${terminal.effects.map(printAliasingEffect).join("\n    ")}`
        : value;
    }
    case "try": {
      return `[${terminal.id}] Try block=bb${terminal.block} handler=bb${terminal.handler}${
        terminal.handlerBinding !== null
          ? ` handlerBinding=(${printPlace(terminal.handlerBinding)})`
          : ""
      } fallthrough=bb${terminal.fallthrough}`;
    }
    default: {
      return assertExhaustive(terminal, `Unexpected terminal kind \`${terminal}\``);
    }
  }
};

const printHole = (): string => "<hole>";

const printObjectPropertyKey = (key: ObjectPropertyKey): string => {
  switch (key.kind) {
    case "identifier":
      return key.name;
    case "string":
      return `"${key.name}"`;
    case "computed": {
      return `[${printPlace(key.name)}]`;
    }
    case "number": {
      return String(key.name);
    }
  }
};

export const printInstructionValue = (instrValue: InstructionValue): string => {
  switch (instrValue.kind) {
    case "ArrayExpression": {
      return `Array [${instrValue.elements
        .map((element) => {
          if (element.kind === "Identifier") {
            return printPlace(element);
          } else if (element.kind === "Hole") {
            return printHole();
          }
          return `...${printPlace(element.place)}`;
        })
        .join(", ")}]`;
    }
    case "ObjectExpression": {
      const properties = [];
      for (const property of instrValue.properties) {
        if (property.kind === "ObjectProperty") {
          properties.push(`${printObjectPropertyKey(property.key)}: ${printPlace(property.place)}`);
        } else {
          properties.push(`...${printPlace(property.place)}`);
        }
      }
      return `Object { ${properties.join(", ")} }`;
    }
    case "UnaryExpression": {
      return `Unary ${printPlace(instrValue.value)}`;
    }
    case "BinaryExpression": {
      return `Binary ${printPlace(instrValue.left)} ${instrValue.operator} ${printPlace(
        instrValue.right,
      )}`;
    }
    case "NewExpression": {
      return `New ${printPlace(instrValue.callee)}(${instrValue.args
        .map((arg) => printPattern(arg))
        .join(", ")})`;
    }
    case "CallExpression": {
      return `Call ${printPlace(instrValue.callee)}(${instrValue.args
        .map((arg) => printPattern(arg))
        .join(", ")})`;
    }
    case "MethodCall": {
      return `MethodCall ${printPlace(instrValue.receiver)}.${printPlace(
        instrValue.property,
      )}(${instrValue.args.map((arg) => printPattern(arg)).join(", ")})`;
    }
    case "JSXText": {
      return `JSXText ${JSON.stringify(instrValue.value)}`;
    }
    case "Primitive": {
      if (instrValue.value === undefined) {
        return "<undefined>";
      }
      return JSON.stringify(instrValue.value);
    }
    case "TypeCastExpression": {
      return `TypeCast ${printPlace(instrValue.value)}: ${printType(instrValue.type)}`;
    }
    case "JsxExpression": {
      const propItems = [];
      for (const attribute of instrValue.props) {
        if (attribute.kind === "JsxAttribute") {
          propItems.push(`${attribute.name}={${printPlace(attribute.place)}}`);
        } else {
          propItems.push(`...${printPlace(attribute.argument)}`);
        }
      }
      const tag =
        instrValue.tag.kind === "Identifier" ? printPlace(instrValue.tag) : instrValue.tag.name;
      const props = propItems.length !== 0 ? " " + propItems.join(" ") : "";
      if (instrValue.children !== null) {
        const children = instrValue.children.map((child) => `{${printPlace(child)}}`);
        return `JSX <${tag}${props}${props.length > 0 ? " " : ""}>${children.join("")}</${tag}>`;
      }
      return `JSX <${tag}${props}${props.length > 0 ? " " : ""}/>`;
    }
    case "JsxFragment": {
      return `JsxFragment [${instrValue.children.map((child) => printPlace(child)).join(", ")}]`;
    }
    case "UnsupportedNode": {
      return `UnsupportedNode ${SyntaxKind[instrValue.node.kind]}`;
    }
    case "LoadLocal": {
      return `LoadLocal ${printPlace(instrValue.place)}`;
    }
    case "DeclareLocal": {
      return `DeclareLocal ${instrValue.lvalue.kind} ${printPlace(instrValue.lvalue.place)}`;
    }
    case "DeclareContext": {
      return `DeclareContext ${instrValue.lvalue.kind} ${printPlace(instrValue.lvalue.place)}`;
    }
    case "StoreLocal": {
      return `StoreLocal ${instrValue.lvalue.kind} ${printPlace(
        instrValue.lvalue.place,
      )} = ${printPlace(instrValue.value)}`;
    }
    case "LoadContext": {
      return `LoadContext ${printPlace(instrValue.place)}`;
    }
    case "StoreContext": {
      return `StoreContext ${instrValue.lvalue.kind} ${printPlace(
        instrValue.lvalue.place,
      )} = ${printPlace(instrValue.value)}`;
    }
    case "Destructure": {
      return `Destructure ${instrValue.lvalue.kind} ${printPattern(
        instrValue.lvalue.pattern,
      )} = ${printPlace(instrValue.value)}`;
    }
    case "PropertyLoad": {
      return `PropertyLoad ${printPlace(instrValue.object)}.${instrValue.property}`;
    }
    case "PropertyStore": {
      return `PropertyStore ${printPlace(instrValue.object)}.${
        instrValue.property
      } = ${printPlace(instrValue.value)}`;
    }
    case "PropertyDelete": {
      return `PropertyDelete ${printPlace(instrValue.object)}.${instrValue.property}`;
    }
    case "ComputedLoad": {
      return `ComputedLoad ${printPlace(instrValue.object)}[${printPlace(instrValue.property)}]`;
    }
    case "ComputedStore": {
      return `ComputedStore ${printPlace(instrValue.object)}[${printPlace(
        instrValue.property,
      )}] = ${printPlace(instrValue.value)}`;
    }
    case "ComputedDelete": {
      return `ComputedDelete ${printPlace(instrValue.object)}[${printPlace(instrValue.property)}]`;
    }
    case "ObjectMethod":
    case "FunctionExpression": {
      const kind = instrValue.kind === "FunctionExpression" ? "Function" : "ObjectMethod";
      const name = getFunctionName(instrValue, "");
      const fn = printFunction(instrValue.loweredFunc.func)
        .split("\n")
        .map((line) => `      ${line}`)
        .join("\n");
      const context = instrValue.loweredFunc.func.context.map((dep) => printPlace(dep)).join(",");
      const aliasingEffects =
        instrValue.loweredFunc.func.aliasingEffects?.map(printAliasingEffect)?.join(", ") ?? "";
      return `${kind} ${name} @context[${context}] @aliasingEffects=[${aliasingEffects}]\n${fn}`;
    }
    case "TaggedTemplateExpression": {
      return `${printPlace(instrValue.tag)}\`${instrValue.value.raw}\``;
    }
    case "TemplateLiteral": {
      CompilerError.invariant(instrValue.subexprs.length === instrValue.quasis.length - 1, {
        reason: "Bad assumption about quasi length.",
        loc: instrValue.loc,
      });
      const parts = instrValue.subexprs.map(
        (subexpr, index) => `${instrValue.quasis[index]?.raw}\${${printPlace(subexpr)}}`,
      );
      return `\`${parts.join("")}${instrValue.quasis.at(-1)?.raw}\``;
    }
    case "LoadGlobal": {
      switch (instrValue.binding.kind) {
        case "Global": {
          return `LoadGlobal(global) ${instrValue.binding.name}`;
        }
        case "ModuleLocal": {
          return `LoadGlobal(module) ${instrValue.binding.name}`;
        }
        case "ImportDefault": {
          return `LoadGlobal import ${instrValue.binding.name} from '${instrValue.binding.module}'`;
        }
        case "ImportNamespace": {
          return `LoadGlobal import * as ${instrValue.binding.name} from '${instrValue.binding.module}'`;
        }
        case "ImportSpecifier": {
          if (instrValue.binding.imported !== instrValue.binding.name) {
            return `LoadGlobal import { ${instrValue.binding.imported} as ${instrValue.binding.name} } from '${instrValue.binding.module}'`;
          }
          return `LoadGlobal import { ${instrValue.binding.name} } from '${instrValue.binding.module}'`;
        }
        default: {
          return assertExhaustive(instrValue.binding, `Unexpected binding kind`);
        }
      }
    }
    case "StoreGlobal": {
      return `StoreGlobal ${instrValue.name} = ${printPlace(instrValue.value)}`;
    }
    case "RegExpLiteral": {
      return `RegExp /${instrValue.pattern}/${instrValue.flags}`;
    }
    case "MetaProperty": {
      return `MetaProperty ${instrValue.meta}.${instrValue.property}`;
    }
    case "Await": {
      return `Await ${printPlace(instrValue.value)}`;
    }
    case "GetIterator": {
      return `GetIterator collection=${printPlace(instrValue.collection)}`;
    }
    case "IteratorNext": {
      return `IteratorNext iterator=${printPlace(instrValue.iterator)} collection=${printPlace(
        instrValue.collection,
      )}`;
    }
    case "NextPropertyOf": {
      return `NextPropertyOf ${printPlace(instrValue.value)}`;
    }
    case "Debugger": {
      return `Debugger`;
    }
    case "PostfixUpdateLocal":
    case "PostfixUpdateContext": {
      return `${instrValue.kind} ${printPlace(instrValue.lvalue)} = ${printPlace(
        instrValue.value,
      )} ${instrValue.operation}`;
    }
    case "PrefixUpdateLocal":
    case "PrefixUpdateContext": {
      return `${instrValue.kind} ${printPlace(instrValue.lvalue)} = ${
        instrValue.operation
      } ${printPlace(instrValue.value)}`;
    }
    case "StartMemoize": {
      return `StartMemoize deps=${
        instrValue.deps?.map((dep) => printManualMemoDependency(dep, false)) ?? "(none)"
      }`;
    }
    case "FinishMemoize": {
      return `FinishMemoize decl=${printPlace(instrValue.decl)}${instrValue.pruned ? " pruned" : ""}`;
    }
    default: {
      return assertExhaustive(instrValue, `Unexpected instruction kind`);
    }
  }
};

export const printLValue = (lval: LValue): string => {
  const lvalue = `${printPlace(lval.place)}`;

  switch (lval.kind) {
    case InstructionKind.Let: {
      return `Let ${lvalue}`;
    }
    case InstructionKind.Const: {
      return `Const ${lvalue}$`;
    }
    case InstructionKind.Reassign: {
      return `Reassign ${lvalue}`;
    }
    case InstructionKind.Catch: {
      return `Catch ${lvalue}`;
    }
    case InstructionKind.HoistedConst: {
      return `HoistedConst ${lvalue}$`;
    }
    case InstructionKind.HoistedLet: {
      return `HoistedLet ${lvalue}$`;
    }
    case InstructionKind.Function: {
      return `Function ${lvalue}$`;
    }
    case InstructionKind.HoistedFunction: {
      return `HoistedFunction ${lvalue}$`;
    }
    default: {
      return assertExhaustive(lval.kind, `Unexpected lvalue kind \`${lval.kind}\``);
    }
  }
};

export const printPattern = (pattern: Pattern | Place | SpreadPattern): string => {
  switch (pattern.kind) {
    case "ArrayPattern": {
      return (
        "[ " +
        pattern.items
          .map((item) => {
            if (item.kind === "Hole") {
              return "<hole>";
            }
            return printPattern(item);
          })
          .join(", ") +
        " ]"
      );
    }
    case "ObjectPattern": {
      return (
        "{ " +
        pattern.properties
          .map((item) => {
            switch (item.kind) {
              case "ObjectProperty": {
                return `${printObjectPropertyKey(item.key)}: ${printPattern(item.place)}`;
              }
              case "Spread": {
                return printPattern(item);
              }
              default: {
                return assertExhaustive(item, "Unexpected object property kind");
              }
            }
          })
          .join(", ") +
        " }"
      );
    }
    case "Spread": {
      return `...${printPlace(pattern.place)}`;
    }
    case "Identifier": {
      return printPlace(pattern);
    }
    default: {
      return assertExhaustive(pattern, `Unexpected pattern kind`);
    }
  }
};

const isMutable = (range: MutableRange): boolean => range.end > range.start + 1;

const printMutableRange = (identifier: Identifier): string => {
  // prefer the scope range if it exists
  const range = identifier.scope?.range ?? identifier.mutableRange;
  return isMutable(range) ? `[${range.start}:${range.end}]` : "";
};

export const printPlace = (place: Place): string =>
  [
    place.effect,
    " ",
    printIdentifier(place.identifier),
    printMutableRange(place.identifier),
    printType(place.identifier.type),
    place.reactive ? "{reactive}" : null,
  ]
    .filter((item) => item !== null)
    .join("");

export const printIdentifier = (id: Identifier): string =>
  `${printName(id.name)}$${id.id}${printScope(id.scope)}`;

const printName = (name: IdentifierName | null): string => {
  if (name === null) {
    return "";
  }
  return name.value;
};

const printScope = (scope: ReactiveScope | null): string =>
  `${scope !== null ? `_@${scope.id}` : ""}`;

export const printManualMemoDependency = (val: ManualMemoDependency, nameOnly: boolean): string => {
  const getRootStr = (): string => {
    if (val.root.kind === "Global") {
      return val.root.identifierName;
    }
    const name = val.root.value.identifier.name;
    CompilerError.invariant(name?.kind === "named", {
      reason: "DepsValidation: expected named local variable in depslist",
      loc: val.root.value.loc,
    });
    return nameOnly ? name.value : printIdentifier(val.root.value.identifier);
  };
  return `${getRootStr()}${val.path
    .map((entry) => `${entry.optional ? "?." : "."}${entry.property}`)
    .join("")}`;
};
export const printType = (type: Type): string => {
  if (type.kind === "Type") return "";
  // TODO(mofeiZ): add debugName for generated ids
  if (type.kind === "Object" && type.shapeId !== null) {
    return `:T${type.kind}<${type.shapeId}>`;
  } else if (type.kind === "Function" && type.shapeId !== null) {
    const returnType = printType(type.return);
    return `:T${type.kind}<${type.shapeId}>()${returnType !== "" ? `:  ${returnType}` : ""}`;
  }
  return `:T${type.kind}`;
};

export const printSourceLocation = (loc: SourceLocation): string => {
  if (typeof loc === "symbol") {
    return "generated";
  }
  return `${loc.line}:${loc.column}:${loc.start}:${loc.end}`;
};

export const printSourceLocationLine = (loc: SourceLocation): string => {
  if (typeof loc === "symbol") {
    return "generated";
  }
  return `${loc.line}`;
};

const getFunctionName = (
  instrValue: ObjectMethod | FunctionExpression,
  defaultValue: string,
): string => {
  switch (instrValue.kind) {
    case "FunctionExpression":
      return instrValue.name ?? defaultValue;
    case "ObjectMethod":
      return defaultValue;
  }
};

export const printAliasingEffect = (effect: AliasingEffect): string => {
  switch (effect.kind) {
    case "Assign": {
      return `Assign ${printPlaceForAliasEffect(effect.into)} = ${printPlaceForAliasEffect(effect.from)}`;
    }
    case "Alias": {
      return `Alias ${printPlaceForAliasEffect(effect.into)} <- ${printPlaceForAliasEffect(effect.from)}`;
    }
    case "MaybeAlias": {
      return `MaybeAlias ${printPlaceForAliasEffect(effect.into)} <- ${printPlaceForAliasEffect(effect.from)}`;
    }
    case "Capture": {
      return `Capture ${printPlaceForAliasEffect(effect.into)} <- ${printPlaceForAliasEffect(effect.from)}`;
    }
    case "ImmutableCapture": {
      return `ImmutableCapture ${printPlaceForAliasEffect(effect.into)} <- ${printPlaceForAliasEffect(effect.from)}`;
    }
    case "Create": {
      return `Create ${printPlaceForAliasEffect(effect.into)} = ${effect.value}`;
    }
    case "CreateFrom": {
      return `Create ${printPlaceForAliasEffect(effect.into)} = kindOf(${printPlaceForAliasEffect(effect.from)})`;
    }
    case "CreateFunction": {
      return `Function ${printPlaceForAliasEffect(effect.into)} = Function captures=[${effect.captures.map(printPlaceForAliasEffect).join(", ")}]`;
    }
    case "Apply": {
      const receiverCallee =
        effect.receiver.identifier.id === effect.function.identifier.id
          ? printPlaceForAliasEffect(effect.receiver)
          : `${printPlaceForAliasEffect(effect.receiver)}.${printPlaceForAliasEffect(effect.function)}`;
      const args = effect.args
        .map((arg) => {
          if (arg.kind === "Identifier") {
            return printPlaceForAliasEffect(arg);
          } else if (arg.kind === "Hole") {
            return " ";
          }
          return `...${printPlaceForAliasEffect(arg.place)}`;
        })
        .join(", ");
      const signature =
        effect.signature !== null
          ? effect.signature.aliasing
            ? printAliasingSignature(effect.signature.aliasing)
            : JSON.stringify(effect.signature, null, 2)
          : "";
      return `Apply ${printPlaceForAliasEffect(effect.into)} = ${receiverCallee}(${args})${signature !== "" ? "\n     " : ""}${signature}`;
    }
    case "Freeze": {
      return `Freeze ${printPlaceForAliasEffect(effect.value)} ${effect.reason}`;
    }
    case "Mutate":
    case "MutateConditionally":
    case "MutateTransitive":
    case "MutateTransitiveConditionally": {
      return `${effect.kind} ${printPlaceForAliasEffect(effect.value)}${effect.kind === "Mutate" && effect.reason?.kind === "AssignCurrentProperty" ? " (assign `.current`)" : ""}`;
    }
    case "MutateFrozen": {
      return `MutateFrozen ${printPlaceForAliasEffect(effect.place)} reason=${JSON.stringify(effect.error.reason)}`;
    }
    case "MutateGlobal": {
      return `MutateGlobal ${printPlaceForAliasEffect(effect.place)} reason=${JSON.stringify(effect.error.reason)}`;
    }
    case "Impure": {
      return `Impure ${printPlaceForAliasEffect(effect.place)} reason=${JSON.stringify(effect.error.reason)}`;
    }
    case "Render": {
      return `Render ${printPlaceForAliasEffect(effect.place)}`;
    }
    default: {
      return assertExhaustive(effect, "Unexpected kind");
    }
  }
};

const printPlaceForAliasEffect = (place: Place): string => printIdentifier(place.identifier);

export const printAliasingSignature = (signature: AliasingSignature): string => {
  const tokens: Array<string> = ["function "];
  if (signature.temporaries.length !== 0) {
    tokens.push("<");
    tokens.push(signature.temporaries.map((temp) => `$${temp.identifier.id}`).join(", "));
    tokens.push(">");
  }
  tokens.push("(");
  tokens.push("this=$" + String(signature.receiver));
  for (const param of signature.params) {
    tokens.push(", $" + String(param));
  }
  if (signature.rest !== null) {
    tokens.push(`, ...$${String(signature.rest)}`);
  }
  tokens.push("): ");
  tokens.push("$" + String(signature.returns) + ":");
  for (const effect of signature.effects) {
    tokens.push("\n  " + printAliasingEffect(effect));
  }
  return tokens.join("");
};

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
// Ported from babel-plugin-react-compiler/src/HIR/visitors.ts at b618bbb.

import { assertExhaustive } from "../utils/utils.js";
import {
  type BlockId,
  type Instruction,
  type InstructionValue,
  makeInstructionId,
  type Pattern,
  type Place,
  type SpreadPattern,
  type Terminal,
} from "./hir.js";

export const eachInstructionLValue = (instr: Instruction): Array<Place> => {
  const result: Array<Place> = [];
  result.push(instr.lvalue);
  result.push(...eachInstructionValueLValue(instr.value));
  return result;
};

const eachInstructionValueLValue = (value: InstructionValue): Array<Place> => {
  const result: Array<Place> = [];
  switch (value.kind) {
    case "DeclareContext":
    case "StoreContext":
    case "DeclareLocal":
    case "StoreLocal": {
      result.push(value.lvalue.place);
      break;
    }
    case "Destructure": {
      result.push(...eachPatternOperand(value.lvalue.pattern));
      break;
    }
    case "PostfixUpdateLocal":
    case "PostfixUpdateContext":
    case "PrefixUpdateContext":
    case "PrefixUpdateLocal": {
      result.push(value.lvalue);
      break;
    }
  }
  return result;
};

export const eachInstructionOperand = (instr: Instruction): Array<Place> => {
  const result: Array<Place> = [];
  result.push(...eachInstructionValueOperand(instr.value));
  return result;
};
export const eachInstructionValueOperand = (instrValue: InstructionValue): Array<Place> => {
  const result: Array<Place> = [];
  switch (instrValue.kind) {
    case "NewExpression":
    case "CallExpression": {
      result.push(instrValue.callee);
      result.push(...eachCallArgument(instrValue.args));
      break;
    }
    case "BinaryExpression": {
      result.push(instrValue.left);
      result.push(instrValue.right);
      break;
    }
    case "MethodCall": {
      result.push(instrValue.receiver);
      result.push(instrValue.property);
      result.push(...eachCallArgument(instrValue.args));
      break;
    }
    case "DeclareContext":
    case "DeclareLocal": {
      break;
    }
    case "LoadLocal":
    case "LoadContext": {
      result.push(instrValue.place);
      break;
    }
    case "StoreLocal": {
      result.push(instrValue.value);
      break;
    }
    case "StoreContext": {
      result.push(instrValue.lvalue.place);
      result.push(instrValue.value);
      break;
    }
    case "StoreGlobal": {
      result.push(instrValue.value);
      break;
    }
    case "Destructure": {
      result.push(instrValue.value);
      break;
    }
    case "PropertyLoad": {
      result.push(instrValue.object);
      break;
    }
    case "PropertyDelete": {
      result.push(instrValue.object);
      break;
    }
    case "PropertyStore": {
      result.push(instrValue.object);
      result.push(instrValue.value);
      break;
    }
    case "ComputedLoad": {
      result.push(instrValue.object);
      result.push(instrValue.property);
      break;
    }
    case "ComputedDelete": {
      result.push(instrValue.object);
      result.push(instrValue.property);
      break;
    }
    case "ComputedStore": {
      result.push(instrValue.object);
      result.push(instrValue.property);
      result.push(instrValue.value);
      break;
    }
    case "UnaryExpression": {
      result.push(instrValue.value);
      break;
    }
    case "JsxExpression": {
      if (instrValue.tag.kind === "Identifier") {
        result.push(instrValue.tag);
      }
      for (const attribute of instrValue.props) {
        switch (attribute.kind) {
          case "JsxAttribute": {
            result.push(attribute.place);
            break;
          }
          case "JsxSpreadAttribute": {
            result.push(attribute.argument);
            break;
          }
          default: {
            assertExhaustive(attribute, `Unexpected attribute kind`);
          }
        }
      }
      if (instrValue.children) {
        result.push(...instrValue.children);
      }
      break;
    }
    case "JsxFragment": {
      result.push(...instrValue.children);
      break;
    }
    case "ObjectExpression": {
      for (const property of instrValue.properties) {
        if (property.kind === "ObjectProperty" && property.key.kind === "computed") {
          result.push(property.key.name);
        }
        result.push(property.place);
      }
      break;
    }
    case "ArrayExpression": {
      for (const element of instrValue.elements) {
        if (element.kind === "Identifier") {
          result.push(element);
        } else if (element.kind === "Spread") {
          result.push(element.place);
        }
      }
      break;
    }
    case "ObjectMethod":
    case "FunctionExpression": {
      result.push(...instrValue.loweredFunc.func.context);
      break;
    }
    case "TaggedTemplateExpression": {
      result.push(instrValue.tag);
      break;
    }
    case "TypeCastExpression": {
      result.push(instrValue.value);
      break;
    }
    case "TemplateLiteral": {
      result.push(...instrValue.subexprs);
      break;
    }
    case "Await": {
      result.push(instrValue.value);
      break;
    }
    case "GetIterator": {
      result.push(instrValue.collection);
      break;
    }
    case "IteratorNext": {
      result.push(instrValue.iterator);
      result.push(instrValue.collection);
      break;
    }
    case "NextPropertyOf": {
      result.push(instrValue.value);
      break;
    }
    case "PostfixUpdateLocal":
    case "PostfixUpdateContext":
    case "PrefixUpdateContext":
    case "PrefixUpdateLocal": {
      result.push(instrValue.value);
      break;
    }
    case "Debugger":
    case "RegExpLiteral":
    case "MetaProperty":
    case "LoadGlobal":
    case "UnsupportedNode":
    case "Primitive":
    case "JSXText": {
      break;
    }
    default: {
      assertExhaustive(instrValue, `Unexpected instruction kind`);
    }
  }
  return result;
};

const eachCallArgument = (args: Array<Place | SpreadPattern>): Array<Place> => {
  const result: Array<Place> = [];
  for (const arg of args) {
    if (arg.kind === "Identifier") {
      result.push(arg);
    } else {
      result.push(arg.place);
    }
  }
  return result;
};

export const eachPatternOperand = (pattern: Pattern): Array<Place> => {
  const result: Array<Place> = [];
  switch (pattern.kind) {
    case "ArrayPattern": {
      for (const item of pattern.items) {
        if (item.kind === "Identifier") {
          result.push(item);
        } else if (item.kind === "Spread") {
          result.push(item.place);
        } else if (item.kind === "Hole") {
          continue;
        } else {
          assertExhaustive(item, `Unexpected item kind`);
        }
      }
      break;
    }
    case "ObjectPattern": {
      for (const property of pattern.properties) {
        if (property.kind === "ObjectProperty") {
          result.push(property.place);
        } else if (property.kind === "Spread") {
          result.push(property.place);
        } else {
          assertExhaustive(property, `Unexpected item kind`);
        }
      }
      break;
    }
    default: {
      assertExhaustive(pattern, `Unexpected pattern kind`);
    }
  }
  return result;
};

export const mapInstructionLValues = (
  instr: Instruction,
  callback: (place: Place) => Place,
): void => {
  switch (instr.value.kind) {
    case "DeclareLocal":
    case "StoreLocal": {
      const lvalue = instr.value.lvalue;
      lvalue.place = callback(lvalue.place);
      break;
    }
    case "Destructure": {
      mapPatternOperands(instr.value.lvalue.pattern, callback);
      break;
    }
    case "PostfixUpdateLocal":
    case "PrefixUpdateLocal": {
      instr.value.lvalue = callback(instr.value.lvalue);
      break;
    }
  }
  instr.lvalue = callback(instr.lvalue);
};

export const mapInstructionOperands = (
  instr: Instruction,
  callback: (place: Place) => Place,
): void => {
  mapInstructionValueOperands(instr.value, callback);
};

const mapInstructionValueOperands = (
  instrValue: InstructionValue,
  callback: (place: Place) => Place,
): void => {
  switch (instrValue.kind) {
    case "BinaryExpression": {
      instrValue.left = callback(instrValue.left);
      instrValue.right = callback(instrValue.right);
      break;
    }
    case "PropertyLoad": {
      instrValue.object = callback(instrValue.object);
      break;
    }
    case "PropertyDelete": {
      instrValue.object = callback(instrValue.object);
      break;
    }
    case "PropertyStore": {
      instrValue.object = callback(instrValue.object);
      instrValue.value = callback(instrValue.value);
      break;
    }
    case "ComputedLoad": {
      instrValue.object = callback(instrValue.object);
      instrValue.property = callback(instrValue.property);
      break;
    }
    case "ComputedDelete": {
      instrValue.object = callback(instrValue.object);
      instrValue.property = callback(instrValue.property);
      break;
    }
    case "ComputedStore": {
      instrValue.object = callback(instrValue.object);
      instrValue.property = callback(instrValue.property);
      instrValue.value = callback(instrValue.value);
      break;
    }
    case "DeclareContext":
    case "DeclareLocal": {
      break;
    }
    case "LoadLocal":
    case "LoadContext": {
      instrValue.place = callback(instrValue.place);
      break;
    }
    case "StoreLocal": {
      instrValue.value = callback(instrValue.value);
      break;
    }
    case "StoreContext": {
      instrValue.lvalue.place = callback(instrValue.lvalue.place);
      instrValue.value = callback(instrValue.value);
      break;
    }
    case "StoreGlobal": {
      instrValue.value = callback(instrValue.value);
      break;
    }
    case "Destructure": {
      instrValue.value = callback(instrValue.value);
      break;
    }
    case "NewExpression":
    case "CallExpression": {
      instrValue.callee = callback(instrValue.callee);
      instrValue.args = mapCallArguments(instrValue.args, callback);
      break;
    }
    case "MethodCall": {
      instrValue.receiver = callback(instrValue.receiver);
      instrValue.property = callback(instrValue.property);
      instrValue.args = mapCallArguments(instrValue.args, callback);
      break;
    }
    case "UnaryExpression": {
      instrValue.value = callback(instrValue.value);
      break;
    }
    case "JsxExpression": {
      if (instrValue.tag.kind === "Identifier") {
        instrValue.tag = callback(instrValue.tag);
      }
      for (const attribute of instrValue.props) {
        switch (attribute.kind) {
          case "JsxAttribute": {
            attribute.place = callback(attribute.place);
            break;
          }
          case "JsxSpreadAttribute": {
            attribute.argument = callback(attribute.argument);
            break;
          }
          default: {
            assertExhaustive(attribute, `Unexpected attribute kind`);
          }
        }
      }
      if (instrValue.children) {
        instrValue.children = instrValue.children.map((child) => callback(child));
      }
      break;
    }
    case "ObjectExpression": {
      for (const property of instrValue.properties) {
        if (property.kind === "ObjectProperty" && property.key.kind === "computed") {
          property.key.name = callback(property.key.name);
        }
        property.place = callback(property.place);
      }
      break;
    }
    case "ArrayExpression": {
      instrValue.elements = instrValue.elements.map((element) => {
        if (element.kind === "Identifier") {
          return callback(element);
        } else if (element.kind === "Spread") {
          element.place = callback(element.place);
          return element;
        } else {
          return element;
        }
      });
      break;
    }
    case "JsxFragment": {
      instrValue.children = instrValue.children.map((child) => callback(child));
      break;
    }
    case "ObjectMethod":
    case "FunctionExpression": {
      instrValue.loweredFunc.func.context = instrValue.loweredFunc.func.context.map((place) =>
        callback(place),
      );

      break;
    }
    case "TaggedTemplateExpression": {
      instrValue.tag = callback(instrValue.tag);
      break;
    }
    case "TypeCastExpression": {
      instrValue.value = callback(instrValue.value);
      break;
    }
    case "TemplateLiteral": {
      instrValue.subexprs = instrValue.subexprs.map(callback);
      break;
    }
    case "Await": {
      instrValue.value = callback(instrValue.value);
      break;
    }
    case "GetIterator": {
      instrValue.collection = callback(instrValue.collection);
      break;
    }
    case "IteratorNext": {
      instrValue.iterator = callback(instrValue.iterator);
      instrValue.collection = callback(instrValue.collection);
      break;
    }
    case "NextPropertyOf": {
      instrValue.value = callback(instrValue.value);
      break;
    }
    case "PostfixUpdateLocal":
    case "PostfixUpdateContext":
    case "PrefixUpdateContext":
    case "PrefixUpdateLocal": {
      instrValue.value = callback(instrValue.value);
      break;
    }
    case "Debugger":
    case "RegExpLiteral":
    case "MetaProperty":
    case "LoadGlobal":
    case "UnsupportedNode":
    case "Primitive":
    case "JSXText": {
      break;
    }
    default: {
      assertExhaustive(instrValue, "Unexpected instruction kind");
    }
  }
};

const mapCallArguments = (
  args: Array<Place | SpreadPattern>,
  callback: (place: Place) => Place,
): Array<Place | SpreadPattern> => {
  return args.map((arg) => {
    if (arg.kind === "Identifier") {
      return callback(arg);
    } else {
      arg.place = callback(arg.place);
      return arg;
    }
  });
};

const mapPatternOperands = (pattern: Pattern, callback: (place: Place) => Place): void => {
  switch (pattern.kind) {
    case "ArrayPattern": {
      pattern.items = pattern.items.map((item) => {
        if (item.kind === "Identifier") {
          return callback(item);
        } else if (item.kind === "Spread") {
          item.place = callback(item.place);
          return item;
        } else {
          return item;
        }
      });
      break;
    }
    case "ObjectPattern": {
      for (const property of pattern.properties) {
        property.place = callback(property.place);
      }
      break;
    }
    default: {
      assertExhaustive(pattern, `Unexpected pattern kind`);
    }
  }
};

// Maps a terminal node's block assignments using the provided function.
export const mapTerminalSuccessors = (
  terminal: Terminal,
  callback: (block: BlockId) => BlockId,
): Terminal => {
  switch (terminal.kind) {
    case "goto": {
      const target = callback(terminal.block);
      return {
        kind: "goto",
        block: target,
        variant: terminal.variant,
        id: makeInstructionId(0),
        loc: terminal.loc,
      };
    }
    case "if": {
      const consequent = callback(terminal.consequent);
      const alternate = callback(terminal.alternate);
      const fallthrough = callback(terminal.fallthrough);
      return {
        kind: "if",
        test: terminal.test,
        consequent,
        alternate,
        fallthrough,
        id: makeInstructionId(0),
        loc: terminal.loc,
      };
    }
    case "branch": {
      const consequent = callback(terminal.consequent);
      const alternate = callback(terminal.alternate);
      const fallthrough = callback(terminal.fallthrough);
      return {
        kind: "branch",
        test: terminal.test,
        consequent,
        alternate,
        fallthrough,
        id: makeInstructionId(0),
        loc: terminal.loc,
      };
    }
    case "switch": {
      const cases = terminal.cases.map((case_) => {
        const target = callback(case_.block);
        return {
          test: case_.test,
          block: target,
        };
      });
      const fallthrough = callback(terminal.fallthrough);
      return {
        kind: "switch",
        test: terminal.test,
        cases,
        fallthrough,
        id: makeInstructionId(0),
        loc: terminal.loc,
      };
    }
    case "logical": {
      const test = callback(terminal.test);
      const fallthrough = callback(terminal.fallthrough);
      return {
        kind: "logical",
        test,
        fallthrough,
        operator: terminal.operator,
        id: makeInstructionId(0),
        loc: terminal.loc,
      };
    }
    case "ternary": {
      const test = callback(terminal.test);
      const fallthrough = callback(terminal.fallthrough);
      return {
        kind: "ternary",
        test,
        fallthrough,
        id: makeInstructionId(0),
        loc: terminal.loc,
      };
    }
    case "optional": {
      const test = callback(terminal.test);
      const fallthrough = callback(terminal.fallthrough);
      return {
        kind: "optional",
        optional: terminal.optional,
        test,
        fallthrough,
        id: makeInstructionId(0),
        loc: terminal.loc,
      };
    }
    case "return": {
      return {
        kind: "return",
        returnVariant: terminal.returnVariant,
        loc: terminal.loc,
        value: terminal.value,
        id: makeInstructionId(0),
      };
    }
    case "throw": {
      return terminal;
    }
    case "do-while": {
      const loop = callback(terminal.loop);
      const test = callback(terminal.test);
      const fallthrough = callback(terminal.fallthrough);
      return {
        kind: "do-while",
        loc: terminal.loc,
        test,
        loop,
        fallthrough,
        id: makeInstructionId(0),
      };
    }
    case "while": {
      const test = callback(terminal.test);
      const loop = callback(terminal.loop);
      const fallthrough = callback(terminal.fallthrough);
      return {
        kind: "while",
        loc: terminal.loc,
        test,
        loop,
        fallthrough,
        id: makeInstructionId(0),
      };
    }
    case "for": {
      const init = callback(terminal.init);
      const test = callback(terminal.test);
      const update = terminal.update !== null ? callback(terminal.update) : null;
      const loop = callback(terminal.loop);
      const fallthrough = callback(terminal.fallthrough);
      return {
        kind: "for",
        loc: terminal.loc,
        init,
        test,
        update,
        loop,
        fallthrough,
        id: makeInstructionId(0),
      };
    }
    case "for-of": {
      const init = callback(terminal.init);
      const loop = callback(terminal.loop);
      const test = callback(terminal.test);
      const fallthrough = callback(terminal.fallthrough);
      return {
        kind: "for-of",
        loc: terminal.loc,
        init,
        test,
        loop,
        fallthrough,
        id: makeInstructionId(0),
      };
    }
    case "for-in": {
      const init = callback(terminal.init);
      const loop = callback(terminal.loop);
      const fallthrough = callback(terminal.fallthrough);
      return {
        kind: "for-in",
        loc: terminal.loc,
        init,
        loop,
        fallthrough,
        id: makeInstructionId(0),
      };
    }
    case "label": {
      const block = callback(terminal.block);
      const fallthrough = callback(terminal.fallthrough);
      return {
        kind: "label",
        block,
        fallthrough,
        id: makeInstructionId(0),
        loc: terminal.loc,
      };
    }
    case "sequence": {
      const block = callback(terminal.block);
      const fallthrough = callback(terminal.fallthrough);
      return {
        kind: "sequence",
        block,
        fallthrough,
        id: makeInstructionId(0),
        loc: terminal.loc,
      };
    }
    case "maybe-throw": {
      const continuation = callback(terminal.continuation);
      const handler = terminal.handler !== null ? callback(terminal.handler) : null;
      return {
        kind: "maybe-throw",
        continuation,
        handler,
        id: makeInstructionId(0),
        loc: terminal.loc,
      };
    }
    case "try": {
      const block = callback(terminal.block);
      const handler = callback(terminal.handler);
      const fallthrough = callback(terminal.fallthrough);
      return {
        kind: "try",
        block,
        handlerBinding: terminal.handlerBinding,
        handler,
        fallthrough,
        id: makeInstructionId(0),
        loc: terminal.loc,
      };
    }
    case "unreachable":
    case "unsupported": {
      return terminal;
    }
    default: {
      assertExhaustive(terminal, `Unexpected terminal kind`);
    }
  }
};

export const terminalHasFallthrough = <T extends Terminal, U extends T & { fallthrough: BlockId }>(
  terminal: T,
): terminal is U => {
  switch (terminal.kind) {
    case "maybe-throw":
    case "goto":
    case "return":
    case "throw":
    case "unreachable":
    case "unsupported": {
      return false;
    }
    case "branch":
    case "try":
    case "do-while":
    case "for-of":
    case "for-in":
    case "for":
    case "if":
    case "label":
    case "logical":
    case "optional":
    case "sequence":
    case "switch":
    case "ternary":
    case "while": {
      return true;
    }
    default: {
      assertExhaustive(terminal, `Unexpected terminal kind`);
    }
  }
};

/*
 * Helper to get a terminal's fallthrough. The main reason to extract this as a helper
 * function is to ensure that we use an exhaustive switch to ensure that we add new terminal
 * variants as appropriate.
 */
export const terminalFallthrough = (terminal: Terminal): BlockId | null => {
  if (terminalHasFallthrough(terminal)) {
    return terminal.fallthrough;
  } else {
    return null;
  }
};

/*
 * Iterates over the successor block ids of the provided terminal. The function is called
 * specifically for the successors that define the standard control flow, and not
 * pseduo-successors such as fallthroughs.
 */
export const eachTerminalSuccessor = (terminal: Terminal): Array<BlockId> => {
  const result: Array<BlockId> = [];
  switch (terminal.kind) {
    case "goto": {
      result.push(terminal.block);
      break;
    }
    case "if": {
      result.push(terminal.consequent);
      result.push(terminal.alternate);
      break;
    }
    case "branch": {
      result.push(terminal.consequent);
      result.push(terminal.alternate);
      break;
    }
    case "switch": {
      for (const case_ of terminal.cases) {
        result.push(case_.block);
      }
      break;
    }
    case "optional":
    case "ternary":
    case "logical": {
      result.push(terminal.test);
      break;
    }
    case "return": {
      break;
    }
    case "throw": {
      break;
    }
    case "do-while": {
      result.push(terminal.loop);
      break;
    }
    case "while": {
      result.push(terminal.test);
      break;
    }
    case "for": {
      result.push(terminal.init);
      break;
    }
    case "for-of": {
      result.push(terminal.init);
      break;
    }
    case "for-in": {
      result.push(terminal.init);
      break;
    }
    case "label": {
      result.push(terminal.block);
      break;
    }
    case "sequence": {
      result.push(terminal.block);
      break;
    }
    case "maybe-throw": {
      result.push(terminal.continuation);
      if (terminal.handler !== null) {
        result.push(terminal.handler);
      }
      break;
    }
    case "try": {
      result.push(terminal.block);
      break;
    }
    case "unreachable":
    case "unsupported":
      break;
    default: {
      assertExhaustive(terminal, `Unexpected terminal kind`);
    }
  }
  return result;
};

export const mapTerminalOperands = (
  terminal: Terminal,
  callback: (place: Place) => Place,
): void => {
  switch (terminal.kind) {
    case "if": {
      terminal.test = callback(terminal.test);
      break;
    }
    case "branch": {
      terminal.test = callback(terminal.test);
      break;
    }
    case "switch": {
      terminal.test = callback(terminal.test);
      for (const case_ of terminal.cases) {
        if (case_.test === null) {
          continue;
        }
        case_.test = callback(case_.test);
      }
      break;
    }
    case "return":
    case "throw": {
      terminal.value = callback(terminal.value);
      break;
    }
    case "try": {
      if (terminal.handlerBinding !== null) {
        terminal.handlerBinding = callback(terminal.handlerBinding);
      }
      break;
    }
    case "maybe-throw":
    case "sequence":
    case "label":
    case "optional":
    case "ternary":
    case "logical":
    case "do-while":
    case "while":
    case "for":
    case "for-of":
    case "for-in":
    case "goto":
    case "unreachable":
    case "unsupported": {
      break;
    }
    default: {
      assertExhaustive(terminal, `Unexpected terminal kind`);
    }
  }
};

export const eachTerminalOperand = (terminal: Terminal): Array<Place> => {
  const result: Array<Place> = [];
  switch (terminal.kind) {
    case "if": {
      result.push(terminal.test);
      break;
    }
    case "branch": {
      result.push(terminal.test);
      break;
    }
    case "switch": {
      result.push(terminal.test);
      for (const case_ of terminal.cases) {
        if (case_.test === null) {
          continue;
        }
        result.push(case_.test);
      }
      break;
    }
    case "return":
    case "throw": {
      result.push(terminal.value);
      break;
    }
    case "try": {
      if (terminal.handlerBinding !== null) {
        result.push(terminal.handlerBinding);
      }
      break;
    }
    case "maybe-throw":
    case "sequence":
    case "label":
    case "optional":
    case "ternary":
    case "logical":
    case "do-while":
    case "while":
    case "for":
    case "for-of":
    case "for-in":
    case "goto":
    case "unreachable":
    case "unsupported": {
      break;
    }
    default: {
      assertExhaustive(terminal, `Unexpected terminal kind`);
    }
  }
  return result;
};

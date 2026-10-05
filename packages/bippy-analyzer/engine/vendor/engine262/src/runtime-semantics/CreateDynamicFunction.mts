import { Q, ThrowCompletion, X } from '../completion.mts';
import { Parser, wrappedParse } from '../parse.mts';
import { Token } from '../parser/tokens.mts';
import {
  Descriptor, UndefinedValue, Value,
  type Arguments,
} from '../value.mts';
import { __ts_cast__, isArray } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { FunctionKind } from '../parser/FunctionParser.mts';
import {
  HostEnsureCanCompileStrings,
  surroundingAgent,
} from '#self';
import {
  Assert,
  DefinePropertyOrThrow,
  GetPrototypeFromConstructor,
  MakeConstructor,
  OrdinaryFunctionCreate,
  OrdinaryObjectCreate,
  SetFunctionName,
  ToString,
  type FunctionObject,
  type Intrinsics,
  type ValueEvaluator,
} from '#self';

export function* CreateDynamicFunction(constructor: FunctionObject, newTarget: FunctionObject | UndefinedValue, kind: 'normal' | 'generator' | 'async' | 'asyncGenerator', parameterArgs: Arguments, bodyArg: Value): ValueEvaluator {
  if (newTarget instanceof UndefinedValue) {
    newTarget = constructor;
  }
  let fallbackProto: keyof Intrinsics;
  let prefix;
  let exprSym;
  let bodySym;
  let parameterSym;
  const bodySymParser = (parser: Parser, await_: boolean, yield_: boolean) => parser.scope.with({
    await: await_, yield: yield_, lexical: true, variable: true,
  }, () => parser.parseFunctionBody(await_, yield_, false));
  const parameterSymParser = (parser: Parser, await_: boolean, yield_: boolean) => parser.scope.with({
    await: await_, yield: yield_, lexical: true, variable: true, variableFunctions: true, newTarget: true, return: true, label: 'boundary',
  }, () => ({ result: parser.parseFormalParameters() }));
  if (kind === 'normal') {
    prefix = 'function';
    exprSym = (parser: Parser) => parser.parseFunctionExpression(FunctionKind.NORMAL);
    bodySym = (parser: Parser) => bodySymParser(parser, false, false);
    parameterSym = (parser: Parser) => parameterSymParser(parser, false, false);
    fallbackProto = '%Function.prototype%';
  } else if (kind === 'generator') {
    prefix = 'function*';
    exprSym = (parser: Parser) => parser.parseFunctionExpression(FunctionKind.NORMAL);
    bodySym = (parser: Parser) => bodySymParser(parser, false, true);
    parameterSym = (parser: Parser) => parameterSymParser(parser, false, true);
    fallbackProto = '%GeneratorFunction.prototype%';
  } else if (kind === 'async') {
    prefix = 'async function';
    exprSym = (parser: Parser) => parser.parseFunctionExpression(FunctionKind.ASYNC);
    bodySym = (parser: Parser) => bodySymParser(parser, true, false);
    parameterSym = (parser: Parser) => parameterSymParser(parser, true, false);
    fallbackProto = '%AsyncFunction.prototype%';
  } else {
    Assert(kind === 'asyncGenerator');
    prefix = 'async function*';
    exprSym = (parser: Parser) => parser.parseFunctionExpression(FunctionKind.ASYNC);
    bodySym = (parser: Parser) => bodySymParser(parser, true, true);
    parameterSym = (parser: Parser) => parameterSymParser(parser, true, true);
    fallbackProto = '%AsyncGeneratorFunction.prototype%';
  }
  const argCount = parameterArgs.length;
  const parameterStrings: string[] = [];
  for (const arg of parameterArgs) {
    parameterStrings.push(Q(yield* ToString(arg!)));
  }
  const bodyString = Q(yield* ToString(bodyArg));
  const currentRealm = surroundingAgent.currentRealmRecord;
  Q(yield* HostEnsureCanCompileStrings(currentRealm, parameterStrings, bodyString, false));
  let P = '';
  if (argCount > 0) {
    P = parameterStrings[0];
    let k = 1;
    while (k < argCount) {
      const nextArgString = parameterStrings[k];
      P = `${P},${nextArgString}`;
      k += 1;
    }
  }
  const bodyParseString = `\u{000A}${bodyString}\u{000A}`;
  const sourceString = `${prefix} anonymous(${P}\u{000A}) {${bodyParseString}}`;
  const sourceText = sourceString;
  const parameters = wrappedParse({
    source: `${' '.repeat(prefix.length + 10)}(${P}\n)`,
    decoratingSource: sourceText,
  }, (parser) => {
    const result = parameterSym(parser);
    parser.expect(Token.EOS);
    return result;
  });
  const body = wrappedParse({
    source: `${' '.repeat(prefix.length + P.length + 12)}\u{000A} {${bodyParseString}}`,
    decoratingSource: sourceText,
  }, (parser) => {
    const result = bodySym(parser);
    parser.expect(Token.EOS);
    return result;
  });
  // NOTE: The parameters and body are parsed separately to ensure that each is valid alone. For example, new Function("/*", "*/ ) {") does not evaluate to a function.
  // NOTE: If this step is reached, sourceText must have the syntax of exprSym (although the reverse implication does not hold). The purpose of the next two steps is to enforce any Early Error rules which apply to exprSym directly.
  let scriptId: string | undefined;
  let parametersNode: ParseNode.FormalParameters;
  let bodyNode;
  {
    const expr = wrappedParse({ source: sourceString }, (p) => {
      const r = exprSym(p);
      p.expect(Token.EOS);
      return r;
    });
    scriptId = surroundingAgent.addDynamicParsedSource(surroundingAgent.currentRealmRecord, sourceString, expr);
    if (isArray(parameters)) {
      Parser.decorateSyntaxErrorWithScriptId(parameters[0], scriptId);
      return ThrowCompletion(parameters[0]);
    }
    if (isArray(body)) {
      Parser.decorateSyntaxErrorWithScriptId(body[0], scriptId);
      return ThrowCompletion(body[0]);
    }
    if (Array.isArray(expr)) {
      Parser.decorateSyntaxErrorWithScriptId(expr[0], scriptId);
      return ThrowCompletion(expr[0]);
    }
    parametersNode = parameters.result;
    bodyNode = body;
  }
  const proto = Q(yield* GetPrototypeFromConstructor(newTarget, fallbackProto));
  const env = currentRealm.GlobalEnv;
  const privateEnv = null;
  const F = OrdinaryFunctionCreate(proto, sourceText, parametersNode, bodyNode, 'non-lexical-this', env, privateEnv);
  F.scriptId = scriptId;
  SetFunctionName(F, Value('anonymous'));
  if (kind === 'generator') {
    const prototype = OrdinaryObjectCreate(surroundingAgent.intrinsic('%GeneratorFunction.prototype.prototype%'));
    X(DefinePropertyOrThrow(F, 'prototype', Descriptor({
      Value: prototype,
      Writable: true,
      Enumerable: false,
      Configurable: false,
    })));
  } else if (kind === 'asyncGenerator') {
    const prototype = OrdinaryObjectCreate(surroundingAgent.intrinsic('%AsyncGeneratorFunction.prototype.prototype%'));
    X(DefinePropertyOrThrow(F, 'prototype', Descriptor({
      Value: prototype,
      Writable: true,
      Enumerable: false,
      Configurable: false,
    })));
  } else if (kind === 'normal') {
    MakeConstructor(F);
  }
  // 29. NOTE: Functions whose kind is async are not constructible and do not have a [[Construct]] internal method or a "prototype" property.
  return F;
}

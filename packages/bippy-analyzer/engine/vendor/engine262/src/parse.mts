import { Parser, type ParserOptions } from './parser/Parser.mts';
import { RegExpParser, type RegExpParserContext } from './parser/RegExpParser.mts';
import {
  SourceTextModuleRecord, SyntheticModuleRecord, type LoadedModuleRequestRecord, type ModuleRecordHostDefined,
} from './modules.mts';
import { ObjectValue } from './value.mts';
import { Q, type PlainCompletion } from './completion.mts';
import {
  ModuleRequests,
  ImportEntries,
  ExportEntries,
  OptionalIndirectExportEntries,
  ImportedLocalNames,
  type ExportEntry,
} from './static-semantics/all.mts';
import { kInternal } from './utils/internal.mts';
import { type Mutable } from './utils/language.mts';
import type { ParseNode } from './parser/ParseNode.mts';
import { ParseJSON } from './intrinsics/JSON.mts';
import { avoid_using_children } from './parser/utils.mts';
import { surroundingAgent, type GCMarker, Realm } from '#self';
import {
  CreateDefaultExportSyntheticModule,
  Throw,
} from '#self';

export { Parser, RegExpParser };
export type { ParserOptions } from './parser/Parser.mts';
export type { LanguageParser } from './parser/LanguageParser.mts';
export type { ModuleParser } from './parser/ModuleParser.mts';
export type { StatementParser } from './parser/StatementParser.mts';
export type { ExpressionParser } from './parser/ExpressionParser.mts';
export { FunctionKind } from './parser/FunctionParser.mts';
export type { ArrowParameterConversions, ConvertArrowParameterResult, FunctionParser } from './parser/FunctionParser.mts';
export type { IdentifierParser } from './parser/IdentifierParser.mts';
export type { BaseParser } from './parser/BaseParser.mts';
export type { Lexer } from './parser/Lexer.mts';
export type { Locatable } from './parser/Lexer.mts';
export { TokenData } from './parser/Lexer.mts';
export {
  RawTokens,
  Token,
  type ParserTokenIndex,
  type TokenArrayToEnumLike,
  type TokenDefinition,
} from './parser/tokens.mts';
export { Flag, type LabelType } from './parser/Scope.mts';
export type { RegExpParserContext } from './parser/RegExpParser.mts';

export function wrappedParse<T>(init: ParserOptions, f: (parser: Parser) => T) {
  const p = new Parser(init);

  try {
    const r = f(p);
    const errors = [];
    for (const error of p.earlyErrors) {
      errors.push(error);
    }
    if (errors.length > 0) {
      return errors;
    }
    return r;
  } catch (e) {
    if (e instanceof ObjectValue) return [e];
    throw e;
  }
}

export class ScriptRecord {
  readonly Realm: Realm;

  readonly ECMAScriptCode: ParseNode.Script;

  readonly LoadedModules: LoadedModuleRequestRecord[];

  readonly HostDefined: ParseScriptHostDefined;

  mark(m: GCMarker) {
    m(this.Realm);
  }

  constructor(record: Omit<ScriptRecord, 'mark'>) {
    this.ECMAScriptCode = record.ECMAScriptCode;
    this.Realm = record.Realm;
    this.LoadedModules = record.LoadedModules;
    this.HostDefined = record.HostDefined;
  }
}
export interface ParseScriptHostDefined {
  readonly specifier?: string | undefined;
  readonly [kInternal]?: {
    json?: boolean;
    /** only used in inspector.compileScript */ allowAllPrivateNames?: boolean;
    /** only used in inspector.compileScript */ allowAwait?: boolean;
  };
  scriptId?: string;
  readonly doNotTrackScriptId?: boolean;
}
export function ParseScript(sourceText: string, realm: Realm, hostDefined: ParseScriptHostDefined = {}): ScriptRecord | ObjectValue[] {
  // 1. Assert: sourceText is an ECMAScript source text (see clause 10).
  // 2. Parse sourceText using Script as the goal symbol and analyse the parse result for
  //    any Early Error conditions. If the parse was successful and no early errors were found,
  //    let body be the resulting parse tree. Otherwise, let body be a List of one or more
  //    SyntaxError objects representing the parsing errors and/or early errors. Parsing and
  //    early error detection may be interweaved in an implementation-dependent manner. If more
  //    than one parsing error or early error is present, the number and ordering of error
  //    objects in the list is implementation-dependent, but at least one must be present.
  const parseOptions = {
    source: sourceText,
    specifier: hostDefined.specifier,
    json: hostDefined[kInternal]?.json,
    allowAllPrivateNames: hostDefined[kInternal]?.allowAllPrivateNames,
  };
  let body = wrappedParse(parseOptions, (p) => p.parseScript());
  if (Array.isArray(body) && hostDefined[kInternal]?.allowAwait) {
    body = wrappedParse(parseOptions, (p) => p.scope.with({ await: true }, () => p.parseScript()));
  }
  // 3. If body is a List of errors, return body.
  if (Array.isArray(body)) {
    const scriptId = hostDefined.doNotTrackScriptId ? undefined : surroundingAgent.addDynamicParsedSource(realm, sourceText);
    body.forEach((error) => Parser.decorateSyntaxErrorWithScriptId(error, scriptId));
    return body;
  }
  setNodeParent(body, undefined);
  // 4. Return Script Record { [[Realm]]: realm, [[ECMAScriptCode]]: body, [[HostDefined]]: hostDefined }.
  const script = new ScriptRecord({
    Realm: realm,
    ECMAScriptCode: body,
    LoadedModules: [],
    HostDefined: hostDefined,
  });
  if (!hostDefined.doNotTrackScriptId) {
    surroundingAgent.addParsedSource(script);
  }
  return script;
}

export function ParseModule(sourceText: string, realm: Realm, hostDefined: ModuleRecordHostDefined = {}) {
  // 1. Assert: sourceText is an ECMAScript source text (see clause 10).
  // 2. Parse sourceText using Module as the goal symbol and analyse the parse result for
  //    any Early Error conditions. If the parse was successful and no early errors were found,
  //    let body be the resulting parse tree. Otherwise, let body be a List of one or more
  //    SyntaxError objects representing the parsing errors and/or early errors. Parsing and
  //    early error detection may be interweaved in an implementation-dependent manner. If more
  //    than one parsing error or early error is present, the number and ordering of error
  //    objects in the list is implementation-dependent, but at least one must be present.
  const body = wrappedParse<ParseNode.Module>({ source: sourceText, specifier: hostDefined.specifier }, (p) => p.parseModule());
  // 3. If body is a List of errors, return body.
  if (Array.isArray(body)) {
    const scriptId = hostDefined.doNotTrackScriptId ? undefined : surroundingAgent.addDynamicParsedSource(realm, sourceText);
    body.forEach((error) => Parser.decorateSyntaxErrorWithScriptId(error, scriptId));
    return body;
  }
  setNodeParent(body, undefined);
  // 4. Let requestedModules be the ModuleRequests of body.
  const requestedModules = ModuleRequests(body);
  // 5. Let importEntries be ImportEntries of body.
  const importEntries = ImportEntries(body);
  // 6. Let importedBoundNames be ImportedLocalNames(importEntries).
  const importedBoundNames = new Set(ImportedLocalNames(importEntries));
  // 7. Let indirectExportEntries be a new empty List.
  const indirectExportEntries: ExportEntry[] = [];
  // 8. Let localExportEntries be a new empty List.
  const localExportEntries = [];
  // 9. Let starExportEntries be a new empty List.
  const starExportEntries = [];
  // 10. Let exportEntries be ExportEntries of body.
  const exportEntries = ExportEntries(body);
  // 11. For each ExportEntry Record ee in exportEntries, do
  for (const ee of exportEntries) {
    // a. If ee.[[ModuleRequest]] is null, then
    if (!ee.ModuleRequest) {
      // i. If ee.[[LocalName]] is not an element of importedBoundNames, then
      if (!importedBoundNames.has(ee.LocalName!)) {
        // 1. Append ee to localExportEntries.
        localExportEntries.push(ee);
      } else { // ii. Else,
        // 1. Let ie be the element of importEntries whose [[LocalName]] is the same as ee.[[LocalName]].
        const ie = importEntries.find((e) => e.LocalName === ee.LocalName);
        if (ie!.ImportName === 'namespace') {
          indirectExportEntries.push({
            ModuleRequest: ie!.ModuleRequest,
            ImportName: 'namespace',
            LocalName: null,
            ExportName: ee.ExportName,
            NamespaceNamesFilter: [],
          });
        } else if (ie!.ImportName === 'filtered-namespace-object') {
          indirectExportEntries.push({
            ModuleRequest: ie!.ModuleRequest,
            ImportName: 'filtered-namespace',
            LocalName: null,
            ExportName: ee.ExportName,
            NamespaceNamesFilter: ie!.NamespaceNamesFilter,
          });
        } else {
          // This is a re-export of a single name.
          // export { x as y } from 'mod';  // ee.ExportName = y, ie.ImportName = x
          indirectExportEntries.push({
            ModuleRequest: ie!.ModuleRequest,
            ImportName: ie!.ImportName,
            LocalName: null,
            ExportName: ee.ExportName,
            NamespaceNamesFilter: [],
          });
        }
      }
    } else if (ee.ImportName && ee.ImportName === 'all-but-default' && ee.ExportName === null) { // b. Else if ee.[[ImportName]] is ~all-but-default~ and ee.[[ExportName]] is null, then
      // i. Append ee to starExportEntries.
      starExportEntries.push(ee);
    } else { // c. Else,
      // i. Append ee to indirectExportEntries.
      indirectExportEntries.push(ee);
    }
  }
  // Let optionalIndirectExportEntries be OptionalIndirectExportEntries of body.
  // (https://tc39.es/proposal-deferred-reexports/#sec-parsemodule)
  const optionalIndirectExportEntries = OptionalIndirectExportEntries(body);
  // 12. Return Source Text Module Record { [[Realm]]: realm, [[Environment]]: undefined, [[Namespace]]: undefined, [[Status]]: unlinked, [[EvaluationError]]: undefined, [[HostDefined]]: hostDefined, [[ECMAScriptCode]]: body, [[Context]]: empty, [[ImportMeta]]: empty, [[RequestedModules]]: requestedModules, [[ImportEntries]]: importEntries, [[LocalExportEntries]]: localExportEntries, [[IndirectExportEntries]]: indirectExportEntries, [[StarExportEntries]]: starExportEntries, [[DFSAncestorIndex]]: undefined }.
  const module = new (hostDefined.SourceTextModuleRecord || SourceTextModuleRecord)({
    Realm: realm,
    Environment: undefined,
    Namespace: undefined,
    Status: 'new',
    EvaluationError: undefined,
    HostDefined: hostDefined,
    ECMAScriptCode: body,
    Context: undefined,
    ImportMeta: undefined,
    RequestedModules: requestedModules,
    LoadedModules: [],
    ImportEntries: importEntries,
    LocalExportEntries: localExportEntries,
    IndirectExportEntries: indirectExportEntries,
    StarExportEntries: starExportEntries,
    OptionalIndirectExportEntries: optionalIndirectExportEntries,
    CycleRoot: undefined,
    HasTLA: body.hasTopLevelAwait,
    AsyncEvaluationOrder: 'unset',
    TopLevelCapability: undefined,
    AsyncParentModules: [],
    DFSAncestorIndex: undefined,
    PendingAsyncDependencies: undefined,
    ModuleSource: undefined,
  });
  if (!hostDefined.doNotTrackScriptId) {
    surroundingAgent.addParsedSource(module);
  }
  return module;
}

/** https://tc39.es/ecma262/#sec-parsejsonmodule */
export function ParseJSONModule(source: string): PlainCompletion<SyntheticModuleRecord> {
  const parseResult = Q(ParseJSON(source));
  return CreateDefaultExportSyntheticModule(parseResult.Value);
}

function setNodeParent(node: ParseNode, parent: ParseNode | undefined) {
  (node as Mutable<ParseNode.BaseParseNode>).parent = parent;
  for (const child of avoid_using_children(node)) {
    if (!child.parent) {
      setNodeParent(child, node);
    }
  }
}

/** https://tc39.es/ecma262/#sec-parsepattern */
export function ParsePattern(patternText: string, u: boolean, v: boolean) {
  const parse = (flags: RegExpParserContext) => {
    try {
      const p = new RegExpParser(patternText);
      return p.scope(flags, () => p.parsePattern());
    } catch (e) {
      if (e instanceof ObjectValue) return [e];
      throw e;
    }
  };
  if (v && u) {
    return [Throw.SyntaxError('RegExp flags "v" and "u" cannot be used together').Value];
  } else if (v) {
    return parse({ UnicodeMode: true, UnicodeSetsMode: true, NamedCaptureGroups: true });
  } else if (u) {
    return parse({ UnicodeMode: true, NamedCaptureGroups: true });
  } else {
    return parse({ NamedCaptureGroups: true });
  }
}

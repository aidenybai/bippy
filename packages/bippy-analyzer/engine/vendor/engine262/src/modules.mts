import {
  Value, JSStringValue, ObjectValue, UndefinedValue,
} from './value.mts';
import { ExecutionContext } from './execution-context/ExecutionContext.mts';
import {
  VarScopedDeclarations,
  LexicallyScopedDeclarations,
  BoundNames,
  IsConstantDeclaration,
  type ImportEntry,
  type ExportEntry,
} from './static-semantics/all.mts';
import { InstantiateFunctionObject } from './runtime-semantics/all.mts';
import {
  Completion,
  NormalCompletion,
  AbruptCompletion,
  EnsureCompletion,
  Q, X, ThrowCompletion,
  IfAbruptRejectPromise,
} from './completion.mts';
import { OutOfRange, type Mutable } from './utils/language.mts';
import {
  Evaluate, type Evaluator, type PlainEvaluator, type ValueEvaluator,
} from './evaluator.mts';
import type { ParseNode } from './parser/ParseNode.mts';
import {
  surroundingAgent, type GCMarker,
  type ImportAttributeRecord,
  type ImportedNamesValue,
  type ModuleRequestRecord,
  type PlainCompletion, type PromiseObject, ModuleEnvironmentRecord,
  DisposeResources,
} from '#self';
import {
  Assert,
  Call,
  NewPromiseCapability,
  GetImportedModule,
  GetModuleNamespace,
  InnerModuleEvaluation,
  InnerModuleLinking,
  InnerModuleLoading,
  MergeImportedNames,
  ModuleRequestsKeyEqual,
  SafePerformPromiseAll,
  AsyncBlockStart,
  PromiseCapabilityRecord,
  GraphLoadingState,
  Realm,
  Throw,
  isEvaluator,
} from '#self';

// https://tc39.es/ecma262/#loadedmodulerequest-record
export interface LoadedModuleRequestRecord {
  readonly Specifier: string;
  readonly Attributes: readonly ImportAttributeRecord[];
  readonly Module: AbstractModuleRecord
}

// #resolvedbinding-record
export class ResolvedBindingRecord {
  readonly Module: AbstractModuleRecord;

  readonly BindingName: 'namespace' | 'deferred-namespace' | 'source' | JSStringValue;

  constructor({ Module, BindingName }: Pick<ResolvedBindingRecord, 'BindingName' | 'Module'>) {
    Assert(Module instanceof AbstractModuleRecord);
    Assert(BindingName === 'namespace' || BindingName === 'deferred-namespace' || BindingName === 'source' || BindingName instanceof JSStringValue);
    this.Module = Module;
    this.BindingName = BindingName;
  }

  mark(m: GCMarker) {
    m(this.Module);
  }
}

export type ModuleRecordHostDefinedPublic = unknown;
export type ModuleRecordHostDefined = {
  public?: ModuleRecordHostDefinedPublic;
  specifier?: string | undefined;
  readonly SourceTextModuleRecord?: typeof SourceTextModuleRecord;
  scriptId?: string;
  readonly doNotTrackScriptId?: boolean;
};
export interface AbstractModuleInit {
  readonly Realm: AbstractModuleRecord['Realm'];
  readonly Environment: AbstractModuleRecord['Environment'];
  readonly HostDefined: AbstractModuleRecord['HostDefined'];
  // change to non optional after proposal merged
  readonly ModuleSource?: AbstractModuleRecord['ModuleSource'];
  readonly Namespace: AbstractModuleRecord['Namespace'];
}

export interface ResolveSetItem {
  readonly Module: AbstractModuleRecord;
  readonly ExportName: string;
}

/** https://tc39.es/proposal-deferred-reexports/#sec-ResolveSetContains */
function ResolveSetContains(
  resolveSet: readonly (ResolveSetItem | AbstractModuleRecord)[],
  module: AbstractModuleRecord,
  exportName: string,
): boolean {
  for (const r of resolveSet) {
    if (r instanceof AbstractModuleRecord && r === module) {
      return true;
    }
    if (!(r instanceof AbstractModuleRecord) && r.Module === module && r.ExportName === exportName) {
      return true;
    }
  }
  return false;
}

function importedNamesContains(
  importedNames: Exclude<ImportedNamesValue, 'all'>,
  exportName: string | null,
): boolean {
  if (importedNames === 'all-but-default') {
    return exportName !== 'default';
  }
  return exportName !== null && importedNames.includes(exportName);
}

/** https://tc39.es/ecma262/#sec-abstract-module-records */
export abstract class AbstractModuleRecord {
  abstract LoadRequestedModules(importedNames?: ImportedNamesValue, hostDefined?: ModuleRecordHostDefined): PromiseObject;

  abstract GetExportedNames(exportStarSet?: AbstractModuleRecord[]): readonly string[];

  abstract ResolveExport(exportName: string, resolveSet?: ResolveSetItem[], deferNamespaceExportSet?: AbstractModuleRecord[]): 'ambiguous' | ResolvedBindingRecord | null;

  abstract Link(importedNames?: ImportedNamesValue): PlainCompletion<void>;

  abstract Evaluate(importedNames?: ImportedNamesValue): Evaluator<PromiseObject>;

  /** https://tc39.es/proposal-deferred-reexports/#abstract-getoptionalindirectexportsmodulerequests */
  GetOptionalIndirectExportsModuleRequests(_importedNames: ImportedNamesValue = 'all'): readonly ModuleRequestRecord[] {
    return [];
  }

  // https://github.com/tc39/ecma262/pull/3492/#abstract-get-module-source-kind
  GetModuleSourceKind(): string {
    // For Module Records that do not have a source representation (currently all ECMA-262-defined Module Records), GetModuleSourceKind() is never called.
    throw new Error('GetModuleSourceKind must be implemented by module records that have a ModuleSource');
  }

  readonly Realm: Realm;

  readonly Environment: ModuleEnvironmentRecord | undefined;

  readonly Namespace: ObjectValue | undefined = undefined;

  readonly DeferredNamespace: ObjectValue | undefined = undefined;

  readonly ModuleSource: ObjectValue | undefined = undefined;

  readonly HostDefined: ModuleRecordHostDefined | undefined;

  constructor(init: AbstractModuleInit) {
    this.Realm = init.Realm;
    this.Environment = init.Environment;
    this.ModuleSource = init.ModuleSource;
    this.HostDefined = init.HostDefined;
  }

  mark(m: GCMarker) {
    m(this.Realm);
    m(this.Environment);
    m(this.Namespace);
    m(this.DeferredNamespace);
    m(this.ModuleSource);
  }
}

export { AbstractModuleRecord as ModuleRecord };

export type CyclicModuleRecordInit = AbstractModuleInit & Readonly<Pick<CyclicModuleRecord, 'Status' | 'EvaluationError' | 'DFSAncestorIndex' | 'RequestedModules' | 'LoadedModules' | 'CycleRoot' | 'HasTLA' | 'AsyncEvaluationOrder' | 'TopLevelCapability' | 'AsyncParentModules' | 'PendingAsyncDependencies'>>;
export type CyclicModuleRecordStatus = 'new' | 'unlinked' | 'linking' | 'linked' | 'evaluating' | 'evaluating-async' | 'evaluated';
/** https://tc39.es/ecma262/#sec-cyclic-module-records */
export abstract class CyclicModuleRecord extends AbstractModuleRecord {
  Status: CyclicModuleRecordStatus;

  EvaluationError: ThrowCompletion | undefined;

  DFSAncestorIndex: number | undefined;

  readonly RequestedModules: readonly ModuleRequestRecord[];

  readonly LoadedModules: LoadedModuleRequestRecord[];

  readonly HasTLA: boolean;

  AsyncEvaluationOrder: 'unset' | number | 'done';

  AsyncParentModules: CyclicModuleRecord[];

  CycleRoot: CyclicModuleRecord | undefined;

  TopLevelCapability: PromiseCapabilityRecord | undefined;

  PendingAsyncDependencies: number | undefined;

  constructor(init: CyclicModuleRecordInit) {
    super(init);
    this.Status = init.Status;
    this.EvaluationError = init.EvaluationError;
    this.DFSAncestorIndex = init.DFSAncestorIndex;
    this.RequestedModules = init.RequestedModules;
    this.LoadedModules = init.LoadedModules;
    this.CycleRoot = init.CycleRoot;
    this.HasTLA = init.HasTLA;
    this.AsyncEvaluationOrder = init.AsyncEvaluationOrder;
    this.TopLevelCapability = init.TopLevelCapability;
    this.AsyncParentModules = init.AsyncParentModules;
    this.PendingAsyncDependencies = init.PendingAsyncDependencies;
  }

  abstract ExecuteModule(capability?: PromiseCapabilityRecord): ValueEvaluator;

  /** https://tc39.es/ecma262/#sec-LoadRequestedModules */
  LoadRequestedModules(importedNames: ImportedNamesValue = 'all', hostDefined?: ModuleRecordHostDefined) {
    const module = this;
    // 1. If importedNames is not present, set importedNames to ~all~.
    // 2. If hostDefined is not present, set hostDefined to empty.
    // 3. Let pc be ! NewPromiseCapability(%Promise%).
    const pc = X(NewPromiseCapability(surroundingAgent.intrinsic('%Promise%')));
    // 4. Let state be the GraphLoadingState Record { [[IsLoading]]: true, [[PendingModulesCount]]: 1, [[Visited]]: « », [[PromiseCapability]]: pc, [[HostDefined]]: hostDefined }.
    const state = new GraphLoadingState({
      PromiseCapability: pc,
      HostDefined: hostDefined,
    });
    // 5. Perform InnerModuleLoading(state, module, importedNames).
    InnerModuleLoading(state, module, importedNames, 'recursive-load');
    // 6. Return pc.[[Promise]].
    return pc.Promise;
  }

  /** https://tc39.es/ecma262/#sec-moduledeclarationlinking */
  Link(importedNames: ImportedNamesValue = 'all'): PlainCompletion<void> {
    const module = this;
    // 1. Assert: module.[[Status]] is one of unlinked, linked, evaluating-async, or evaluated.
    Assert(module.Status === 'unlinked' || module.Status === 'linked' || module.Status === 'evaluating-async' || module.Status === 'evaluated');
    // 2. If importedNames is not present, set importedNames to ~all~.
    //    (handled via the default parameter above)
    // 3. Let stack be a new empty List.
    const stack: CyclicModuleRecord[] = [];
    // 4. Let result be Completion(InnerModuleLinking(module, stack, 0)).
    const result = InnerModuleLinking(module, stack, 0);
    // 5. If result is an abrupt completion, then
    if (result instanceof AbruptCompletion) {
      // a. For each Cyclic Module Record m of stack, do
      for (const m of stack) {
        // i. Assert: m.[[Status]] is linking.
        Assert(m.Status === 'linking');
        // ii. Set m.[[Status]] to unlinked.
        m.Status = 'unlinked';
      }
      // b. Assert: module.[[Status]] is unlinked.
      Assert(module.Status === 'unlinked');
      // c. Return ? result.
      return Q(result);
    }
    // 6. Assert: module.[[Status]] is one of linked, evaluating-async, or evaluated.
    Assert(module.Status === 'linked' || module.Status === 'evaluating-async' || module.Status === 'evaluated');
    // 7. Assert: stack is empty.
    Assert(stack.length === 0);
    // 8. Let optionalIndirectRequests be module.GetOptionalIndirectExportsModuleRequests(importedNames).
    const optionalIndirectRequests = module.GetOptionalIndirectExportsModuleRequests(importedNames);
    // 9. For each ModuleRequest Record request of optionalIndirectRequests, do
    for (const request of optionalIndirectRequests) {
      // a. Let requiredModule be GetImportedModule(module, request).
      const requiredModule = GetImportedModule(module, request);
      // b. Assert: requiredModule.[[Status]] is one of unlinked, linked, evaluating-async, or evaluated.
      Assert(
        !(requiredModule instanceof CyclicModuleRecord)
        || requiredModule.Status === 'unlinked' || requiredModule.Status === 'linked'
        || requiredModule.Status === 'evaluating-async' || requiredModule.Status === 'evaluated',
      );
      // c. If requiredModule.[[Status]] is unlinked, perform ? requiredModule.Link(request.[[ImportedNames]]).
      if (requiredModule instanceof CyclicModuleRecord && requiredModule.Status === 'unlinked') {
        Q(requiredModule.Link(request.ImportedNames));
      }
    }
    // 10. Return unused.
    return NormalCompletion(undefined);
  }

  /** https://tc39.es/ecma262/#sec-moduleevaluation */
  * Evaluate(importedNames: ImportedNamesValue = []): Evaluator<PromiseObject> {
    let module: CyclicModuleRecord = this;

    // 1. Assert: None of module or any of its recursive dependencies have [[Status]] set to evaluating, linking, unlinked, or new.
    Assert((function getModules(module: AbstractModuleRecord, list: CyclicModuleRecord[]) {
      if (!(module instanceof CyclicModuleRecord) || list.includes(module)) {
        return list;
      }
      list.push(module);
      for (const r of module.RequestedModules) {
        getModules(GetImportedModule(module, r), list);
      }
      return list;
    }(this, [])).every((m) => m.Status !== 'evaluating' && m.Status !== 'linking' && m.Status !== 'unlinked' && m.Status !== 'new'));
    // 2. Assert: module.[[Status]] is one of linked, evaluating-async, or evaluated.
    Assert(module.Status === 'linked' || module.Status === 'evaluating-async' || module.Status === 'evaluated');
    // 3. If importedNames is not present, set importedNames to « ».
    // 4. If module.[[Status]] is either evaluating-async or evaluated, then
    if (module.Status === 'evaluating-async' || module.Status === 'evaluated') {
      // SPEC BUG: deferred-reexports deletes this CycleRoot redirection, even though
      // a subsequent evaluation must observe the CycleRoot's EvaluationError.
      // a. Assert: module.[[CycleRoot]] is not empty.
      Assert(module.CycleRoot !== undefined);
      // b. Set module to module.[[CycleRoot]].
      module = module.CycleRoot;
    }
    let topLevelPromise: PromiseObject;
    // 5. If module.[[TopLevelCapability]] is not empty, then
    if (module.TopLevelCapability !== undefined) {
      // a. Let topLevelPromise be module.[[TopLevelCapability]].[[Promise]].
      topLevelPromise = module.TopLevelCapability.Promise;
    } else { // 6. Else,
      // a. Assert: module.[[CycleRoot]] and module.[[TopLevelCapability]] are empty.
      // b. Let stack be a new empty List.
      const stack: CyclicModuleRecord[] = [];
      // c. Let capability be ! NewPromiseCapability(%Promise%).
      const capability = X(NewPromiseCapability(surroundingAgent.intrinsic('%Promise%')));
      // d. Set module.[[TopLevelCapability]] to capability.
      module.TopLevelCapability = capability;
      // e. Let result be Completion(InnerModuleEvaluation(module, stack, 0)).
      const result = yield* InnerModuleEvaluation(module, stack, 0);
      // f. If result is an abrupt completion, then
      if (result instanceof AbruptCompletion) {
        // i. For each Cyclic Module Record m of stack, do
        for (const m of stack) {
          // 1. Assert: m.[[Status]] is evaluating.
          Assert(m.Status === 'evaluating');
          // 2. Set m.[[Status]] to evaluated.
          m.Status = 'evaluated';
          // 3. Set m.[[EvaluationError]] to result.
          m.EvaluationError = result;
          m.CycleRoot = m;
        }
        // ii. Assert: module.[[Status]] is evaluated.
        // iii. Assert: module.[[EvaluationError]] is result.
        Assert((module.Status as CyclicModuleRecordStatus) === 'evaluated' && module.EvaluationError === result);
        // iv. Perform ! Call(capability.[[Reject]], undefined, « result.[[Value]] »).
        X(Call(capability.Reject, Value.undefined, [result.Value]));
      } else { // g. Else,
        const postStatus = module.Status as CyclicModuleRecordStatus;
        // i. Assert: module.[[Status]] is either evaluating-async or evaluated.
        Assert(postStatus === 'evaluating-async' || postStatus === 'evaluated');
        // ii. Assert: module.[[EvaluationError]] is empty.
        Assert(module.EvaluationError === undefined);
        // iii. If module.[[Status]] is evaluated, then
        if (postStatus === 'evaluated') {
          //    1. NOTE: This implies that evaluation of module completed synchronously.
          //    2. Assert: module.[[AsyncEvaluationOrder]] is unset.
          Assert(typeof module.AsyncEvaluationOrder !== 'number');
          //    3. Perform ! Call(capability.[[Resolve]], undefined, « undefined »).
          X(Call(capability.Resolve, Value.undefined, [Value.undefined]));
        }
        // iv. Assert: stack is empty.
        Assert(stack.length === 0);
      }
      // h. Let topLevelPromise be capability.[[Promise]].
      topLevelPromise = capability.Promise;
    }

    // 6. If topLevelPromise.[[PromiseState]] is rejected, return topLevelPromise.
    if (topLevelPromise.PromiseState === 'rejected') {
      return topLevelPromise;
    }

    // 7. Let optionalIndirectRequests be module.GetOptionalIndirectExportsModuleRequests(importedNames).
    const optionalIndirectRequests = module.GetOptionalIndirectExportsModuleRequests(importedNames);
    // 8. Let promises be « topLevelPromise ».
    const promises: PromiseObject[] = [topLevelPromise];
    // 9. For each ModuleRequest Record request of optionalIndirectRequests, do
    for (const request of optionalIndirectRequests) {
      // a. Let requiredModule be GetImportedModule(module, request).
      const requiredModule = GetImportedModule(module, request);
      // b. Assert: requiredModule.[[Status]] is one of linked, evaluating-async, or evaluated.
      Assert(
        !(requiredModule instanceof CyclicModuleRecord)
        || requiredModule.Status === 'linked'
        || requiredModule.Status === 'evaluating-async'
        || requiredModule.Status === 'evaluated',
      );
      // c. Let innerPromise be requiredModule.Evaluate(request.[[ImportedNames]]).
      const innerPromise = yield* requiredModule.Evaluate(request.ImportedNames);
      // d. If innerPromise.[[PromiseState]] is rejected, return innerPromise.
      if (innerPromise.PromiseState === 'rejected') {
        return innerPromise;
      }
      // e. Append innerPromise to promises.
      promises.push(innerPromise);
    }

    // 10. If promises contains a Promise P such that P.[[PromiseState]] is pending, then
    if (promises.some((p) => p.PromiseState === 'pending')) {
      // a. NOTE: If all modules in the graph are synchronous, the usage of promises is an internal specification detail.
      //    In that case, we do not use SafePerformPromiseAll to keep returning an already settled promise.
      // b. Return SafePerformPromiseAll(CreateListIteratorRecord(promises)).
      return SafePerformPromiseAll(promises);
    }
    // 11. Return topLevelPromise.
    return topLevelPromise;
  }

  override mark(m: GCMarker) {
    super.mark(m);
    m(this.EvaluationError);
    for (const v of this.LoadedModules) {
      m(v.Module);
    }
  }
}

export type SourceTextModuleRecordInit = CyclicModuleRecordInit & Pick<SourceTextModuleRecord, 'ImportMeta' | 'ECMAScriptCode' | 'Context' | 'ImportEntries' | 'LocalExportEntries' | 'IndirectExportEntries' | 'StarExportEntries'> & Partial<Pick<SourceTextModuleRecord, 'OptionalIndirectExportEntries'>>;
/** https://tc39.es/ecma262/#sec-source-text-module-records */
export class SourceTextModuleRecord extends CyclicModuleRecord {
  ImportMeta: ObjectValue | undefined;

  readonly ECMAScriptCode: ParseNode.Module;

  readonly Context: ExecutionContext | undefined;

  readonly ImportEntries: readonly ImportEntry[];

  readonly LocalExportEntries: readonly ExportEntry[];

  readonly IndirectExportEntries: readonly ExportEntry[];

  readonly StarExportEntries: readonly ExportEntry[];

  /** https://tc39.es/proposal-deferred-reexports/ — deferred re-export entries (`export defer ... from`). */
  readonly OptionalIndirectExportEntries: readonly ExportEntry[];

  constructor(init: SourceTextModuleRecordInit) {
    super(init);

    this.ImportMeta = init.ImportMeta;
    this.ECMAScriptCode = init.ECMAScriptCode;
    this.Context = init.Context;
    this.ImportEntries = init.ImportEntries;
    this.LocalExportEntries = init.LocalExportEntries;
    this.IndirectExportEntries = init.IndirectExportEntries;
    this.StarExportEntries = init.StarExportEntries;
    this.OptionalIndirectExportEntries = init.OptionalIndirectExportEntries ?? [];
  }

  /** https://tc39.es/ecma262/#sec-getexportednames */
  GetExportedNames(exportStarSet: AbstractModuleRecord[]) {
    const module = this;
    // 1. Assert: module.[[Status]] is not new.
    Assert(module.Status !== 'new');
    // 2. If exportStarSet is not present, set exportStarSet to a new empty List.
    if (!exportStarSet) {
      exportStarSet = [];
    }
    // 3. If exportStarSet contains module, then
    if (exportStarSet.includes(module)) {
      // a. Assert: We've reached the starting point of an import * circularity.
      // b. Return a new empty List.
      return [];
    }
    // 4. Append module to exportStarSet.
    exportStarSet.push(module);
    // 5. Let exportedNames be a new empty List.
    const exportedNames: string[] = [];
    // 6. For each ExportEntry Record e in module.[[LocalExportEntries]], do
    for (const e of module.LocalExportEntries) {
      // a. Assert: module provides the direct binding for this export.
      // b. Assert: e.[[ExportName]] is not null.
      Assert(e.ExportName !== null);
      // c. Append e.[[ExportName]] to exportedNames.
      exportedNames.push(e.ExportName);
    }
    // 6. Let allNamedExportEntries be the list-concatenation of module.[[LocalExportEntries]], module.[[IndirectExportEntries]], and module.[[OptionalIndirectExportEntries]].
    const allNamedExportEntries = [...module.IndirectExportEntries, ...module.OptionalIndirectExportEntries];
    // 7. For each ExportEntry Record e of allNamedExportEntries, do
    //    https://tc39.es/proposal-deferred-reexports/#sec-getexportednames
    for (const e of allNamedExportEntries) {
      // a. Assert: module imports a specific binding for this export.
      // b. Assert: e.[[ExportName]] is not null.
      Assert(e.ExportName !== null);
      // c. Append e.[[ExportName]] to exportedNames.
      exportedNames.push(e.ExportName);
    }
    // 8. For each ExportEntry Record e in module.[[StarExportEntries]], do
    for (const e of module.StarExportEntries) {
      // a. Let requestedModule be GetImportedModule(module, e.[[ModuleRequest]]).
      const requestedModule = GetImportedModule(module, e.ModuleRequest as ModuleRequestRecord);
      // b. Let starNames be requestedModule.GetExportedNames(exportStarSet).
      const starNames = requestedModule.GetExportedNames(exportStarSet);
      // c. For each element n of starNames, do
      for (const n of starNames) {
        // i. If SameValue(n, "default") is false, then
        if (n !== 'default') {
          // 1. If n is not an element of exportedNames, then
          if (!exportedNames.includes(n)) {
            // a. Append n to exportedNames.
            exportedNames.push(n);
          }
        }
      }
    }
    // 9. Return exportedNames.
    return exportedNames;
  }

  /** https://tc39.es/ecma262/#sec-resolveexport */
  ResolveExport(exportName: string, resolveSet?: ResolveSetItem[], deferNamespaceExportSet?: AbstractModuleRecord[]) {
    const module = this;
    // 1. Assert: module.[[Status]] is not new.
    Assert(module.Status !== 'new');
    // 2. If resolveSet is not present, set resolveSet to a new empty List.
    if (!resolveSet) {
      resolveSet = [];
    }
    if (!deferNamespaceExportSet) {
      deferNamespaceExportSet = [];
    }
    if (ResolveSetContains(resolveSet, module, exportName)) {
      return null;
    }
    // 4. Append the Record { [[Module]]: module, [[ExportName]]: exportName } to resolveSet.
    resolveSet.push({ Module: module, ExportName: exportName });
    // 5. For each ExportEntry Record e in module.[[LocalExportEntries]], do
    for (const e of module.LocalExportEntries) {
      // a. If SameValue(exportName, e.[[ExportName]]) is true, then
      if (exportName === e.ExportName) {
        // i. Assert: module provides the direct binding for this export.
        // ii. Return ResolvedBinding Record { [[Module]]: module, [[BindingName]]: e.[[LocalName]] }.
        return new ResolvedBindingRecord({
          Module: module,
          BindingName: Value(e.LocalName!),
        });
      }
    }
    // 6. Let allIndirectEntries be the list-concatenation of module.[[IndirectExportEntries]] and module.[[OptionalIndirectExportEntries]].
    const allIndirectEntries = [...module.IndirectExportEntries, ...module.OptionalIndirectExportEntries];
    // 7. For each ExportEntry Record e in allIndirectEntries, do
    //    https://tc39.es/proposal-deferred-reexports/#sec-resolveexport
    for (const e of allIndirectEntries) {
      // a. If SameValue(exportName, e.[[ExportName]]) is true, then
      if (exportName === e.ExportName) {
        Assert(!!e.ModuleRequest);
        // i. Let importedModule be GetImportedModule(module, e.[[ModuleRequest]]).
        const importedModule = GetImportedModule(module, e.ModuleRequest as ModuleRequestRecord);
        // ii. If e.[[ImportName]] is ~namespace~, then
        if (e.ImportName === 'namespace') {
          // 1. Assert: module does not provide the direct binding for this export
          Assert(!module.LocalExportEntries.some((entry) => entry.ExportName === exportName));
          Assert(e.NamespaceNamesFilter !== undefined && e.NamespaceNamesFilter.length === 0);
          if (module.OptionalIndirectExportEntries.includes(e)
            && NamespaceMemberIsUnresolvableOptional(
              deferNamespaceExportSet,
              module,
              exportName,
              importedModule,
              importedModule.GetExportedNames(),
              'allow-ambiguous',
            )) {
            return null;
          }
          if ((e.ModuleRequest as ModuleRequestRecord).Phase === 'defer') {
            // https://tc39.es/proposal-defer-import-eval/#sec-resolveexport
            return new ResolvedBindingRecord({
              Module: importedModule,
              BindingName: 'deferred-namespace',
            });
          } else {
            Assert((e.ModuleRequest as ModuleRequestRecord).Phase === 'evaluation');
            // 2. Return ResolvedBinding Record { [[Module]]: importedModule, [[BindingName]]: ~namespace~ }.
            return new ResolvedBindingRecord({
              Module: importedModule,
              BindingName: 'namespace',
            });
          }
        } else if (e.ImportName === 'filtered-namespace') {
          Assert(Array.isArray(e.NamespaceNamesFilter));
          if (module.OptionalIndirectExportEntries.includes(e)
            && NamespaceMemberIsUnresolvableOptional(
              deferNamespaceExportSet,
              module,
              exportName,
              importedModule,
              e.NamespaceNamesFilter,
              'disallow-ambiguous',
            )) {
            return null;
          }
          const localName = `*${exportName}*`;
          return new ResolvedBindingRecord({
            Module: module,
            BindingName: Value(localName),
          });
        } else if (e.ImportName === 'source') {
          // Assert: _module_ does not provide the direct binding for this export.
          return new ResolvedBindingRecord({
            Module: importedModule,
            BindingName: 'source',
          });
        } else { // iv. Else,
          // 1. Assert: module imports a specific binding for this export.
          Assert(e.ImportName instanceof JSStringValue);
          // 2. Return importedModule.ResolveExport(e.[[ImportName]], resolveSet).
          return importedModule.ResolveExport(e.ImportName.stringValue(), resolveSet, deferNamespaceExportSet);
        }
      }
    }
    // 7. If SameValue(exportName, "default") is true, then
    if (exportName === 'default') {
      // a. Assert: A default export was not explicitly defined by this module.
      Assert(!module.LocalExportEntries.some((entry) => entry.ExportName === exportName));
      // b. Return null.
      return null;
      // c. NOTE: A default export cannot be provided by an export * or export * from "mod" declaration.
    }
    // 8. Let starResolution be null.
    let starResolution = null;
    // 9. For each ExportEntry Record e in module.[[StarExportEntries]], do
    for (const e of module.StarExportEntries) {
      Assert(!!e.ModuleRequest);
      // a. Let importedModule be GetImportedModule(module, e.[[ModuleRequest]]).
      const importedModule = GetImportedModule(module, e.ModuleRequest as ModuleRequestRecord);
      // b. Let resolution be importedModule.ResolveExport(exportName, resolveSet).
      const resolution = importedModule.ResolveExport(exportName, resolveSet, deferNamespaceExportSet);
      // c. If resolution is "ambiguous", return "ambiguous".
      if (resolution === 'ambiguous') {
        return 'ambiguous';
      }
      // d. If resolution is not null, then
      if (resolution !== null) {
        // a. Assert: resolution is a ResolvedBinding Record.
        Assert(resolution instanceof ResolvedBindingRecord);
        // b. If starResolution is null, set starResolution to resolution.
        if (starResolution === null) {
          starResolution = resolution;
        } else { // c. Else,
          // 1. Assert: There is more than one * export that includes the requested name.
          // 2. If _resolution_.[[Module]] and _starResolution_.[[Module]] are not the same Module Record, return ~ambiguous~.
          if (resolution.Module !== starResolution.Module) {
            return 'ambiguous';
          }
          // 3. If _resolution_.[[BindingName]] is not _starResolution_.[[BindingName]], return ~ambiguous~.
          const l = resolution.BindingName;
          const r = starResolution.BindingName;
          if (l === r) {
            // pass
          } else if (l instanceof JSStringValue && !(r instanceof JSStringValue)) {
            return 'ambiguous';
          } else if (!(l instanceof JSStringValue) && r instanceof JSStringValue) {
            return 'ambiguous';
          } else if (l instanceof JSStringValue && r instanceof JSStringValue) {
            if (l.value !== r.value) return 'ambiguous';
          } else if (l !== r) {
            return 'ambiguous';
          } else throw OutOfRange.nonExhaustive(l);
        }
      }
    }
    // 11. Return starResolution.
    return starResolution;
  }

  /** https://tc39.es/proposal-deferred-reexports/#sec-GetOptionalIndirectExportsModuleRequests */
  override GetOptionalIndirectExportsModuleRequests(importedNames: ImportedNamesValue = 'all'): readonly ModuleRequestRecord[] {
    const requests: ModuleRequestRecord[] = [];
    for (const oie of this.OptionalIndirectExportEntries) {
      // a. If importedNames is all or importedNames contains oie.[[ExportName]], then
      if (importedNames === 'all' || importedNamesContains(importedNames, oie.ExportName)) {
        const nextRequest = oie.ModuleRequest as ModuleRequestRecord;
        let existingRequest: ModuleRequestRecord | undefined;
        for (const r of requests) {
          if (existingRequest === undefined && ModuleRequestsKeyEqual(r, nextRequest) && r.Phase === nextRequest.Phase) {
            existingRequest = r;
          }
        }
        let newImportedNames: ImportedNamesValue = 'all';
        Assert(oie.ImportName instanceof JSStringValue || oie.ImportName === 'namespace' || oie.ImportName === 'filtered-namespace');
        if (oie.ImportName instanceof JSStringValue) {
          newImportedNames = [oie.ImportName.stringValue()];
        }
        if (oie.ImportName === 'filtered-namespace') {
          Assert(Array.isArray(oie.NamespaceNamesFilter));
          newImportedNames = oie.NamespaceNamesFilter;
        }
        if (existingRequest === undefined) {
          const request: ModuleRequestRecord = {
            Specifier: nextRequest.Specifier,
            Attributes: nextRequest.Attributes,
            Phase: nextRequest.Phase,
            ImportedNames: newImportedNames,
          };
          requests.push(request);
        } else {
          (existingRequest as Mutable<ModuleRequestRecord>).ImportedNames = MergeImportedNames(existingRequest.ImportedNames, newImportedNames);
        }
      }
    }
    return requests;
  }

  /** https://tc39.es/ecma262/#sec-source-text-module-record-initialize-environment */
  InitializeEnvironment() {
    const module = this as Mutable<SourceTextModuleRecord>;
    // 1. For each ExportEntry Record e in module.[[IndirectExportEntries]], do
    for (const e of module.IndirectExportEntries) {
      Q(EnsureResolvableBinding(module, e.ExportName!, 'disallow-ambiguous'));
    }
    for (const e of module.StarExportEntries) {
      const importedModule = GetImportedModule(module, e.ModuleRequest as ModuleRequestRecord);
      for (const name of importedModule.GetExportedNames()) {
        if (name !== 'default') {
          Q(EnsureResolvableBinding(importedModule, name, 'disallow-ambiguous'));
        }
      }
    }
    // 2. Assert: All named exports from module are resolvable.
    // 3. Let realm be module.[[Realm]].
    const realm = module.Realm;
    // 4. Assert: realm is not undefined.
    Assert(!(realm instanceof UndefinedValue));
    // 5. Let env be NewModuleEnvironment(realm.[[GlobalEnv]]).
    const env = new ModuleEnvironmentRecord(realm.GlobalEnv);
    // 6. Set module.[[Environment]] to env.
    module.Environment = env;
    // 7. For each ImportEntry Record in in module.[[ImportEntries]], do
    for (const ie of module.ImportEntries) {
      // a. Let importedModule be GetImportedModule(module, in.[[ModuleRequest]]).
      const importedModule = GetImportedModule(module, ie.ModuleRequest);
      if (ie.ImportName === 'namespace') {
        // i. Let namespace be GetModuleNamespace(importedModule, phase, all).
        Assert(ie.ModuleRequest.Phase !== 'source');
        const namespacePhase = ie.ModuleRequest.Phase === 'defer' ? 'defer' : 'evaluation';
        for (const name of importedModule.GetExportedNames()) {
          Q(EnsureResolvableBinding(importedModule, name, 'allow-ambiguous'));
        }
        const namespace = GetModuleNamespace(importedModule, namespacePhase, 'all');
        // ii. Perform ! env.CreateImmutableBinding(in.[[LocalName]], true).
        X(env.CreateImmutableBinding(ie.LocalName, true));
        // iii. Call env.InitializeBinding(in.[[LocalName]], namespace).
        X(env.InitializeBinding(ie.LocalName, namespace));
      } else if (ie.ImportName === 'filtered-namespace-object') {
        for (const name of ie.NamespaceNamesFilter!) {
          Q(EnsureResolvableBinding(importedModule, name, 'disallow-ambiguous'));
        }
        Assert(ie.ModuleRequest.Phase !== 'source');
        const namespace = GetModuleNamespace(importedModule, ie.ModuleRequest.Phase, ie.NamespaceNamesFilter);
        X(env.CreateImmutableBinding(ie.LocalName, true));
        X(env.InitializeBinding(ie.LocalName, namespace));
      } else if (ie.ImportName === 'source') {
        const moduleSourceObject = importedModule.ModuleSource;
        if (moduleSourceObject === undefined) {
          return Throw.SyntaxError('Module source is not available');
        }
        X(env.CreateImmutableBinding(ie.LocalName, true));
        X(env.InitializeBinding(ie.LocalName, moduleSourceObject));
      } else { // c. Else,
        // i. Let resolution be importedModule.ResolveExport(in.[[ImportName]]).
        const resolution = importedModule.ResolveExport(ie.ImportName.stringValue());
        // ii. If resolution is null or "ambiguous", throw a SyntaxError exception.
        if (resolution === null || resolution === 'ambiguous') {
          const moduleName = importedModule.HostDefined?.specifier || '<anonymous module>';
          if (resolution === null) {
            return Throw.SyntaxError('Module "$1" does not have an export named $2', moduleName, ie.ImportName);
          }
          return Throw.SyntaxError('Export $1 from module "$2" is ambiguous', ie.ImportName, moduleName);
        }
        // iii. If resolution.[[BindingName]] is ~namespace~, then
        if (resolution.BindingName === 'namespace' || resolution.BindingName === 'deferred-namespace') {
          // https://tc39.es/proposal-defer-import-eval/#sec-source-text-module-record-initialize-environment
          const phase = resolution.BindingName === 'namespace' ? 'evaluation' : 'defer';
          // 1. Let namespace be GetModuleNamespace(resolution.[[Module]], phase, all).
          const namespace = GetModuleNamespace(resolution.Module, phase, 'all');
          // 2. Perform ! env.CreateImmutableBinding(in.[[LocalName]], true).
          X(env.CreateImmutableBinding(ie.LocalName, true));
          // 3. Call env.InitializeBinding(in.[[LocalName]], namespace).
          X(env.InitializeBinding(ie.LocalName, namespace));
        } else if (resolution.BindingName === 'source') {
          const moduleSourceObject = resolution.Module.ModuleSource;
          if (moduleSourceObject === undefined) {
            return Throw.SyntaxError('Module source is not available');
          }
          X(env.CreateImmutableBinding(ie.LocalName, true));
          X(env.InitializeBinding(ie.LocalName, moduleSourceObject));
        } else { // iv. Else,
          // 1. Call env.CreateImportBinding(in.[[LocalName]], resolution.[[Module]], resolution.[[BindingName]]).
          X(env.CreateImportBinding(ie.LocalName, resolution.Module, resolution.BindingName.stringValue()));
        }
      }
    }
    for (const ie of module.IndirectExportEntries) {
      if (ie.ImportName === 'filtered-namespace') {
        const localName = `*${ie.ExportName!}*`;
        const importedModule = GetImportedModule(module, ie.ModuleRequest as ModuleRequestRecord);
        for (const name of ie.NamespaceNamesFilter!) {
          Q(EnsureResolvableBinding(importedModule, name, 'disallow-ambiguous'));
        }
        const requestPhase = (ie.ModuleRequest as ModuleRequestRecord).Phase;
        Assert(requestPhase !== 'source');
        const filteredNamespace = GetModuleNamespace(importedModule, requestPhase === 'defer' ? 'defer' : 'evaluation', ie.NamespaceNamesFilter);
        X(env.CreateImmutableBinding(localName, true));
        X(env.InitializeBinding(localName, filteredNamespace));
      }
    }
    for (const oie of module.OptionalIndirectExportEntries) {
      if (oie.ImportName === 'filtered-namespace') {
        const localName = `*${oie.ExportName!}*`;
        const initializationSteps = () => {
          const importedModule = GetImportedModule(module, oie.ModuleRequest as ModuleRequestRecord);
          return GetModuleNamespace(
            importedModule,
            (oie.ModuleRequest as ModuleRequestRecord).Phase as 'defer' | 'evaluation',
            oie.NamespaceNamesFilter!,
          );
        };
        X(env.CreateDeferredInitializationBinding(localName, initializationSteps));
      }
    }
    // 8. Let moduleContext be a new ECMAScript code execution context.
    const moduleContext = new ExecutionContext();
    // 9. Set the Function of moduleContext to null.
    moduleContext.Function = Value.null;
    // 10. Assert: module.[[Realm]] is not undefined.
    Assert(!(module.Realm instanceof UndefinedValue));
    // 11. Set the Realm of moduleContext to module.[[Realm]].
    moduleContext.Realm = module.Realm;
    // 12. Set the ScriptOrModule of moduleContext to module.
    moduleContext.ScriptOrModule = module;
    // 13. Set the VariableEnvironment of moduleContext to module.[[Environment]].
    moduleContext.VariableEnvironment = module.Environment!;
    // 14. Set the LexicalEnvironment of moduleContext to module.[[Environment]].
    moduleContext.LexicalEnvironment = module.Environment!;
    // 15. Set the PrivateEnvironment of moduleContext to null.
    moduleContext.PrivateEnvironment = null;
    // 16. Set module.[[Context]] to moduleContext.
    module.Context = moduleContext;
    // 17. Push moduleContext onto the execution context stack; moduleContext is now the running execution context.
    surroundingAgent.executionContextStack.push(moduleContext);
    // 18. Let code be module.[[ECMAScriptCode]].
    const code = module.ECMAScriptCode;
    // 19. Let varDeclarations be the VarScopedDeclarations of code.
    const varDeclarations = VarScopedDeclarations(code);
    // 20. Let declaredVarNames be a new empty List.
    const declaredVarNames = new Set<string>();
    // 21. For each element d in varDeclarations, do
    for (const d of varDeclarations) {
      // a. For each element dn of the BoundNames of d, do
      for (const dn of BoundNames(d)) {
        // i. If dn is not an element of declaredVarNames, then
        if (!declaredVarNames.has(dn)) {
          // 1. Perform ! env.CreateMutableBinding(dn, false).
          X(env.CreateMutableBinding(dn, false));
          // 2. Call env.InitializeBinding(dn, undefined).
          X(env.InitializeBinding(dn, Value.undefined));
          // 3. Append dn to declaredVarNames.
          declaredVarNames.add(dn);
        }
      }
    }
    // 22. Let lexDeclarations be the LexicallyScopedDeclarations of code.
    const lexDeclarations = LexicallyScopedDeclarations(code);
    // 24. For each element d in lexDeclarations, do
    for (const d of lexDeclarations) {
      // a. For each element dn of the BoundNames of d, do
      for (const dn of BoundNames(d)) {
        // i. If IsConstantDeclaration of d is true, then
        if (IsConstantDeclaration(d)) {
          // 1. Perform ! env.CreateImmutableBinding(dn, true).
          X(env.CreateImmutableBinding(dn, true));
        } else { // ii. Else,
          // 1. Perform ! env.CreateMutableBinding(dn, false).
          X(env.CreateMutableBinding(dn, false));
        }
        // iii. If d is a FunctionDeclaration, a GeneratorDeclaration, an AsyncFunctionDeclaration, or an AsyncGeneratorDeclaration, then
        if (d.type === 'FunctionDeclaration'
          || d.type === 'GeneratorDeclaration'
          || d.type === 'AsyncFunctionDeclaration'
          || d.type === 'AsyncGeneratorDeclaration') {
          // 1. Let fo be InstantiateFunctionObject of d with argument env.
          const fo = InstantiateFunctionObject(d, env, null);
          // 2. Call env.InitializeBinding(dn, fo).
          X(env.InitializeBinding(dn, fo));
        }
      }
    }
    // 25. Remove moduleContext from the execution context stack.
    surroundingAgent.executionContextStack.pop(moduleContext);
    // 26. Return unused.
    return NormalCompletion(undefined);
  }

  /** https://tc39.es/ecma262/#sec-source-text-module-record-execute-module */
  * ExecuteModule(capability?: PromiseCapabilityRecord): ValueEvaluator {
    // 1. Let module be this Source Text Module Record.
    const module = this;
    // 2. Assert: module has been linked and declarations in its module environment have been instantiated.
    // 3. Let moduleContext be module.[[Context]].
    const moduleContext = module.Context!;
    const env = module.Environment!;
    if (!module.HasTLA) {
      Assert(capability === undefined);
      // 4. Push moduleContext onto the execution context stack; moduleContext is now the running execution context.
      surroundingAgent.executionContextStack.push(moduleContext);
      // 5. Let result be the result of evaluating module.[[ECMAScriptCode]].
      let result = EnsureCompletion(yield* Evaluate(module.ECMAScriptCode));
      result = yield* DisposeResources(env.DisposableResourceStack, result);
      // 6. Suspend moduleContext and remove it from the execution context stack.
      // 7. Resume the context that is now on the top of the execution context stack as the running execution context.
      surroundingAgent.executionContextStack.pop(moduleContext);
      // 8. Return Completion(result).
      return Q(result);
    } else { // (*TopLevelAwait)
      // a. Assert: capability is a PromiseCapability Record.
      Assert(capability instanceof PromiseCapabilityRecord);
      // b. Perform ! AsyncBlockStart(capability, module.[[ECMAScriptCode]], moduleCxt).
      X(yield* AsyncBlockStart(capability, function* evaluateModule(): ValueEvaluator {
        let result = EnsureCompletion(yield* Evaluate(module.ECMAScriptCode));
        result = yield* DisposeResources(env.DisposableResourceStack, result);
        return result;
      }, moduleContext));
      // c. Return.
      return Value.undefined;
    }
  }

  override mark(m: GCMarker) {
    super.mark(m);
    m(this.ImportMeta);
    m(this.Context);
  }
}

function EnsureResolvableBinding(
  module: AbstractModuleRecord,
  name: string,
  onAmbiguous: 'allow-ambiguous' | 'disallow-ambiguous',
): PlainCompletion<void> {
  const resolution = module.ResolveExport(name);
  if (resolution === null) {
    return Throw.SyntaxError('Module "$1" does not have an export named $2', module.HostDefined?.specifier || '<anonymous module>', name);
  }
  if (onAmbiguous === 'disallow-ambiguous') {
    if (resolution === 'ambiguous') {
      return Throw.SyntaxError('Export $1 from module "$2" is ambiguous', name, module.HostDefined?.specifier || '<anonymous module>');
    }
    Assert(resolution instanceof ResolvedBindingRecord);
  }
}

function NamespaceMemberIsUnresolvableOptional(
  deferNamespaceExportSet: AbstractModuleRecord[],
  reexporterModule: AbstractModuleRecord,
  exportName: string,
  namespaceModule: AbstractModuleRecord,
  namespaceNames: readonly string[],
  onAmbiguous: 'allow-ambiguous' | 'disallow-ambiguous',
): boolean {
  if (ResolveSetContains(deferNamespaceExportSet, reexporterModule, exportName)) {
    return false;
  }
  deferNamespaceExportSet.push(reexporterModule);
  Assert(ResolveSetContains(deferNamespaceExportSet, reexporterModule, exportName));
  for (const name of namespaceNames) {
    const resolution = namespaceModule.ResolveExport(name, [], deferNamespaceExportSet);
    if (resolution === null) return true;
    if (resolution === 'ambiguous' && onAmbiguous === 'disallow-ambiguous') return true;
  }
  return false;
}

export type SyntheticModuleRecordInit = AbstractModuleInit & Pick<SyntheticModuleRecord, 'ExportNames' | 'EvaluationSteps'>;
/** https://tc39.es/ecma262/#sec-synthetic-module-records */
export class SyntheticModuleRecord extends AbstractModuleRecord {
  override LoadRequestedModules(): PromiseObject {
    const promise = X(NewPromiseCapability(surroundingAgent.intrinsic('%Promise%')));
    X(Call(promise.Resolve, Value.undefined, [Value.undefined]));
    return promise.Promise;
  }

  readonly ExportNames: readonly string[];

  readonly EvaluationSteps: (module: SyntheticModuleRecord) => PlainEvaluator | Completion<unknown> | void;

  constructor(init: SyntheticModuleRecordInit) {
    super(init);

    this.ExportNames = init.ExportNames;
    this.EvaluationSteps = init.EvaluationSteps;
  }

  /** https://tc39.es/ecma262/#sec-synthetic-module-record-getexportednames */
  GetExportedNames() {
    const module = this;
    // 1. Return module.[[ExportNames]].
    return module.ExportNames;
  }

  /** https://tc39.es/ecma262/#sec-synthetic-module-record-resolveexport */
  ResolveExport(exportName: string): ResolvedBindingRecord | null {
    const module = this;
    // 1. If module.[[ExportNames]] does not contain exportName, return null.
    // 2. Return ResolvedBinding Record { [[Module]]: module, [[BindingName]]: exportName }.
    for (const e of module.ExportNames) {
      if (e === exportName) {
        return new ResolvedBindingRecord({ Module: module, BindingName: Value(exportName) });
      }
    }
    return null;
  }

  /** https://tc39.es/ecma262/#sec-synthetic-module-record-link */
  Link() {
    const module = this;
    // 1. Let realm be module.[[Realm]].
    const realm = module.Realm;
    // 2. Assert: realm is not undefined.
    Assert(!(realm instanceof UndefinedValue));
    // 3. Let env be NewModuleEnvironment(realm.[[GlobalEnv]]).
    const env = new ModuleEnvironmentRecord(realm.GlobalEnv);
    // 4. Set module.[[Environment]] to env.
    (module as Mutable<AbstractModuleRecord>).Environment = env;
    // 5. For each exportName in module.[[ExportNames]],
    for (const exportName of module.ExportNames) {
      // a. Perform ! env.CreateMutableBinding(exportName, false).
      X(env.CreateMutableBinding(exportName, false));
      // b. Perform ! env.InitializeBinding(exportName, undefined).
      X(env.InitializeBinding(exportName, Value.undefined));
    }
    // 8. Return undefined.
    return undefined;
  }

  /** https://tc39.es/ecma262/#sec-synthetic-module-record-evaluate */
  * Evaluate(): Evaluator<PromiseObject> {
    const module = this;
    // 1. Suspend the currently running execution context.
    // 2. Let moduleContext be a new ECMAScript code execution context.
    const moduleContext = new ExecutionContext();
    // 3. Set the Function of moduleContext to null.
    moduleContext.Function = Value.null;
    // 4. Set the Realm of moduleContext to module.[[Realm]].
    moduleContext.Realm = module.Realm;
    // 5. Set the ScriptOrModule of moduleContext to module.
    moduleContext.ScriptOrModule = module;
    // 6. Set the VariableEnvironment of moduleContext to module.[[Environment]].
    moduleContext.VariableEnvironment = module.Environment!;
    // 7. Set the LexicalEnvironment of moduleContext to module.[[Environment]].
    moduleContext.LexicalEnvironment = module.Environment!;
    moduleContext.PrivateEnvironment = null;
    // 8. Push moduleContext on to the execution context stack; moduleContext is now the running execution context.
    surroundingAgent.executionContextStack.push(moduleContext);
    // 9. Let steps be module.[[EvaluationSteps]].
    const steps = module.EvaluationSteps;
    // 10. Let result be Completion(steps(module)).
    let result = steps(module);
    if (isEvaluator(result)) {
      result = yield* result;
    }
    // 11. Suspend moduleContext and remove it from the execution context stack.
    // 12. Resume the context that is now on the top of the execution context stack as the running execution context.
    surroundingAgent.executionContextStack.pop(moduleContext);
    // 13. Let pc be ! NewPromiseCapability(%Promise%).
    const pc = X(NewPromiseCapability(surroundingAgent.intrinsic('%Promise%')));
    // 14. IfAbruptRejectPromise(result, pc).
    IfAbruptRejectPromise(result, pc);
    // 15. Perform ! Call(pc.[[Resolve]], undefined, « undefined »).
    X(Call(pc.Resolve, Value.undefined, [Value.undefined]));
    // 16. Return pc.[[Promise]].
    return pc.Promise;
  }

  * SetSyntheticExport(name: string, value: Value): PlainEvaluator {
    const module = this;
    // 1. Return module.[[Environment]].SetMutableBinding(name, value, true).
    return yield* module.Environment!.SetMutableBinding(name, value, true);
  }
}

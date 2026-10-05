import { IncrementModuleAsyncEvaluationCount } from '../execution-context/Agent.mts';
import type { Mutable } from '../utils/language.mts';
import {
  CyclicModuleRecord,
  SyntheticModuleRecord,
  ResolvedBindingRecord,
  AbstractModuleRecord,
  type ModuleRecordHostDefined,
  ModuleRecord,
} from '../modules.mts';
import {
  ObjectValue, Value,
} from '../value.mts';
import {
  Q, X, NormalCompletion, ThrowCompletion, AbruptCompletion,
  type PlainCompletion,
  EnsureCompletion,
} from '../completion.mjs';
import {
  Assert,
  ModuleNamespaceCreate,
  NewPromiseCapability,
  PerformPromiseThen,
  CreateBuiltinFunction,
  Call,
  ContinueDynamicImport,
  PromiseCapabilityRecord,
  Construct,
  type ArrayBufferObject,
} from './all.mts';
import {
  surroundingAgent, HostLoadImportedModule, HostPromiseRejectionTracker,
} from '#self';
import {
  Realm,
  HostGetSupportedImportAttributes,
  ModuleRequestsKeyEqual,
  type Arguments, type ImportAttributeRecord, type ImportedNamesValue, type ModuleRequestRecord, type PlainEvaluator, type ScriptRecord, type SourceTextModuleRecord,
  Throw,
  type HostLoadImportedModulePayloadOpaque,
} from '#self';

const DEFAULT_NAME = 'default';

function isAllNames(v: ImportedNamesValue): v is 'all' {
  return v === 'all';
}
function isAllButDefault(v: ImportedNamesValue): v is 'all-but-default' {
  return v === 'all-but-default';
}
/** https://tc39.es/proposal-deferred-reexports/#sec-MergeImportedNames */
export function MergeImportedNames(a: ImportedNamesValue, b: ImportedNamesValue): ImportedNamesValue {
  // 1. If a is all or b is all, return all.
  if (isAllNames(a) || isAllNames(b)) {
    return 'all';
  }
  // 2. If a is all-but-default and b is a List of Strings that contains "default", return all.
  if (isAllButDefault(a) && !isAllButDefault(b) && b.includes(DEFAULT_NAME)) {
    return 'all';
  }
  // 3. If b is all-but-default and a is a List of Strings that contains "default", return all.
  if (isAllButDefault(b) && !isAllButDefault(a) && a.includes(DEFAULT_NAME)) {
    return 'all';
  }
  // 4. If a is all-but-default or b is all-but-default, return all-but-default.
  if (isAllButDefault(a) || isAllButDefault(b)) {
    return 'all-but-default';
  }
  // 5. Assert: a and b are a List of Strings.
  // 6. Let merged be a copy of the List a.
  const result: string[] = [...a];
  // 7. For each String name of b, do
  for (const name of b) {
    // a. If merged does not contain name, then
    //    i. Append name to merged.
    if (!result.includes(name)) {
      result.push(name);
    }
  }
  // 8. Return merged.
  return result;
}

/** https://tc39.es/proposal-deferred-reexports/#sec-ExcludeImportedNames */
export function ExcludeImportedNames(a: ImportedNamesValue, b: ImportedNamesValue): ImportedNamesValue {
  // 1. If b is all, return « ».
  if (isAllNames(b)) {
    return [];
  }
  // 2. If a is all, return all.
  if (isAllNames(a)) {
    return 'all';
  }
  // 3. If a is all-but-default, then
  if (isAllButDefault(a)) {
    // a. If b is all-but-default, return « ».
    if (isAllButDefault(b)) {
      return [];
    }
    // b. Return all-but-default.
    return 'all-but-default';
  }
  // 4. Assert: a is a List of Strings.
  const aList = a;
  // 5. If b is all-but-default, then
  if (isAllButDefault(b)) {
    // a. If a contains "default", return « "default" ».
    if (aList.includes(DEFAULT_NAME)) {
      return [DEFAULT_NAME];
    }
    // b. Return « ».
    return [];
  }
  // 6. Assert: b is a List of Strings.
  const bList = b;
  // 7. Return a new List containing all the elements of a that are not also elements of b.
  const result: string[] = [];
  for (const name of aList) {
    if (!bList.includes(name)) {
      result.push(name);
    }
  }
  return result;
}

/** https://tc39.es/proposal-deferred-reexports/#sec-ListAppendUnique */
export function ListAppendUnique<T>(target: T[], items: Iterable<T>): void {
  const seen = new Set(target);
  // 1. For each Record r of list2, do
  for (const item of items) {
    // a. If list1 does not contain r, append r to list1.
    if (!seen.has(item)) {
      seen.add(item);
      target.push(item);
    }
  }
  // 2. Return unused.
}

export interface PreviouslyImportedNamesEntry {
  readonly Module: AbstractModuleRecord;
  ImportedNames: ImportedNamesValue;
}

/** https://tc39.es/proposal-deferred-reexports/#sec-GetNewOptionalIndirectExportsModuleRequests */
export function GetNewOptionalIndirectExportsModuleRequests(
  module: AbstractModuleRecord,
  importedNames: ImportedNamesValue,
  previouslyImportedNames: PreviouslyImportedNamesEntry[],
): readonly ModuleRequestRecord[] {
  // 1. Assert: previouslyImportedNames contains a Record whose [[Module]] field is module.
  // 2. Let previous be the Record in previouslyImportedNames whose [[Module]] field is module.
  const previous = previouslyImportedNames.find((p) => p.Module === module);
  Assert(previous !== undefined);
  // 3. Let newImportedNames be ExcludeImportedNames(importedNames, previous.[[ImportedNames]]).
  const newImportedNames = ExcludeImportedNames(importedNames, previous!.ImportedNames);
  // 4. Set previous.[[ImportedNames]] to MergeImportedNames(previous.[[ImportedNames]], newImportedNames).
  previous!.ImportedNames = MergeImportedNames(previous!.ImportedNames, newImportedNames);
  // 5. Return module.GetOptionalIndirectExportsModuleRequests(newImportedNames).
  return module.GetOptionalIndirectExportsModuleRequests(newImportedNames);
}

export class GraphLoadingState {
  readonly PromiseCapability: PromiseCapabilityRecord;

  readonly HostDefined?: ModuleRecordHostDefined;

  IsLoading = true;

  // https://tc39.es/proposal-deferred-reexports/#graphloadingstate-record
  // [[Visited]] on spec is a List of Records { [[Module]], [[ImportedNames]] }.
  // Here we splits this into a Set<CyclicModuleRecord> (visited modules) and
  // PreviouslyImportedNames (per-module merged ImportedNames).
  readonly Visited = new Set<CyclicModuleRecord>();

  PendingModules = 1;

  // Companion to [[Visited]] that tracks the merged [[ImportedNames]] per module.
  readonly PreviouslyImportedNames: PreviouslyImportedNamesEntry[];

  constructor({ PromiseCapability, HostDefined, PreviouslyImportedNames = [] }: Pick<GraphLoadingState, 'PromiseCapability' | 'HostDefined'> & { PreviouslyImportedNames?: PreviouslyImportedNamesEntry[] }) {
    this.PromiseCapability = PromiseCapability;
    this.HostDefined = HostDefined;
    this.PreviouslyImportedNames = PreviouslyImportedNames;
  }
}

/** https://tc39.es/ecma262/#sec-InnerModuleLoading */
export function InnerModuleLoading(
  state: GraphLoadingState,
  module: AbstractModuleRecord,
  importedNames: ImportedNamesValue = 'all',
  loadType: 'single' | 'recursive-load',
) {
  // 1. Assert: state.[[IsLoading]] is true.
  Assert(Boolean(state.IsLoading === true));

  // 2. If loadType is 'recursive-load' and module is a Cyclic Module Record, then
  if (loadType === 'recursive-load' && module instanceof CyclicModuleRecord) {
    // a. Let requestsToLoad be a new empty List.
    let requestsToLoad: readonly ModuleRequestRecord[] = [];
    // b. If state.[[Visited]] does not contain a Record whose [[Module]] field is module, then
    if (!state.Visited.has(module)) {
      // i. If module.[[Status]] is new, set requestsToLoad to module.[[RequestedModules]].
      if (module.Status === 'new') {
        requestsToLoad = module.RequestedModules;
      }
      // ii. Append the Record { [[Module]]: module, [[ImportedNames]]: « » } to state.[[Visited]].
      state.Visited.add(module);
      state.PreviouslyImportedNames.push({ Module: module, ImportedNames: [] });
    }
    // c. Let optionalIndirectRequests be GetNewOptionalIndirectExportsModuleRequests(module, importedNames, state.[[Visited]]).
    const optionalIndirectRequests = GetNewOptionalIndirectExportsModuleRequests(module, importedNames, state.PreviouslyImportedNames);
    // d. Set requestsToLoad to the list-concatenation of requestsToLoad and optionalIndirectRequests.
    requestsToLoad = [...requestsToLoad, ...optionalIndirectRequests];
    // e. Let requestedModulesCount be the number of elements in requestsToLoad.
    const requestedModulesCount = requestsToLoad.length;
    // f. Set state.[[PendingModulesCount]] to state.[[PendingModulesCount]] + requestedModulesCount.
    state.PendingModules += requestedModulesCount;
    // g. For each ModuleRequest Record request of requestsToLoad, do
    for (const request of requestsToLoad) {
      // i. If AllImportAttributesSupported(request.[[Attributes]]) is false, then
      const invalidAttributeKey = AllImportAttributesSupported(request.Attributes);
      if (invalidAttributeKey) {
        // 1. Let error be ThrowCompletion(a newly created SyntaxError object).
        const error = Throw.SyntaxError('Unsupported import attribute $1', invalidAttributeKey);
        // 2. Perform ContinueModuleLoading(state, error, request.[[ImportedNames]], request.[[Phase]]).
        ContinueModuleLoading(state, error, request.ImportedNames, request.Phase);
      } else {
        // ii. Else if module.[[LoadedModules]] contains a LoadedModuleRequest Record record such that ModuleRequestsKeyEqual(record, request) is true, then
        const record = getRecordWithSpecifier(module.LoadedModules, request);
        if (record !== undefined) {
          // 1. Perform InnerModuleLoading(state, record.[[Module]], request.[[ImportedNames]]).
          //    For source-phase requests, only the module itself loads (no recursion).
          const innerLoadType = request.Phase === 'source' ? 'single' : 'recursive-load';
          InnerModuleLoading(state, record.Module, request.ImportedNames, innerLoadType);
        } else {
          // iii. Else,
          // 1. Perform HostLoadImportedModule(module, request, state.[[HostDefined]], state).
          // 2. NOTE: HostLoadImportedModule will call FinishLoadingImportedModule, which re-enters
          //    the graph loading process through ContinueModuleLoading.
          HostLoadImportedModule(module, request, state.HostDefined, { data: state });
        }
      }
      // iv. If state.[[IsLoading]] is false, return unused.
      if (state.IsLoading === false) {
        return;
      }
    }
  }

  // 3. Assert: state.[[PendingModulesCount]] ≥ 1.
  Assert(state.PendingModules >= 1);
  // 4. Set state.[[PendingModulesCount]] to state.[[PendingModulesCount]] - 1.
  state.PendingModules -= 1;
  // 5. If state.[[PendingModulesCount]] = 0, then
  if (state.PendingModules === 0) {
    // a. Set state.[[IsLoading]] to false.
    state.IsLoading = false;
    // b. For each Record loaded of state.[[Visited]], do
    for (const loaded of state.Visited) {
      // i. If loaded.[[Module]].[[Status]] is new, set loaded.[[Module]].[[Status]] to unlinked.
      if (loaded.Status === 'new') {
        loaded.Status = 'unlinked';
      }
    }
    // c. Perform ! Call(state.[[PromiseCapability]].[[Resolve]], undefined, « undefined »).
    X(Call(state.PromiseCapability.Resolve, Value.undefined, [Value.undefined]));
  }

  // 6. Return unused.
}

/** https://tc39.es/ecma262/#sec-ContinueModuleLoading */
export function ContinueModuleLoading(
  state: GraphLoadingState,
  moduleCompletion: PlainCompletion<AbstractModuleRecord>,
  importedNames: ImportedNamesValue,
  phase: 'source' | 'defer' | 'evaluation',
) {
  // 1. If state.[[IsLoading]] is false, return unused.
  if (state.IsLoading === false) {
    return;
  }
  moduleCompletion = EnsureCompletion(moduleCompletion);
  // 2. If moduleCompletion is a normal completion, then
  if (moduleCompletion instanceof NormalCompletion) {
    // a. Perform InnerModuleLoading(state, moduleCompletion.[[Value]], importedNames).
    //    For source-phase requests, only the module itself loads (no recursion).
    const loadType = phase === 'source' ? 'single' : 'recursive-load';
    InnerModuleLoading(state, moduleCompletion.Value, importedNames, loadType);
  } else { // 3. Else,
    // a. Set state.[[IsLoading]] to false.
    state.IsLoading = false;
    // b. Perform ! Call(state.[[PromiseCapability]].[[Reject]], undefined, « moduleCompletion.[[Value]] »).
    X(Call(state.PromiseCapability.Reject, Value.undefined, [moduleCompletion.Value]));
  }

  // 4. Return unused.
}

/** https://tc39.es/proposal-deferred-reexports/#sec-BuildLinkingList */
export function BuildLinkingList(
  linkingList: AbstractModuleRecord[],
  referrer: CyclicModuleRecord,
  moduleRequests: readonly ModuleRequestRecord[],
  previouslyImportedNames: PreviouslyImportedNamesEntry[],
): void {
  // 1. For each ModuleRequest Record request of moduleRequests, do
  for (const request of moduleRequests) {
    // Source-phase requests are not linked; the module's source is provided
    // directly without preparing its bindings.
    if (request.Phase === 'source') {
      continue;
    }
    // a. Let requiredModule be GetImportedModule(referrer, request).
    const requiredModule = GetImportedModule(referrer, request);
    // b. If linkingList does not contain requiredModule, then
    if (!linkingList.includes(requiredModule)) {
      // i. Append requiredModule to linkingList.
      linkingList.push(requiredModule);
      // ii. If requiredModule is a Cyclic Module Record, then
      if (requiredModule instanceof CyclicModuleRecord) {
        // 1. Assert: previouslyImportedNames does not contain a Record whose [[Module]] field is requiredModule.
        Assert(!previouslyImportedNames.some((p) => p.Module === requiredModule));
        // 2. Append the Record { [[Module]]: requiredModule, [[ImportedNames]]: « » } to previouslyImportedNames.
        previouslyImportedNames.push({ Module: requiredModule, ImportedNames: [] });
      }
    }
    // c. If requiredModule is a Cyclic Module Record, then
    if (requiredModule instanceof CyclicModuleRecord) {
      // i. Let optionalIndirectRequests be GetNewOptionalIndirectExportsModuleRequests(requiredModule, request.[[ImportedNames]], previouslyImportedNames).
      const optionalIndirectRequests = GetNewOptionalIndirectExportsModuleRequests(requiredModule, request.ImportedNames, previouslyImportedNames);
      // ii. Perform BuildLinkingList(linkingList, requiredModule, optionalIndirectRequests, previouslyImportedNames).
      BuildLinkingList(linkingList, requiredModule, optionalIndirectRequests, previouslyImportedNames);
    }
  }
  // 2. Return unused.
}

/** https://tc39.es/ecma262/#sec-InnerModuleLinking */
export function InnerModuleLinking(
  module: AbstractModuleRecord,
  stack: CyclicModuleRecord[],
  index: number,
): PlainCompletion<number> {
  // 1. If module is not a Cyclic Module Record, then
  if (!(module instanceof CyclicModuleRecord)) {
    // a. Perform ? module.Link().
    Q(module.Link());
    // b. Return index.
    return index;
  }
  // 2. If module.[[Status]] is one of linking, linked, evaluating-async, or evaluated, then
  if (module.Status === 'linking' || module.Status === 'linked' || module.Status === 'evaluating-async' || module.Status === 'evaluated') {
    // a. Return index.
    return index;
  }
  // 3. Assert: module.[[Status]] is unlinked.
  Assert(module.Status === 'unlinked');
  // 4. Set module.[[Status]] to linking.
  module.Status = 'linking';
  // 5. Let moduleIndex be index.
  const moduleIndex = index;
  // 6. Set module.[[DFSAncestorIndex]] to index.
  module.DFSAncestorIndex = index;
  // 7. Set index to index + 1.
  index += 1;
  // 8. Append module to stack.
  stack.push(module);
  // 9. Let linkingList be « ».
  const linkingList: AbstractModuleRecord[] = [];
  // 10. Perform BuildLinkingList(linkingList, module, module.[[RequestedModules]], « »).
  BuildLinkingList(linkingList, module, module.RequestedModules, []);
  // 11. For each Module Record requiredModule of linkingList, do
  for (const requiredModule of linkingList) {
    // a. Set index to ? InnerModuleLinking(requiredModule, stack, index).
    index = Q(InnerModuleLinking(requiredModule, stack, index));
    // b. If requiredModule is a Cyclic Module Record, then
    if (requiredModule instanceof CyclicModuleRecord) {
      // i. Assert: requiredModule.[[Status]] is one of linking, linked, evaluating-async, or evaluated.
      Assert(requiredModule.Status === 'linking' || requiredModule.Status === 'linked' || requiredModule.Status === 'evaluating-async' || requiredModule.Status === 'evaluated');
      // ii. Assert: requiredModule.[[Status]] is linking if and only if stack contains requiredModule.
      Assert((requiredModule.Status === 'linking') === stack.includes(requiredModule));
      // iii. If requiredModule.[[Status]] is linking, then
      if (requiredModule.Status === 'linking') {
        // 1. Set module.[[DFSAncestorIndex]] to min(module.[[DFSAncestorIndex]], requiredModule.[[DFSAncestorIndex]]).
        module.DFSAncestorIndex = Math.min(module.DFSAncestorIndex, requiredModule.DFSAncestorIndex!);
      }
    }
  }
  // 12. Perform ? module.InitializeEnvironment().
  Q((module as SourceTextModuleRecord).InitializeEnvironment());
  // 13. Assert: module occurs exactly once in stack.
  Assert(stack.indexOf(module) === stack.lastIndexOf(module));
  // 14. Assert: module.[[DFSAncestorIndex]] ≤ moduleIndex.
  Assert(module.DFSAncestorIndex <= moduleIndex);
  // 15. If module.[[DFSAncestorIndex]] = moduleIndex, then
  if (module.DFSAncestorIndex === moduleIndex) {
    // a. Let done be false.
    let done = false;
    // b. Repeat, while done is false,
    while (done === false) {
      // i. Let requiredModule be the last element of stack.
      // ii. Remove the last element of stack.
      const requiredModule = stack.pop();
      // iii. Assert: requiredModule is a Cyclic Module Record.
      Assert(requiredModule instanceof CyclicModuleRecord);
      // iv. Set requiredModule.[[Status]] to linked.
      requiredModule.Status = 'linked';
      // v. If requiredModule and module are the same Module Record, set done to true.
      if (requiredModule === module) {
        done = true;
      }
    }
  }
  // 16. Return index.
  return index;
}

/** https://tc39.es/proposal-defer-import-eval/#sec-ismodulesccevaluated */
export function IsModuleSCCEvaluated(module: CyclicModuleRecord): boolean {
  if (module.CycleRoot !== undefined) {
    if (module.CycleRoot.Status === 'evaluated') {
      return true;
    }
    return false;
  }
  if (module.Status === 'evaluated') {
    return true;
  }
  return false;
}

/** https://tc39.es/proposal-deferred-reexports/#sec-ReadyForSyncExecution */
export function ReadyForSyncExecution(
  module: ModuleRecord,
  importedNames: ImportedNamesValue = 'all',
  seen: Set<CyclicModuleRecord> = new Set(),
): boolean {
  // 1. If module is not a Cyclic Module Record, return true.
  if (!(module instanceof CyclicModuleRecord)) {
    return true;
  }
  // 2. If seen is not present, set seen to a new empty List.
  //    (handled via the default parameter above)
  // 3. If seen contains module, return true.
  if (seen.has(module)) {
    return true;
  }
  // 4. Append module to seen.
  seen.add(module);
  // 5. If IsModuleSCCEvaluated(module), return true.
  if (IsModuleSCCEvaluated(module)) {
    return true;
  }
  // 6. If module.[[Status]] is evaluating or evaluating-async, return false.
  if (module.Status === 'evaluating' || module.Status === 'evaluating-async') {
    return false;
  }
  // 7. Assert: module.[[Status]] is linked.
  Assert(module.Status === 'linked');
  // 8. If module.[[HasTLA]] is true, return false.
  if (module.HasTLA) {
    return false;
  }
  // 9. Let requests be the list-concatenation of module.[[RequestedModules]] and module.GetOptionalIndirectExportsModuleRequests(importedNames).
  const requests = [...module.RequestedModules, ...module.GetOptionalIndirectExportsModuleRequests(importedNames)];
  // 10. For each ModuleRequest Record request of requests, do
  for (const request of requests) {
    // Source-phase requests don't trigger evaluation, so they don't affect readiness.
    if (request.Phase === 'source') {
      continue;
    }
    // a. Let requiredModule be GetImportedModule(module, request).
    const requiredModule = GetImportedModule(module, request);
    // b. If ReadyForSyncExecution(requiredModule, request.[[ImportedNames]], seen) is false, then
    if (!ReadyForSyncExecution(requiredModule, request.ImportedNames, seen)) {
      // i. Return false.
      return false;
    }
  }
  // 11. Return true.
  return true;
}

/** https://tc39.es/ecma262/#sec-EvaluateModuleSync */
export function* EvaluateModuleSync(module: ModuleRecord, importedNames: ImportedNamesValue = []): PlainEvaluator<undefined> {
  // 1. If importedNames is not present, set importedNames to « ».
  // 2. If ReadyForSyncExecution(module, importedNames) is false, throw a TypeError exception.
  if (!ReadyForSyncExecution(module, importedNames)) {
    return Throw.TypeError('Module "$1" is not ready for synchronous execution', (module as CyclicModuleRecord).HostDefined?.specifier ?? '<anonymous module>');
  }
  if (!(module instanceof CyclicModuleRecord && module.Status === 'evaluated')) {
    Q(surroundingAgent.debugger_cannotPreview);
  }
  // 3. Let promise be module.Evaluate(importedNames).
  const promise = yield* module.Evaluate(importedNames);
  // 4. Assert: promise.[[PromiseState]] is either fulfilled or rejected.
  Assert(promise.PromiseState === 'fulfilled' || promise.PromiseState === 'rejected');
  // 5. If promise.[[PromiseState]] is rejected, then
  if (promise.PromiseState === 'rejected') {
    // a. If promise.[[PromiseIsHandled]] is false, perform HostPromiseRejectionTracker(promise, "handle").
    if (!promise.PromiseIsHandled) {
      HostPromiseRejectionTracker(promise, 'handle');
    }
    // b. Set promise.[[PromiseIsHandled]] to true.
    promise.PromiseIsHandled = true;
    // c. Return ThrowCompletion(promise.[[PromiseResult]]).
    Throw(promise.PromiseResult!);
  }
  // 6. Return unused.
  return undefined;
}

/** https://tc39.es/ecma262/#sec-innermoduleevaluation */
export function* InnerModuleEvaluation(module: AbstractModuleRecord, stack: CyclicModuleRecord[], index: number): PlainEvaluator<number> {
  // 1. If module is not a Cyclic Module Record, then
  if (!(module instanceof CyclicModuleRecord)) {
    // a. Perform ? EvaluateModuleSync(module).
    Q(yield* EvaluateModuleSync(module));
    // b. Return index.
    return NormalCompletion(index);
  }
  // 2. If module.[[Status]] is either evaluating-async or evaluated, then
  if (module.Status === 'evaluating-async' || module.Status === 'evaluated') {
    // a. If module.[[EvaluationError]] is empty, return index.
    if (module.EvaluationError === undefined) {
      return NormalCompletion(index);
    } else {
      // b. Otherwise, return ? module.[[EvaluationError]].
      return module.EvaluationError;
    }
  }
  // 3. If module.[[Status]] is evaluating, return index.
  if (module.Status === 'evaluating') {
    return NormalCompletion(index);
  }
  // 4. Assert: module.[[Status]] is linked.
  Assert(module.Status === 'linked');
  // 5. Set module.[[Status]] to evaluating.
  module.Status = 'evaluating';
  // 6. Let moduleIndex be index.
  const moduleIndex = index;
  // 7. Set module.[[DFSAncestorIndex]] to index.
  module.DFSAncestorIndex = index;
  // 8. Set module.[[PendingAsyncDependencies]] to 0.
  module.PendingAsyncDependencies = 0;
  module.AsyncParentModules = [];
  // 9. Set index to index + 1.
  index += 1;
  // 10. Let evaluationList be « ».
  const evaluationList: ModuleRecord[] = [];
  // 11. Perform BuildEvaluationList(evaluationList, module, module.[[RequestedModules]]).
  BuildEvaluationList(evaluationList, module, module.RequestedModules);
  // 12. Append module to stack.
  stack.push(module);
  // 13. For each Module Record requiredModule of evaluationList, do
  for (const required of evaluationList!) {
    let requiredModule: ModuleRecord | CyclicModuleRecord = required as ModuleRecord;
    // a. Set index to ? InnerModuleEvaluation(requiredModule, stack, index).
    index = Q(yield* InnerModuleEvaluation(requiredModule, stack, index));
    // b. If requiredModule is a Cyclic Module Record, then
    if (requiredModule instanceof CyclicModuleRecord) {
      // i. Assert: requiredModule.[[Status]] is one of evaluating, evaluating-async, or evaluated.
      Assert(requiredModule.Status === 'evaluating' || requiredModule.Status === 'evaluating-async' || requiredModule.Status === 'evaluated');
      // ii. Assert: requiredModule.[[Status]] is evaluating if and only if stack contains requiredModule.
      Assert((requiredModule.Status === 'evaluating') === stack.includes(requiredModule));
      // iii. If requiredModule.[[Status]] is evaluating, then
      if (requiredModule.Status === 'evaluating') {
        // 1. Set module.[[DFSAncestorIndex]] to min(module.[[DFSAncestorIndex]], requiredModule.[[DFSAncestorIndex]]).
        module.DFSAncestorIndex = Math.min(module.DFSAncestorIndex, requiredModule.DFSAncestorIndex!);
      } else { // iv. Else,
        // 1. Set requiredModule to requiredModule.[[CycleRoot]].
        requiredModule = requiredModule.CycleRoot!;
        // 2. Assert: requiredModule.[[Status]] is either evaluating-async or evaluated.
        Assert((requiredModule as CyclicModuleRecord).Status === 'evaluating-async' || (requiredModule as CyclicModuleRecord).Status === 'evaluated');
        // 3. If requiredModule.[[EvaluationError]] is not empty, return ? requiredModule.[[EvaluationError]].
        if ((requiredModule as CyclicModuleRecord).EvaluationError !== undefined) {
          return EnsureCompletion((requiredModule as CyclicModuleRecord).EvaluationError);
        }
      }
      // v. If requiredModule.[[AsyncEvaluationOrder]] is an integer, then
      if (typeof (requiredModule as CyclicModuleRecord).AsyncEvaluationOrder === 'number') {
        // 1. Set module.[[PendingAsyncDependencies]] to module.[[PendingAsyncDependencies]] + 1.
        module.PendingAsyncDependencies += 1;
        // 2. Append module to requiredModule.[[AsyncParentModules]].
        (requiredModule as CyclicModuleRecord).AsyncParentModules.push(module);
      }
    }
  }
  // 14. If module.[[HasTLA]] is true or module.[[PendingAsyncDependencies]] > 0, then
  if (module.HasTLA || module.PendingAsyncDependencies > 0) {
    // a. Assert: module.[[AsyncEvaluationOrder]] is unset.
    Assert(module.AsyncEvaluationOrder === 'unset');
    // b. Set module.[[AsyncEvaluationOrder]] to IncrementModuleAsyncEvaluationCount().
    module.AsyncEvaluationOrder = IncrementModuleAsyncEvaluationCount();
    // c. If module.[[PendingAsyncDependencies]] = 0, perform ExecuteAsyncModule(module).
    if (module.PendingAsyncDependencies === 0) {
      X(yield* ExecuteAsyncModule(module));
    }
  } else { // 15. Else,
    // a. Perform ? module.ExecuteModule().
    Q(yield* module.ExecuteModule());
  }
  // 16. Assert: module occurs exactly once in stack.
  Assert(stack.indexOf(module) === stack.lastIndexOf(module));
  // 17. Assert: module.[[DFSAncestorIndex]] ≤ moduleIndex.
  Assert(module.DFSAncestorIndex <= moduleIndex);
  // 18. If module.[[DFSAncestorIndex]] = moduleIndex, then
  if (module.DFSAncestorIndex === moduleIndex) {
    // a. Let done be false.
    let done = false;
    // b. Repeat, while done is false,
    while (done === false) {
      // i. Let requiredModule be the last element of stack.
      // ii. Remove the last element of stack.
      const requiredModule = stack.pop();
      // iii. Assert: requiredModule is a Cyclic Module Record.
      Assert(requiredModule instanceof CyclicModuleRecord);
      // iv. Assert: requiredModule.[[AsyncEvaluationOrder]] is either an integer or unset.
      Assert(typeof requiredModule.AsyncEvaluationOrder === 'number' || requiredModule.AsyncEvaluationOrder === 'unset');
      // v. If requiredModule.[[AsyncEvaluationOrder]] is unset, set requiredModule.[[Status]] to evaluated.
      if (requiredModule.AsyncEvaluationOrder === 'unset') {
        requiredModule.Status = 'evaluated';
      } else {
        // vi. Otherwise, set requiredModule.[[Status]] to evaluating-async.
        requiredModule.Status = 'evaluating-async';
      }
      // vii. If requiredModule and module are the same Module Record, set done to true.
      if (requiredModule === module) {
        done = true;
      }
      // viii. Set requiredModule.[[CycleRoot]] to module.
      requiredModule.CycleRoot = module;
    }
  }
  // 19. Return index.
  return index;
}

/** https://tc39.es/proposal-defer-import-eval/#sec-GatherAsynchronousTransitiveDependencies  */
export function GatherAsynchronousTransitiveDependencies(module: ModuleRecord, seen?: Set<ModuleRecord>): ModuleRecord[] {
  // 1. If seen is not present, set seen to a new empty List.
  seen ??= new Set();
  // 2. Let result be a new empty List.
  const result: ModuleRecord[] = [];
  // 3. If seen contains module, return result.
  if (seen.has(module)) {
    return result;
  }
  // 4. Append module to seen.
  seen.add(module);
  // 5. If module is not a Cyclic Module Record, return result.
  if (!(module instanceof CyclicModuleRecord)) {
    return result;
  }
  // 6. If module.[[Status]] is evaluating or IsModuleSCCEvaluated(module), return result.
  if (module.Status === 'evaluating' || IsModuleSCCEvaluated(module)) {
    return result;
  }
  // 7. If module.[[HasTLA]] is true, then
  if (module.HasTLA) {
    // a. Append module to result.
    result.push(module);
    // b. Return result.
    return result;
  }
  // 8. Return GatherAsynchronousTransitiveDependenciesForRequests(module, module.[[RequestedModules]], seen)
  return GatherAsynchronousTransitiveDependenciesForRequests(module, module.RequestedModules, seen);
}

/** https://tc39.es/proposal-deferred-reexports/#sec-BuildEvaluationList */
export function BuildEvaluationList(
  evaluationList: ModuleRecord[],
  referrer: CyclicModuleRecord,
  moduleRequests: readonly ModuleRequestRecord[],
): void {
  // 1. For each ModuleRequest Record request of moduleRequests, do
  for (const request of moduleRequests) {
    // Source-phase requests are not evaluated; the source is provided directly.
    if (request.Phase === 'source') {
      continue;
    }
    // a. Let requiredModule be GetImportedModule(referrer, request.[[Specifier]]).
    const requiredModule = GetImportedModule(referrer, request);
    // b. If request.[[Phase]] is defer, then
    if (request.Phase === 'defer') {
      // i. Perform ListAppendUnique(evaluationList, GatherAsynchronousTransitiveDependencies(requiredModule)).
      ListAppendUnique(evaluationList, GatherAsynchronousTransitiveDependencies(requiredModule));
    } else if (!evaluationList.includes(requiredModule)) {
      // c. Else if evaluationList does not contain requiredModule, then
      // i. Append requiredModule to evaluationList.
      evaluationList.push(requiredModule);
    }
    // d. If requiredModule is a Cyclic Module Record, then
    if (requiredModule instanceof CyclicModuleRecord) {
      // i. Let importedNames be request.[[ImportedNames]].
      const importedNames = request.ImportedNames;
      // ii. If importedNames = all, then
      if (importedNames === 'all') {
        const allOptionalIndirectRequests = requiredModule.GetOptionalIndirectExportsModuleRequests(importedNames);
        // 2. Let seen be a new empty List.
        // 3. Perform ListAppendUnique(evaluationList, GatherAsynchronousTransitiveDependenciesForRequests(requiredModule, allOptionalIndirectRequests, seen)).
        ListAppendUnique(evaluationList, GatherAsynchronousTransitiveDependenciesForRequests(requiredModule, allOptionalIndirectRequests, new Set()));
      } else { // iii. Else,
        // 1. Let optionalIndirectRequests be requiredModule.GetOptionalIndirectExportsModuleRequests(importedNames).
        const optionalIndirectRequests = requiredModule.GetOptionalIndirectExportsModuleRequests(importedNames);
        // 2. Perform BuildEvaluationList(evaluationList, requiredModule, optionalIndirectRequests).
        BuildEvaluationList(evaluationList, requiredModule, optionalIndirectRequests);
      }
    }
  }
  // 2. Return unused.
}

/** https://tc39.es/proposal-deferred-reexports/#sec-GatherAsynchronousTransitiveDependenciesForRequests */
export function GatherAsynchronousTransitiveDependenciesForRequests(
  referrer: CyclicModuleRecord,
  requests: readonly ModuleRequestRecord[],
  seen: Set<ModuleRecord> = new Set(),
): ModuleRecord[] {
  // 1. Let result be a new empty List.
  const result: ModuleRecord[] = [];
  // 2. For each ModuleRequest Record request of moduleRequests, do
  for (const request of requests) {
    if (request.Phase === 'source') {
      continue;
    }
    // a. Let requiredModule be GetImportedModule(referrer, request).
    const requiredModule = GetImportedModule(referrer, request);
    // b. Perform ListAppendUnique(result, GatherAsynchronousTransitiveDependencies(requiredModule, seen)).
    ListAppendUnique(result, GatherAsynchronousTransitiveDependencies(requiredModule, seen));
    // c. Let optionalIndirectRequests be requiredModule.GetOptionalIndirectExportsModuleRequests(request.[[ImportedNames]]).
    if (requiredModule instanceof CyclicModuleRecord) {
      const optionalIndirectRequests = requiredModule.GetOptionalIndirectExportsModuleRequests(request.ImportedNames);
      // d. Perform ListAppendUnique(result, GatherAsynchronousTransitiveDependenciesForRequests(requiredModule, optionalIndirectRequests, seen)).
      ListAppendUnique(result, GatherAsynchronousTransitiveDependenciesForRequests(requiredModule, optionalIndirectRequests, seen));
    }
  }
  // 3. Return result.
  return result;
}

/** https://tc39.es/ecma262/#sec-execute-async-module */
function* ExecuteAsyncModule(module: CyclicModuleRecord) {
  // 1. Assert: module.[[Status]] is evaluating or evaluating-async.
  Assert(module.Status === 'evaluating' || module.Status === 'evaluating-async');
  // 2. Assert: module.[[HasTLA]] is true.
  Assert(module.HasTLA);
  // 3. Let capability be ! NewPromiseCapability(%Promise%).
  const capability = X(NewPromiseCapability(surroundingAgent.intrinsic('%Promise%')));
  // 4. Let fulfilledClosure be a new Abstract Closure with no parameters that captures module and performs the following steps when called:
  function* fulfilledClosure() {
    // a. Perform ! AsyncModuleExecutionFulfilled(module).
    X(yield* AsyncModuleExecutionFulfilled(module));
    // b. Return undefined.
    return Value.undefined;
  }
  // 5. Let onFulfilled be ! CreateBuiltinFunction(fulfilledClosure, 0, "", « »).
  const onFulfilled = CreateBuiltinFunction(fulfilledClosure, 0, Value(''), ['Module']);
  // 6. Let rejectedClosure be a new Abstract Closure with parameters (error) that captures module and performs the following steps when called:
  const rejectedClosure = ([error = Value.undefined]: Arguments) => {
    // a. Perform ! AsyncModuleExecutionRejected(module, error).
    X(AsyncModuleExecutionRejected(module, error));
    // b. Return undefined.
    return Value.undefined;
  };
  // 7. Let onRejected be ! CreateBuiltinFunction(rejectedClosure, 0, "", « »).
  const onRejected = CreateBuiltinFunction(rejectedClosure, 0, Value(''), ['Module']);
  // 8. Perform ! PerformPromiseThen(capability.[[Promise]], onFulfilled, onRejected).
  X(PerformPromiseThen(capability.Promise, onFulfilled, onRejected));
  // 9. Perform ! module.ExecuteModule(capability).
  X(yield* module.ExecuteModule(capability));
  // 10. Return.
  return Value.undefined;
}

/** https://tc39.es/ecma262/#sec-gather-available-ancestors */
function GatherAvailableAncestors(module: CyclicModuleRecord, execList: CyclicModuleRecord[]) {
  // 1. For each Cyclic Module Record m of module.[[AsyncParentModules]], do
  for (const m of module.AsyncParentModules) {
    // a. If execList does not contain m and m.[[CycleRoot]].[[EvaluationError]] is empty, then
    if (!execList.includes(m) && m.CycleRoot!.EvaluationError === undefined) {
      // i. Assert: m.[[Status]] is evaluating-async.
      Assert(m.Status === 'evaluating-async');
      // ii. Assert: m.[[EvaluationError]] is empty.
      Assert(m.EvaluationError === undefined);
      // iii. Assert: m.[[AsyncEvaluationOrder]] is an integer.
      Assert(typeof m.AsyncEvaluationOrder === 'number');
      // iv. Assert: m.[[PendingAsyncDependencies]] > 0.
      Assert(m.PendingAsyncDependencies! > 0);
      // v. Set m.[[PendingAsyncDependencies]] to m.[[PendingAsyncDependencies]] - 1.
      m.PendingAsyncDependencies! -= 1;
      // vi. If m.[[PendingAsyncDependencies]] = 0, then
      if (m.PendingAsyncDependencies === 0) {
        // 1. Append m to execList.
        execList.push(m);
        // 2. If m.[[HasTLA]] is false, perform GatherAvailableAncestors(m, execList).
        if (!m.HasTLA) {
          GatherAvailableAncestors(m, execList);
        }
      }
    }
  }
  // 2. Return unused.
}

/** https://tc39.es/ecma262/#sec-async-module-execution-fulfilled */
function* AsyncModuleExecutionFulfilled(module: CyclicModuleRecord): PlainEvaluator {
  // 1. If module.[[Status]] is evaluated, then
  if (module.Status === 'evaluated') {
    // a. Assert: module.[[EvaluationError]] is not empty.
    Assert(module.EvaluationError !== undefined);
    // b. Return unused.
    return;
  }
  // 2. Assert: module.[[Status]] is evaluating-async.
  Assert(module.Status === 'evaluating-async');
  // 3. Assert: module.[[AsyncEvaluationOrder]] is an integer.
  Assert(typeof module.AsyncEvaluationOrder === 'number');
  // 4. Assert: module.[[EvaluationError]] is empty.
  Assert(module.EvaluationError === undefined);
  // 5. Set module.[[AsyncEvaluationOrder]] to done.
  module.AsyncEvaluationOrder = 'done';
  // 6. Set module.[[Status]] to evaluated.
  module.Status = 'evaluated';
  // 7. If module.[[TopLevelCapability]] is not empty, then
  if (module.TopLevelCapability !== undefined) {
    // a. Assert: module.[[CycleRoot]] is module.
    Assert(module.CycleRoot === module);
    // b. Perform ! Call(module.[[TopLevelCapability]].[[Resolve]], undefined, « undefined »).
    X(Call(module.TopLevelCapability.Resolve, Value.undefined, [Value.undefined]));
  }
  // 8. Let execList be a new empty List.
  const execList: CyclicModuleRecord[] = [];
  // 9. Perform GatherAvailableAncestors(module, execList).
  GatherAvailableAncestors(module, execList);
  // 10. Let sortedExecList be a List whose elements are the elements of execList,
  //     in the order in which they had their [[AsyncEvaluationOrder]] field set.
  const sortedExecList = execList.toSorted((m1, m2) => (m1.AsyncEvaluationOrder as number) - (m2.AsyncEvaluationOrder as number));
  // 11. Assert: All elements of sortedExecList have their [[AsyncEvaluationOrder]] field set
  //     to an integer, [[PendingAsyncDependencies]] field set to 0, and [[EvaluationError]]
  //     field set to empty.
  Assert(execList.every((m) => typeof m.AsyncEvaluationOrder === 'number' && m.PendingAsyncDependencies === 0 && m.EvaluationError === undefined));
  // 12. For each Cyclic Module Record m of sortedExecList, do
  for (const m of sortedExecList) {
    // a. If m.[[Status]] is evaluated, then
    if (m.Status === 'evaluated') {
      // i. Assert: m.[[EvaluationError]] is not empty.
      Assert(m.EvaluationError !== undefined);
    } else if (m.HasTLA) { // b. Else if m.[[HasTLA]] is true, then
      // i. Perform ExecuteAsyncModule(m).
      X(yield* ExecuteAsyncModule(m));
    } else { // c. Else,
      // i. Let result be m.ExecuteModule().
      const result = yield* m.ExecuteModule();
      // ii. If result is an abrupt completion, then
      if (result instanceof AbruptCompletion) {
        // 1. Perform AsyncModuleExecutionRejected(m, result.[[Value]]).
        X(AsyncModuleExecutionRejected(m, result.Value));
      } else { // iii. Else,
        // 1. Set m.[[AsyncEvaluationOrder]] to done.
        m.AsyncEvaluationOrder = 'done';
        // 2. Set m.[[Status]] to evaluated.
        m.Status = 'evaluated';
        // 3. If m.[[TopLevelCapability]] is not empty, then
        if (m.TopLevelCapability !== undefined) {
          // a. Assert: m.[[CycleRoot]] is m.
          Assert(m.CycleRoot === m);
          // b. Perform ! Call(m.[[TopLevelCapability]].[[Resolve]], undefined, « undefined »).
          X(Call(m.TopLevelCapability.Resolve, Value.undefined, [Value.undefined]));
        }
      }
    }
  }
  // 13. Return unused.
}

/** https://tc39.es/ecma262/#sec-AsyncModuleExecutionRejected */
function AsyncModuleExecutionRejected(module: CyclicModuleRecord, error: Value) {
  // 1. If module.[[Status]] is evaluated, then
  if (module.Status === 'evaluated') {
    // a. Assert: module.[[EvaluationError]] is not empty.
    Assert(module.EvaluationError !== undefined);
    // b. Return unused.
    return;
  }
  // 2. Assert: module.[[Status]] is evaluating-async.
  Assert(module.Status === 'evaluating-async');
  // 3. Assert: module.[[AsyncEvaluationOrder]] is an integer.
  Assert(typeof module.AsyncEvaluationOrder === 'number');
  // 4. Assert: module.[[EvaluationError]] is empty.
  Assert(module.EvaluationError === undefined);
  // 5. Set module.[[EvaluationError]] to ThrowCompletion(error).
  module.EvaluationError = ThrowCompletion(error);
  // 6. Set module.[[Status]] to evaluated.
  module.Status = 'evaluated';
  // 7. Set module.[[AsyncEvaluationOrder]] to done.
  module.AsyncEvaluationOrder = 'done';
  // 8. If module.[[TopLevelCapability]] is not empty, then
  if (module.TopLevelCapability !== undefined) {
    // a. Assert: module.[[CycleRoot]] is module.
    Assert(module.CycleRoot === module);
    // b. Perform ! Call(module.[[TopLevelCapability]].[[Reject]], undefined, « error »).
    X(Call(module.TopLevelCapability.Reject, Value.undefined, [error]));
  }
  // 9. For each Cyclic Module Record m of module.[[AsyncParentModules]], do
  for (const m of module.AsyncParentModules) {
    // a. Perform AsyncModuleExecutionRejected(m, error).
    AsyncModuleExecutionRejected(m, error);
  }
  // 10. Return unused.
}

function getRecordWithSpecifier(loadedModules: CyclicModuleRecord['LoadedModules'], request: ModuleRequestRecord) {
  const records = loadedModules.filter((r) => ModuleRequestsKeyEqual(r, request));
  Assert(records.length <= 1);
  return records.length === 1 ? records[0] : undefined;
}

/** https://tc39.es/ecma262/#sec-GetImportedModule */
export function GetImportedModule(referrer: CyclicModuleRecord, request: ModuleRequestRecord) {
  const record = getRecordWithSpecifier(referrer.LoadedModules, request);
  Assert(record !== undefined);
  return record.Module;
}

/** https://tc39.es/ecma262/#sec-FinishLoadingImportedModule */
export function FinishLoadingImportedModule(referrer: ScriptRecord | CyclicModuleRecord | Realm, moduleRequest: ModuleRequestRecord, payload: HostLoadImportedModulePayloadOpaque, result: PlainCompletion<AbstractModuleRecord>) {
  const payload_ = payload.data;
  result = EnsureCompletion(result);
  // 1. If result is a normal completion, then
  if (result.Type === 'normal') {
    // a. If referrer.[[LoadedModules]] contains a LoadedModuleRequest Record record such that ModuleRequestsKeyEqual(record, moduleRequest) is true, then
    const record = getRecordWithSpecifier(referrer.LoadedModules, moduleRequest);
    if (record !== undefined) {
      // i. Assert: That Record's [[Module]] is result.[[Value]].
      Assert(record.Module === result.Value);
    } else { // b. Else,
      //  i. Append the LoadedModuleRequest Record { [[Specifier]]: moduleRequest.[[Specifier]], [[Attributes]]: moduleRequest.[[Attributes]], [[Module]]: result.[[Value]] } to referrer.[[LoadedModules]].
      referrer.LoadedModules.push({ Specifier: moduleRequest.Specifier, Attributes: moduleRequest.Attributes, Module: result.Value });
    }
  }
  // 2. If payload is a GraphLoadingState Record, then
  if (payload_ instanceof GraphLoadingState) {
    // a. Perform ContinueModuleLoading(payload, result, moduleRequest.[[ImportedNames]], moduleRequest.[[Phase]]).
    ContinueModuleLoading(payload_, result, moduleRequest.ImportedNames, moduleRequest.Phase);
  } else { // 3. Else,
    // a. Perform ContinueDynamicImport(payload, moduleRequest.[[Phase]], result).
    ContinueDynamicImport(payload_, moduleRequest.Phase, result);
  }
  // 4. Return unused.
}

/** https://tc39.es/ecma262/#sec-AllImportAttributesSupported */
export function AllImportAttributesSupported(attributes: readonly ImportAttributeRecord[]) {
  // Note: This function is meant to return a boolean. Instead, we return:
  // - instead of *false*, the key of the unsupported attribute
  // - instead of *true*, undefined

  const supported: readonly string[] = HostGetSupportedImportAttributes();
  for (const attribute of attributes) {
    if (!supported.includes(attribute.Key)) {
      return attribute.Key;
    }
  }
  return undefined;
}

/** https://tc39.es/ecma262/#sec-getmodulenamespace */
export function GetModuleNamespace(
  module: AbstractModuleRecord,
  phase: 'defer' | 'evaluation',
  importedNames: 'all' | readonly string[] = 'all',
): ObjectValue {
  if (module instanceof CyclicModuleRecord) {
    Assert(module.Status !== 'new' && module.Status !== 'unlinked');
  }
  let namespace;
  if (importedNames === 'all') {
    if (phase === 'defer') {
      namespace = module.DeferredNamespace;
    } else {
      namespace = module.Namespace;
    }
  }
  if (namespace === undefined) {
    const exportedNames = module.GetExportedNames();
    const unambiguousNames = [];
    for (const name of exportedNames) {
      if (importedNames === 'all' || importedNames.includes(name)) {
        if (phase !== 'defer' || name !== 'then') {
          const resolution = module.ResolveExport(name);
          if (resolution instanceof ResolvedBindingRecord) {
            unambiguousNames.push(name);
          }
        }
      }
    }
    namespace = ModuleNamespaceCreate(module, unambiguousNames, phase);
    if (importedNames === 'all') {
      if (phase === 'defer') {
        (module as Mutable<AbstractModuleRecord>).DeferredNamespace = namespace;
      } else {
        (module as Mutable<AbstractModuleRecord>).Namespace = namespace;
      }
    }
  }
  return namespace;
}

/** https://tc39.es/ecma262/#sec-create-default-export-synthetic-module */
export function CreateDefaultExportSyntheticModule(defaultExport: Value) {
  // 1. Let closure be the a Abstract Closure with parameters (module) that captures defaultExport and performs the following steps when called:
  const closure = function* closure(module: SyntheticModuleRecord): PlainEvaluator {
    // a. Return module.SetSyntheticExport("default", defaultExport).
    Q(yield* module.SetSyntheticExport('default', defaultExport));
    return NormalCompletion(undefined);
  };
  return new SyntheticModuleRecord({
    Realm: surroundingAgent.currentRealmRecord,
    Environment: undefined,
    Namespace: undefined,
    ModuleSource: undefined,
    HostDefined: undefined,
    ExportNames: ['default'],
    EvaluationSteps: closure,
  });
}

/** https://tc39.es/proposal-import-text/#sec-create-text-module */
export function CreateTextModule(source: string) {
  return CreateDefaultExportSyntheticModule(Value(source));
}

export function CreateBytesModule(arrayBuffer: ArrayBufferObject) {
  // TODO: immutable array buffer
  // 1. Assert: IsImmutableBuffer(arrayBuffer) is true.
  const uint8Array = X(Construct(surroundingAgent.intrinsic('%Uint8Array%'), [arrayBuffer]));
  return CreateDefaultExportSyntheticModule(uint8Array);
}

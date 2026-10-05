import { Value } from '../value.mts';
import {
  EnsureCompletion,
  NormalCompletion,
  ThrowCompletion,
  Q, X,
  type PlainCompletion,
} from '../completion.mts';
import { GlobalDeclarationInstantiation } from '../runtime-semantics/all.mts';
import {
  Evaluate, type PlainEvaluator, type ValueEvaluator,
} from '../evaluator.mts';
import { kInternal } from '../utils/internal.mts';
import {
  AbstractModuleRecord, CyclicModuleRecord, ObjectValue, type ValueCompletion, type ModuleRecordHostDefined, type ParseScriptHostDefined, type ScriptRecord,
  ManagedRealm,
  SourceTextModuleRecord,
  type ModuleRequestRecord,
  Realm,
  isEvaluator,
  type EpochNanoseconds,
  type ArrayBufferObject,
  type Intrinsics,
  type JobQueue,
  type EventLoop,
  type EventLoopRunType,
  Agent,
} from '../index.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import type { PromiseObject } from '../intrinsics/Promise.mts';
import type { FinalizationRegistryObject } from '../intrinsics/FinalizationRegistry.mts';
import type { ShadowRealmObject } from '../intrinsics/ShadowRealm.mts';
import { ExecutionContext } from '../execution-context/ExecutionContext.mts';
import {
  FinishLoadingImportedModule,
  type FunctionObject,
  GraphLoadingState,
  PromiseCapabilityRecord,
  surroundingAgent,
  Throw,
} from '#self';

export interface Engine262Feature {
  name: string;
  flag: string;
  url: string;
  enableInPlayground?: boolean;
}

// unflag a feature when it reaches stage 3.
export const FEATURES = ([
  // stage 2.7
  {
    name: 'Decorators',
    flag: 'decorators',
    url: 'https://github.com/tc39/proposal-decorators',
    enableInPlayground: true,
  },
  {
    name: 'Skip bugfix for field initializers in decorator',
    flag: 'decorators.no-bugfix.1',
    url: '',
  },
  // stage 2
  {
    name: 'FinalizationRegistry#cleanupSome',
    flag: 'cleanup-some',
    url: 'https://github.com/tc39/proposal-cleanup-some',
    enableInPlayground: true,
  },
  {
    name: 'RegExp Buffer Boundaries',
    flag: 'regexp-buffer-boundaries',
    url: 'https://github.com/tc39/proposal-regexp-buffer-boundaries',
    enableInPlayground: true,
  },
  {
    name: 'Deferred Re-exports',
    flag: 'export-defer',
    url: 'https://github.com/tc39/proposal-deferred-reexports',
    enableInPlayground: true,
  },
]) as const satisfies Engine262Feature[];
Object.freeze(FEATURES);
FEATURES.forEach(Object.freeze);
export type Feature = typeof FEATURES[number]['flag'];

/** https://tc39.es/ecma262/#sec-host-promise-rejection-tracker */
export type HostPromiseRejectionTracker = (promise: PromiseObject, operation: 'reject' | 'handle') => void;
export interface HostHooks {
  /** https://tc39.es/ecma262/#sec-host-cleanup-finalization-registry */
  HostEnqueueFinalizationRegistryCleanupJob?(finalizationRegistry: FinalizationRegistryObject): void;
  /** https://tc39.es/ecma262/#sec-hostensurecancompilestrings */
  HostEnsureCanCompileStrings?(calleeRealm: Realm, parameterStrings: readonly string[], bodyString: string, direct: boolean): PlainEvaluator | PlainCompletion<void>;
  /** https://tc39.es/ecma262/#sec-hosthassourcetextavailable */
  HostHasSourceTextAvailable?(func: FunctionObject): boolean;
  /** https://tc39.es/proposal-shadowrealm/#sec-hostinitializeshadowrealm */
  HostInitializeShadowRealm?(realmRec: Realm, innerContext: ExecutionContext, O: ShadowRealmObject): PlainEvaluator | PlainCompletion<void>;
  /** https://tc39.es/ecma262/#sec-hostgetmodulesourcemodulerecord */
  HostGetModuleSourceModuleRecord?(specifier: ObjectValue): AbstractModuleRecord | 'not-a-source';
  /** https://tc39.es/ecma262/#sec-#sec-HostLoadImportedModule */
  HostLoadImportedModule?(referrer: CyclicModuleRecord | ScriptRecord | Realm, moduleRequest: ModuleRequestRecord, hostDefined: ModuleRecordHostDefined | undefined, payload: HostLoadImportedModulePayloadOpaque): void;
  /** https://tc39.es/ecma262/#sec-host-promise-rejection-tracker */
  HostPromiseRejectionTrackers?: Set<HostPromiseRejectionTracker>;
  /** https://tc39.es/ecma262/#sec-hostresizearraybuffer */
  HostResizeArrayBuffer?(buffer: ArrayBufferObject, newByteLength: number): 'handled' | 'unhandled';
  /** https://tc39.es/proposal-temporal/#sec-hostsystemutcepochnanoseconds */
  HostSystemUTCEpochNanoseconds?(global: ObjectValue): EpochNanoseconds;
}

export interface DebuggerPauseReason {
  readonly reason: 'debugCommand' | 'other';
  readonly hitBreakpoints?: readonly string[];
}

export interface AgentHostDefined {
  errorStackAttachNativeStack?: boolean;
  features?: readonly string[];
  hostHooks?: HostHooks;
  jobQueue?: JobQueue;
  eventLoop?: (agent: Agent) => EventLoop;
  eventLoopRunType?: EventLoopRunType;
  startEventLoop?: boolean;
  onDebugger?(reason?: DebuggerPauseReason): void;
  onNodeEvaluation?(node: ParseNode, realm: Realm): void;
  onRealmCreated?(realm: ManagedRealm): void;
  onScriptParsed?(script: ScriptRecord | SourceTextModuleRecord | DynamicParsedCodeRecord, scriptId: string): void;
  resizableArrayBufferMaxByteLength?: number;
  supportedImportAttributes?: readonly string[];
  /** Promise rejection is standardized, but uncaught exception is not. */
  uncaughtExceptionTrackers?: Set<(error: Value) => void>;
}

export interface ResumeEvaluateOptions {
  noBreakpoint?: boolean;
  pauseAt?: 'step-over' | 'step-in' | 'step-out';
  debuggerStatementCompletion?: ValueCompletion;
}

// NON-SPEC, only used in the inspector
export class DynamicParsedCodeRecord {
  constructor(public Realm: Realm, sourceText: string | ParseNode.Script | ParseNode.Expression) {
    this.ECMAScriptCode = typeof sourceText === 'string' ? { sourceText } : sourceText;
  }

  public HostDefined = {
    scriptId: undefined as string | undefined,
    specifier: undefined,
    isInspectorEval: false,
  };

  public ECMAScriptCode: { sourceText: string } | ParseNode.Script | ParseNode.Expression;
}

/** https://tc39.es/ecma262/#sec-well-known-intrinsic-objects */
export function intrinsics(): Intrinsics {
  return surroundingAgent.executionContextStack.at(-1)!.Realm.Intrinsics;
}

export interface ExecutionContextHostDefined {
  readonly [kInternal]?: ParseScriptHostDefined[typeof kInternal];
  scriptId?: string;
}

/** https://tc39.es/ecma262/#sec-runtime-semantics-scriptevaluation */
export function* ScriptEvaluation(scriptRecord: ScriptRecord): ValueEvaluator {
  const globalEnv = scriptRecord.Realm.GlobalEnv;
  const scriptContext = new ExecutionContext();
  scriptContext.Function = Value.null;
  scriptContext.Realm = scriptRecord.Realm;
  scriptContext.ScriptOrModule = scriptRecord;
  scriptContext.VariableEnvironment = globalEnv;
  scriptContext.LexicalEnvironment = globalEnv;
  scriptContext.PrivateEnvironment = null;
  if (scriptRecord.HostDefined[kInternal]) {
    scriptContext.HostDefined = {
      [kInternal]: scriptRecord.HostDefined[kInternal],
    };
  }
  // Suspend runningExecutionContext
  surroundingAgent.executionContextStack.push(scriptContext);
  const scriptBody = scriptRecord.ECMAScriptCode;
  let result: NormalCompletion<void | Value> | ThrowCompletion = EnsureCompletion(yield* GlobalDeclarationInstantiation(scriptBody, globalEnv));

  if (result.Type === 'normal') {
    result = EnsureCompletion(yield* (Evaluate(scriptBody))) as NormalCompletion<void | Value>;

    if (result.Type === 'normal' && !result.Value) {
      result = NormalCompletion(Value.undefined);
    }
  }

  // Suspend scriptCtx
  surroundingAgent.executionContextStack.pop(scriptContext);
  // Resume(surroundingAgent.runningExecutionContext);

  return result as ValueCompletion;
}

export function* HostEnsureCanCompileStrings(calleeRealm: Realm, parameterStrings: readonly string[], bodyString: string, direct: boolean): PlainEvaluator {
  const completion = surroundingAgent.hostDefinedOptions.hostHooks?.HostEnsureCanCompileStrings?.(calleeRealm, parameterStrings, bodyString, direct);
  if (!completion) {
    return NormalCompletion(undefined);
  }
  if (isEvaluator(completion)) {
    Q(yield* completion);
  } else {
    Q(completion);
  }
}

export function HostPromiseRejectionTracker(promise: PromiseObject, operation: 'reject' | 'handle') {
  if (surroundingAgent.debugger_isPreviewing) return;
  surroundingAgent.hostDefinedOptions.hostHooks?.HostPromiseRejectionTrackers?.forEach((tracker) => tracker(promise, operation));
}

const HasSourceTextAvailable = new WeakMap<FunctionObject, boolean>();
export function HostHasSourceTextAvailable(func: FunctionObject): boolean {
  // It must be deterministic with respect to its parameters. Each time it is called with a specific func as its argument, it must return the same result.
  if (HasSourceTextAvailable.has(func)) {
    return HasSourceTextAvailable.get(func)!;
  }
  if (surroundingAgent.hostDefinedOptions.hostHooks?.HostHasSourceTextAvailable) {
    return surroundingAgent.hostDefinedOptions.hostHooks.HostHasSourceTextAvailable(func);
  }
  return true;
}

export function HostGetSupportedImportAttributes(): readonly string[] {
  if (surroundingAgent.hostDefinedOptions.supportedImportAttributes) {
    return surroundingAgent.hostDefinedOptions.supportedImportAttributes;
  }
  return [];
}

/** https://tc39.es/ecma262/#sec-hostgetmodulesourcemodulerecord */
export function HostGetModuleSourceModuleRecord(specifier: ObjectValue): AbstractModuleRecord | 'not-a-source' {
  const HostHook = surroundingAgent.hostDefinedOptions.hostHooks?.HostGetModuleSourceModuleRecord;
  if (HostHook) {
    return HostHook(specifier);
  }
  return 'not-a-source';
}

// #sec-HostLoadImportedModule
export function HostLoadImportedModule(referrer: CyclicModuleRecord | ScriptRecord | Realm, moduleRequest: ModuleRequestRecord, hostDefined: ModuleRecordHostDefined | undefined, payload: HostLoadImportedModulePayloadOpaque) {
  const HostHook = surroundingAgent.hostDefinedOptions.hostHooks?.HostLoadImportedModule;
  if (HostHook) {
    HostHook(referrer, moduleRequest, hostDefined, payload);
  } else {
    FinishLoadingImportedModule(referrer, moduleRequest, payload, Throw.Error('Host does not set a module loader'));
  }
}

// The operation must treat payload as an opaque value to be passed through to FinishLoadingImportedModule.
export type HostLoadImportedModulePayloadOpaque = {
  /** @internal */
  data: GraphLoadingState | PromiseCapabilityRecord;
  HostLoadImportedModulePayloadOpaque?: never
};

/** https://tc39.es/ecma262/#sec-hostgetimportmetaproperties */
export function HostGetImportMetaProperties(moduleRecord: AbstractModuleRecord) {
  const realm = surroundingAgent.currentRealmRecord;
  if (realm.HostDefined.getImportMetaProperties) {
    return X(realm.HostDefined.getImportMetaProperties(moduleRecord.HostDefined?.public));
  }
  return [];
}

/** https://tc39.es/ecma262/#sec-hostfinalizeimportmeta */
export function HostFinalizeImportMeta(importMeta: ObjectValue, moduleRecord: AbstractModuleRecord) {
  const realm = surroundingAgent.currentRealmRecord;
  if (realm.HostDefined.finalizeImportMeta) {
    return X(realm.HostDefined.finalizeImportMeta(importMeta, moduleRecord.HostDefined?.public));
  }
}

export type GCMarker = (value: unknown) => void;
export interface Markable {
  mark(marker: GCMarker): void;
}

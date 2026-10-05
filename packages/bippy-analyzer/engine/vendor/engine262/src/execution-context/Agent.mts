import type { Protocol } from 'devtools-protocol';
import { getOrInsertComputed } from '../utils/map.mts';
import { shouldStepOnNode } from '../host-defined/debugger-util.mts';
import {
} from '../host-defined/engine.mts';
import { isArray } from '../utils/language.mts';
import { callCallback } from '../utils/callback.mts';
import {
  ObjectValue, SymbolValue, type Intrinsics, Value, ThrowCompletion, type ValueEvaluator, NormalCompletion, EnsureCompletion, skipDebugger, type ValueCompletion, type ScriptRecord, SourceTextModuleRecord, Realm, X, Construct,
  ExecutionContextStack,
  type AgentHostDefined,
  DynamicParsedCodeRecord,
  type Feature,
  type GCMarker,
  type ResumeEvaluateOptions,
  type ParseNode,
  type BreakpointLocation,
  getBreakpointCandidateNodes,
  parseNodeToBreakpointLocation,
  type FunctionObject,
  performDevtoolsEval,
  ManagedRealm,
  ToBoolean,
  type FinalizationRegistryObject,
  BasicJobQueue,
  type JobQueue,
  WebLikeEventLoop,
  type EventLoop,
  type GlobalSymbolRegistryRecord,
  type AvailableNamedTimeZoneIdentifierReturnRecord,
} from '#self';

let agentSignifier = 0;

/** https://tc39.es/ecma262/#surrounding-agent */
export let surroundingAgent: Agent;
export function setSurroundingAgent(a: Agent) {
  surroundingAgent = a;
}

/** https://tc39.es/ecma262/#table-agent-record */
export interface AgentRecord {
  readonly LittleEndian: boolean;
  readonly CanBlock: boolean;
  readonly Signifier: number;
  readonly IsLockFree1: boolean;
  readonly IsLockFree2: boolean;
  readonly IsLockFree8: boolean;
  // unsupported
  readonly CandidateExecution?: never;
  KeptAlive: Set<ObjectValue | SymbolValue>;
  ModuleAsyncEvaluationCount: number;
  readonly GlobalSymbolRegistry: GlobalSymbolRegistryRecord[];
  readonly GetAvailableNamedTimeZoneIdentifierReturns: AvailableNamedTimeZoneIdentifierReturnRecord[];
}

/** https://tc39.es/ecma262/#sec-agents */
export class Agent {
  // An agent comprises a set of ECMAScript execution contexts, an execution context stack, a running execution context, an Agent Record, and an executing thread. Except for the executing thread, the constituents of an agent belong exclusively to that agent.
  readonly executionContextStack = new ExecutionContextStack();

  /** https://tc39.es/ecma262/#running-execution-context */
  get runningExecutionContext() {
    return this.executionContextStack.at(-1)!;
  }

  get hasRunningExecutionContext() {
    return this.executionContextStack.length > 0;
  }

  readonly AgentRecord: AgentRecord;

  // NON-SPEC
  readonly jobQueue: JobQueue;

  readonly eventLoop: EventLoop;

  readonly finalizationRegistryScheduledForCleanup = new Set<FinalizationRegistryObject>();

  hostDefinedOptions: AgentHostDefined;

  constructor(options: AgentHostDefined = {}) {
    const Signifier = agentSignifier;
    agentSignifier += 1;
    this.AgentRecord = {
      LittleEndian: true,
      CanBlock: true,
      Signifier,
      IsLockFree1: true,
      IsLockFree2: true,
      IsLockFree8: true,
      CandidateExecution: undefined!,
      KeptAlive: new Set(),
      ModuleAsyncEvaluationCount: 0,
      GlobalSymbolRegistry: [],
      GetAvailableNamedTimeZoneIdentifierReturns: [],
    };

    this.hostDefinedOptions = options;
    this.jobQueue = options.jobQueue || new BasicJobQueue();
    this.eventLoop = options.eventLoop?.(this) || new WebLikeEventLoop(this);
    if (options.startEventLoop !== false) {
      this.eventLoop.run(options.eventLoopRunType || 'automatic');
    }
  }

  /** https://tc39.es/ecma262/#current-realm */
  get currentRealmRecord() {
    return this.executionContextStack.at(-1)!.Realm;
  }

  /** https://tc39.es/ecma262/#active-function-object */
  get activeFunctionObject() {
    return this.executionContextStack.at(-1)!.Function;
  }

  intrinsic<const T extends keyof Intrinsics>(name: T): Intrinsics[T] {
    return this.executionContextStack.at(-1)!.Realm.Intrinsics[name];
  }

  // NON-SPEC: Check if a feature is enabled in this agent.
  feature(name: Feature): boolean {
    return !!this.hostDefinedOptions.features?.includes(name);
  }

  // NON-SPEC
  mark(m: GCMarker) {
    this.AgentRecord.KeptAlive.forEach(m);
    this.executionContextStack.forEach(m);
    this.jobQueue.mark(m);
    this.eventLoop.mark(m);
  }

  // NON-SPEC
  // #region Step-by-step evaluation
  #pausedEvaluator?: {
    evaluator: ValueEvaluator;
    onFinish: (completion: NormalCompletion<Value> | ThrowCompletion) => void;
  };

  /**
   * An event that is triggered when evaluators are finished and the agent is idle.
   * @internal
   */
  readonly onNoEvaluator = new Set<() => void>();

  // NON-SPEC
  /** Evaluate an evaluator. It will skip the debugger if the agent is already debugger-paused. */
  evaluate<T extends Value>(evaluator: ValueEvaluator<T>, onFinished: (completion: NormalCompletion<T> | ThrowCompletion) => void, evaluationOptions?: ResumeEvaluateOptions | false): void {
    if (this.#pausedEvaluator) {
      // cannot run a pausable evaluator when another evaluator is paused.
      onFinished(EnsureCompletion(skipDebugger(evaluator)));
      return;
    }
    this.#pausedEvaluator = {
      evaluator,
      onFinish: onFinished as (completion: NormalCompletion<Value> | ThrowCompletion) => void,
    };
    if (evaluationOptions !== false) {
      this.resumeEvaluate(evaluationOptions);
    }
  }

  isPaused() {
    return !!this.#pausedEvaluator;
  }

  resumeEvaluate(options?: ResumeEvaluateOptions): IteratorResult<void, ValueCompletion> {
    const { noBreakpoint } = options || {};
    if (!this.#pausedEvaluator) {
      throw new Error('No paused evaluator');
    }
    const { evaluator, onFinish } = this.#pausedEvaluator;
    let nextLocation;
    if (options?.pauseAt === 'step-over') {
      nextLocation = this.runningExecutionContext.callSite.nextNode;
    } else if (options?.pauseAt === 'step-out') {
      nextLocation = this.executionContextStack[this.executionContextStack.length - 2].callSite.lastCallNode;
    }
    let debuggerStatementCompletion = options?.debuggerStatementCompletion;
    while (true) {
      const state = evaluator.next({ resume: 'debugger', value: debuggerStatementCompletion });
      debuggerStatementCompletion = undefined;

      if (!noBreakpoint && this.breakpointsEnabled && this.hostDefinedOptions.onDebugger && !this.debugger_isPreviewing && !state.done) {
        if (state.value.suspend === 'debugger') {
          this.hostDefinedOptions.onDebugger();
          return { done: false, value: undefined };
        } else if (state.value.suspend === 'potential-debugger') {
          if (options?.pauseAt === 'step-in' && shouldStepOnNode()) {
            this.hostDefinedOptions.onDebugger();
            return { done: false, value: undefined };
          }
          const callSite = surroundingAgent.runningExecutionContext.callSite;
          if (nextLocation && (callSite.lastNode === nextLocation || callSite.lastCallNode === nextLocation)) {
            this.hostDefinedOptions.onDebugger();
            return { done: false, value: undefined };
          }
        }
      }

      if (state.done) {
        this.#pausedEvaluator = undefined;
        onFinish(EnsureCompletion(state.value));
        callCallback(this.onNoEvaluator);
        return state;
      }
    }
  }

  // #endregion
  // NON-SPEC
  // #region parsed scripts/modules
  #script_id = 0;

  parsedSources = new Map<string, ScriptRecord | SourceTextModuleRecord | DynamicParsedCodeRecord>();

  addParsedSource(source: ScriptRecord | SourceTextModuleRecord) {
    const id = `${this.#script_id}`;
    if (source.HostDefined) {
      source.HostDefined.scriptId = id;
    }
    this.parsedSources.set(id, source);
    this.#addBreakpointByUrl(this.#breakpoints.values(), [[id, source]]);
    this.hostDefinedOptions.onScriptParsed?.(source, id);
    this.#script_id += 1;
  }

  #dynamicParsedSourceIds = new Map<string, string>();

  addDynamicParsedSource(realm: Realm, sourceText: string, ast?: unknown[] | ParseNode.Expression | ParseNode.Script): string | undefined {
    if (this.debugger_isPreviewing) {
      return undefined;
    }
    if (this.#dynamicParsedSourceIds.has(sourceText)) {
      return this.#dynamicParsedSourceIds.get(sourceText);
    }
    const id = `${this.#script_id}`;
    const source = new DynamicParsedCodeRecord(realm, !ast || isArray(ast) ? sourceText : ast);
    source.HostDefined.scriptId = id;
    this.parsedSources.set(id, source);
    this.#addBreakpointByUrl(this.#breakpoints.values(), [[id, source]]);
    this.hostDefinedOptions.onScriptParsed?.(source, id);
    this.#script_id += 1;
    this.#dynamicParsedSourceIds.set(sourceText, id);
    return id;
  }

  // #endregion
  // NON-SPEC
  // #region breakpoint
  breakpointsEnabled = true;

  // TODO(debugger): not implemented
  pauseOnExceptions: undefined | 'caught' | 'uncaught' | 'all';

  #breakpointId = 0;

  #breakpoints = new Map<string, Breakpoint>();

  #breakpointsByNode = new WeakMap<ParseNode, Set<Breakpoint>>();

  breakpointsByFunction = new WeakSet<FunctionObject>();

  testBreakpoint(node: ParseNode) {
    const breakpoints = this.#breakpointsByNode.get(node);
    if (!breakpoints) return false;
    for (const breakpoint of breakpoints) {
      if (breakpoint.condition) {
        const result = EnsureCompletion(skipDebugger(performDevtoolsEval(breakpoint.condition, surroundingAgent.currentRealmRecord as ManagedRealm, false, true)));
        if (result instanceof NormalCompletion) {
          return ToBoolean(result.Value);
        } else {
          // ignore them now.
          // should report to inspector, but it requires us to adjust code to move part of breakpoint code to the inspector class.
          // or maybe we can share code with uncaughtException?
        }
      } else {
        return true;
      }
    }
    return false;
  }

  #resolveBreakpointNode(location: BreakpointLocation): ParseNode | undefined {
    // eslint-disable-next-line no-unreachable-loop
    for (const candidate of getBreakpointCandidateNodes(location)) {
      return candidate;
    }
    return undefined;
  }

  #createBreakpoint(breakpoint: BreakpointRequest): Breakpoint {
    this.#breakpointId += 1;
    const breakpointId = this.#breakpointId.toString();
    const breakpointRecord: Breakpoint = {
      id: breakpointId,
      resolvedBreakpoints: new Set(),
      ...breakpoint,
    };
    this.#breakpoints.set(breakpointId, breakpointRecord);
    return breakpointRecord;
  }

  #matchUrlBreakpoint(breakpoint: Pick<Breakpoint, 'url' | 'urlRegex'>, script: ScriptRecord | SourceTextModuleRecord | DynamicParsedCodeRecord): boolean {
    const url = script.HostDefined?.specifier;
    if (!url) return false;
    if (breakpoint.url && breakpoint.url !== url) return false;
    if (breakpoint.urlRegex && !new RegExp(breakpoint.urlRegex).test(url)) return false;
    return !!(breakpoint.url || breakpoint.urlRegex);
  }

  addBreakpointByUrl(breakpoint: Protocol.Debugger.SetBreakpointByUrlRequest): Protocol.Debugger.SetBreakpointByUrlResponse {
    const record = this.#createBreakpoint(breakpoint);
    const locations = this.#addBreakpointByUrl([record], this.parsedSources);
    return { breakpointId: record.id, locations };
  }

  #addBreakpointByUrl(breakpoints: Iterable<Breakpoint>, sources: Iterable<[string, ScriptRecord | SourceTextModuleRecord | DynamicParsedCodeRecord]>): BreakpointLocation[] {
    const nodes: ParseNode[] = [];
    const locations: BreakpointLocation[] = [];
    for (const breakpoint of breakpoints) {
      for (const { location, node } of this.#breakpointUrlRequestToLocations(breakpoint, sources)) {
        breakpoint.resolvedBreakpoints.add(node);
        getOrInsertComputed(this.#breakpointsByNode, node, () => new Set<Breakpoint>()).add(breakpoint);
        nodes.push(node);
        locations.push(location);
      }
    }
    return locations;
  }


  * #breakpointUrlRequestToLocations(breakpoint: Pick<Breakpoint, 'url' | 'urlRegex' | 'lineNumber' | 'columnNumber'>, sources: Iterable<[string, ScriptRecord | SourceTextModuleRecord | DynamicParsedCodeRecord]>): Generator<{ location: BreakpointLocation; node: ParseNode }> {
    for (const [scriptId, script] of sources) {
      if (this.#matchUrlBreakpoint(breakpoint, script)) {
        if (breakpoint.lineNumber !== undefined) {
          const node = this.#resolveBreakpointNode({
            scriptId,
            lineNumber: breakpoint.lineNumber,
            columnNumber: breakpoint.columnNumber,
          });
          if (node) {
            yield { location: parseNodeToBreakpointLocation(scriptId, node), node };
          }
        }
      }
    }
  }

  // TODO(debugger): we need to inject a debugger scope debug(f) function to trigger this
  addBreakpointOnFunctionCall(f: FunctionObject, condition: string | undefined): Protocol.Debugger.SetBreakpointOnFunctionCallResponse {
    const record = this.#createBreakpoint({ function: f, condition });
    this.breakpointsByFunction.add(f);
    return { breakpointId: record.id };
  }

  addInstrumentationBreakpoint(breakpoint: Protocol.Debugger.SetInstrumentationBreakpointRequest): Protocol.Debugger.SetInstrumentationBreakpointResponse {
    const record = this.#createBreakpoint(breakpoint);
    return { breakpointId: record.id };
  }

  addBreakpointByLocation(breakpoint: Protocol.Debugger.SetBreakpointRequest): Protocol.Debugger.SetBreakpointResponse {
    const record = this.#createBreakpoint(breakpoint);
    const node = this.#resolveBreakpointNode(breakpoint.location);
    if (node) {
      record.resolvedBreakpoints.add(node);
      getOrInsertComputed(this.#breakpointsByNode, node, () => new Set<Breakpoint>()).add(record);
    }
    return {
      breakpointId: record.id,
      actualLocation: node ? parseNodeToBreakpointLocation(breakpoint.location.scriptId, node) : breakpoint.location,
    };
  }

  removeBreakpoint(breakpointId: string) {
    const breakpoint = this.#breakpoints.get(breakpointId);
    if (breakpoint) {
      for (const node of breakpoint.resolvedBreakpoints) {
        const set = this.#breakpointsByNode.get(node);
        set?.delete(breakpoint);
        if (set?.size === 0) this.#breakpointsByNode.delete(node);
      }
    }
    this.#breakpoints.delete(breakpointId);
    if (breakpoint?.function) this.breakpointsByFunction.delete(breakpoint.function);
  }

  // #endregion
  // NON-SPEC
  // #region side-effect free evaluator
  #debugger_previewing = false;

  #debugger_objectsCreatedDuringPreview = new Set<ObjectValue>();

  get debugger_isPreviewing() {
    return this.#debugger_previewing;
  }

  get debugger_cannotPreview() {
    if (this.#debugger_previewing) {
      return ThrowCompletion(X(Construct(this.currentRealmRecord.Intrinsics['%EvalError%'], [Value('Preview evaluator cannot evaluate side-effecting code')])));
    }
    return undefined;
  }

  debugger_tryTouchDuringPreview(object: ObjectValue) {
    if (this.#debugger_previewing && !this.#debugger_objectsCreatedDuringPreview.has(object)) {
      return this.debugger_cannotPreview;
    }
    return undefined;
  }

  debugger_markObjectCreated(object: ObjectValue) {
    if (!this.#debugger_previewing) {
      return;
    }
    this.#debugger_objectsCreatedDuringPreview.add(object);
  }

  debugger_scopePreview(): Disposable | null;

  debugger_scopePreview<T>(cb: () => T): T;

  debugger_scopePreview<T>(cb?: () => T): T | Disposable | null {
    if (!cb) {
      const old = this.#debugger_previewing;
      this.#debugger_previewing = true;
      return {
        [Symbol.dispose]: () => {
          this.#debugger_previewing = old;
          this.#debugger_objectsCreatedDuringPreview.clear();
        },
      };
    } else {
      const old = this.#debugger_previewing;
      this.#debugger_previewing = true;
      try {
        const res = cb();
        return res;
      } finally {
        this.#debugger_previewing = old;
        if (!old) {
          this.#debugger_objectsCreatedDuringPreview.clear();
        }
      }
    }
  }
  // #endregion
}

export interface Breakpoint extends
  Partial<Protocol.Debugger.SetBreakpointByUrlRequest>,
  Partial<Protocol.Debugger.SetBreakpointOnFunctionCallRequest>,
  Partial<Protocol.Debugger.SetInstrumentationBreakpointRequest> {
  readonly id: string;
  readonly resolvedBreakpoints: Set<ParseNode>;
  readonly function?: FunctionObject;
}

export type BreakpointRequest =
  Partial<Protocol.Debugger.SetBreakpointRequest> &
  Partial<Protocol.Debugger.SetBreakpointByUrlRequest> &
  { readonly function?: FunctionObject; } &
  Partial<Protocol.Debugger.SetInstrumentationBreakpointRequest>;

/** https://tc39.es/ecma262/#sec-agentsignifier */
export function AgentSignifier() {
  const agentRecord = surroundingAgent.AgentRecord;
  return agentRecord.Signifier;
}

/** https://tc39.es/ecma262/#sec-agentcansuspend */
export function AgentCanSuspend() {
  const agentRecord = surroundingAgent.AgentRecord;
  return agentRecord.CanBlock;
}

// https://tc39.es/ecma262/#sec-IncrementModuleAsyncEvaluationCount
export function IncrementModuleAsyncEvaluationCount() {
  const agentRecord = surroundingAgent.AgentRecord;
  const count = agentRecord.ModuleAsyncEvaluationCount;
  agentRecord.ModuleAsyncEvaluationCount = count + 1;
  return count;
}

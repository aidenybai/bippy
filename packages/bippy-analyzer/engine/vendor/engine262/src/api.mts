import { ObjectValue, Value, type PropertyKeyValue } from './value.mts';
import {
  ScriptEvaluation,
  type Markable,
} from './host-defined/engine.mts';
import { HostEnqueueFinalizationRegistryCleanupJob } from './execution-context/WeakReference.mts';
import { AgentSignifier } from './execution-context/Agent.mts';
import { ExecutionContext } from './execution-context/ExecutionContext.mts';
import {
  X,
  ThrowCompletion,
  type PlainCompletion,
  type ValueCompletion,
  NormalCompletion,
  Q,
} from './completion.mts';
import {
  ParseScript,
  ParseModule,
  ParseJSONModule,
  ScriptRecord,
  type ParseScriptHostDefined,
} from './parse.mts';
import {
  CyclicModuleRecord, SyntheticModuleRecord, type ModuleRecordHostDefined, type ModuleRecordHostDefinedPublic,
} from './modules.mts';
import { isWeakRef, type WeakRefObject } from './intrinsics/WeakRef.mts';
import { isFinalizationRegistryObject, type FinalizationRegistryObject } from './intrinsics/FinalizationRegistry.mts';
import { isWeakMapObject, type WeakMapObject } from './intrinsics/WeakMap.mts';
import { isWeakSetObject, type WeakSetObject } from './intrinsics/WeakSet.mts';
import type { PromiseObject } from './intrinsics/Promise.mts';
import type { ParseNode } from './parser/ParseNode.mts';
import type { ModuleCache } from './utils/module.mts';
import {
  surroundingAgent, type GCMarker,
  CreateIntrinsics,
  SetDefaultGlobalBindings,
  OrdinaryObjectCreate,
  Assert,
  CreateTextModule,
  PerformPromiseThen,
  CreateBuiltinFunction,
  AllocateArrayBuffer,
  skipDebugger,
  CreateBytesModule,
  ValueOfNormalCompletion,
  type ResumeEvaluateOptions,
  Realm,
  GlobalEnvironmentRecord, type Intrinsics,
} from '#self';

/** https://tc39.es/ecma262/#sec-weakref-execution */
export function gc() {
  // At any time, if a set of objects S is not live, an ECMAScript implementation may perform the following steps atomically:
  // 1. For each obj of S, do
  //   a. For each WeakRef ref such that ref.[[WeakRefTarget]] is obj,
  //     i. Set ref.[[WeakRefTarget]] to empty.
  //   b. For each FinalizationRegistry fg such that fg.[[Cells]] contains cell, and cell.[[WeakRefTarget]] is obj,
  //     i. Set cell.[[WeakRefTarget]] to empty.
  //     ii. Let _enqueueCleanup_ be an implementation-defined choice of either *true* or *false*.
  //     iii. If _enqueueCleanup_ is *true*, perform HostEnqueueFinalizationRegistryCleanupJob(_fg_).
  //   c. For each WeakMap map such that map.WeakMapData contains a record r such that r.Key is obj,
  //     i. Set r.[[Key]] to empty.
  //     ii. Set r.[[Value]] to empty.
  //   d. For each WeakSet set such that set.[[WeakSetData]] contains obj,
  //     i. Replace the element of set whose value is obj with an element whose value is empty.

  const marked = new Set<unknown>();
  const weakrefs = new Set<WeakRefObject>();
  const fgs = new Set<FinalizationRegistryObject>();
  const weakmaps = new Set<WeakMapObject>();
  const weaksets = new Set<WeakSetObject>();
  const ephemeronQueue: WeakMapObject['WeakMapData'][number][] = [];

  const markCb: GCMarker = (O) => {
    if (typeof O !== 'object' || O === null) {
      return;
    }

    if (marked.has(O)) {
      return;
    }
    marked.add(O);

    if (isWeakRef(O)) {
      weakrefs.add(O);
      markCb(O.properties);
      markCb(O.Prototype);
    } else if (isFinalizationRegistryObject(O)) {
      fgs.add(O);
      markCb(O.properties);
      markCb(O.Prototype);
      O.Cells.forEach((cell) => {
        markCb(cell.HeldValue);
      });
    } else if (isWeakMapObject(O)) {
      weakmaps.add(O);
      markCb(O.properties);
      markCb(O.Prototype);
      O.WeakMapData.forEach((r) => {
        ephemeronQueue.push(r);
      });
    } else if (isWeakSetObject(O)) {
      weaksets.add(O);
      markCb(O.properties);
      markCb(O.Prototype);
    } else if ('mark' in O) {
      (O as Markable).mark(markCb);
    }
  };

  markCb(surroundingAgent);

  while (ephemeronQueue.length > 0) {
    const item = ephemeronQueue.shift()!;
    if (marked.has(item.Key)) {
      markCb(item.Value);
    }
  }

  weakrefs.forEach((ref) => {
    if (!marked.has(ref.WeakRefTarget)) {
      ref.WeakRefTarget = undefined;
    }
  });

  fgs.forEach((fg) => {
    let dirty = false;
    fg.Cells.forEach((cell) => {
      if (!marked.has(cell.WeakRefTarget)) {
        cell.WeakRefTarget = undefined;
        dirty = true;
      }
    });
    if (dirty) {
      HostEnqueueFinalizationRegistryCleanupJob(fg);
    }
  });

  weakmaps.forEach((map) => {
    map.WeakMapData.forEach((r) => {
      if (!marked.has(r.Key)) {
        r.Key = undefined;
        r.Value = undefined;
      }
    });
  });

  weaksets.forEach((set) => {
    set.WeakSetData.forEach((obj, i) => {
      if (!marked.has(obj)) {
        set.WeakSetData[i] = undefined;
      }
    });
  });
}

export interface ManagedRealmHostDefined {
  getImportMetaProperties?(module: ModuleRecordHostDefinedPublic): readonly { readonly Key: PropertyKeyValue, readonly Value: Value }[];
  finalizeImportMeta?(meta: ObjectValue, module: ModuleRecordHostDefinedPublic): PlainCompletion<void>;
  resolverCache?: ModuleCache;

  randomSeed?(): string;
  attachingInspector?: unknown;
  attachingInspectorReportError?(realm: Realm, error: Value): void;
  /**
   * See https://tc39.es/ecma262/#sec-HostLoadImportedModule
   * In case of
   *  <button type="button" onclick="import('./foo.mjs')">Click me</button>
   * and
   *  new ShadowRealm().importValue('./foo.mjs', 'default')
   * a Realm instead of a ModuleRecord or ScriptRecord is passed as the referrer.
   */
  specifier?: string | undefined;
  /** The name displayed in the inspector. */
  name?: string | undefined;
}
export class ManagedRealm extends Realm {
  override TemplateMap: { Site: ParseNode.TemplateLiteral; Array: ObjectValue; }[];

  override AgentSignifier: unknown;

  override Intrinsics: Intrinsics;

  override randomState: BigUint64Array<ArrayBufferLike> | undefined;

  override GlobalObject: ObjectValue;

  override GlobalEnv: GlobalEnvironmentRecord;

  override HostDefined: ManagedRealmHostDefined;

  topContext: ExecutionContext;

  /**
   * Push this realm's top context (if it is not currently) as the running execution context.
   *
   * Callers must ensure to call the return value after the work is done.
   */
  pushTopContext(): (() => void) | undefined {
    if (surroundingAgent.runningExecutionContext !== this.topContext) {
      surroundingAgent.executionContextStack.push(this.topContext);
      return () => surroundingAgent.executionContextStack.pop(this.topContext);
    }
    return undefined;
  }

  /** https://tc39.es/ecma262/#sec-initializehostdefinedrealm */
  constructor(HostDefined: ManagedRealmHostDefined = {}, customizations?: (record: Realm) => [global: ObjectValue | undefined, thisValue: ObjectValue | undefined]) {
    super();
    this.Intrinsics = CreateIntrinsics(this);
    this.AgentSignifier = AgentSignifier();
    this.TemplateMap = [];
    let [global, thisValue] = customizations?.(this) || [];
    if (!global) {
      global = OrdinaryObjectCreate(this.Intrinsics['%Object.prototype%']);
    } else {
      Assert(global instanceof ObjectValue);
    }
    if (!thisValue) {
      thisValue = global;
    } else {
      Assert(thisValue instanceof ObjectValue);
    }
    this.GlobalObject = global;
    this.GlobalEnv = new GlobalEnvironmentRecord(global, thisValue);
    SetDefaultGlobalBindings(this);
    const newContext = new ExecutionContext();
    newContext.Function = Value.null;
    newContext.Realm = this;
    newContext.ScriptOrModule = null;
    this.HostDefined = HostDefined;
    this.topContext = newContext;

    surroundingAgent.hostDefinedOptions.onRealmCreated?.(this);
  }

  compileScript(sourceText: string, hostDefined?: ParseScriptHostDefined): PlainCompletion<ScriptRecord> {
    const pop = this.pushTopContext();
    const s = ParseScript(sourceText, this, hostDefined);
    pop?.();
    if (Array.isArray(s)) {
      return ThrowCompletion(s[0]);
    }
    return NormalCompletion(s);
  }

  compileModule(sourceText: string, hostDefined?: ModuleRecordHostDefined) {
    const pop = this.pushTopContext();
    const s = ParseModule(sourceText, this, hostDefined);
    pop?.();
    if (Array.isArray(s)) {
      return ThrowCompletion(s[0]);
    }
    return NormalCompletion(s);
  }

  /**
   * Evaluate a script.
   * @param callback will be called after the evaluation is finished. callback may be called synchronously.
   * When the callback is called, any execution context pushed for the evaluation will have been popped. (safe to run `runJobQueue`).
   */
  evaluateScript(
    sourceText: string | ScriptRecord,
    scriptOptions: ParseScriptHostDefined = {},
    callback: (completion: NormalCompletion<Value> | ThrowCompletion) => void,
    evaluationOptions?: ResumeEvaluateOptions | false,
  ): void {
    if (typeof sourceText === 'string') {
      const completion = this.compileScript(sourceText, scriptOptions);
      if (completion instanceof ThrowCompletion) {
        callback(completion);
        return;
      }
      sourceText = ValueOfNormalCompletion(completion);
    }
    if (!sourceText) throw new TypeError('sourceText is null or undefined');
    surroundingAgent.evaluate(ScriptEvaluation(sourceText), callback, evaluationOptions);
  }

  /**
   * Evaluate a script (skip the debugger).
   */
  evaluateScriptSkipDebugger(sourceText: string | ScriptRecord, scriptOptions: ParseScriptHostDefined = {}): ValueCompletion {
    let completion;
    this.evaluateScript(sourceText, scriptOptions, (c) => {
      completion = c;
    }, { noBreakpoint: true });
    if (!completion) throw new Assert.Error('Expect evaluation completes synchronously');
    return completion;
  }

  /**
   * Evaluate a module.
   * @param callback will be called after the evaluation is finished. callback may be called synchronously.
   * callback will be called **with or without an execution context**.
   */
  evaluateModule<T extends CyclicModuleRecord>(sourceText: string | T, specifier: string | undefined, finish: (completion: ValueCompletion<PromiseObject>) => void) {
    if (sourceText === undefined || sourceText === null) throw new TypeError('sourceText must be a string or a ModuleRecord');
    const moduleCompletion = typeof sourceText === 'string' ? this.compileModule(sourceText, { specifier }) : sourceText;

    if (this.HostDefined.resolverCache && typeof specifier === 'string') {
      const key = this.HostDefined.resolverCache.toCacheKey({ Specifier: specifier, Attributes: [] });
      this.HostDefined.resolverCache.set(key, moduleCompletion);
    }

    if (moduleCompletion instanceof ThrowCompletion) {
      finish(moduleCompletion);
      return;
    }
    const module = X(moduleCompletion);

    const pop = this.pushTopContext();
    PerformPromiseThen(module.LoadRequestedModules(), CreateBuiltinFunction.from(function* linkAndEvaluate() {
      const link = module.Link();
      if (link instanceof ThrowCompletion) {
        finish(link);
        return Value.undefined;
      }
      finish(yield* module.Evaluate());
      return Value.undefined;
    }), CreateBuiltinFunction.from((err = Value.undefined) => {
      finish(ThrowCompletion(err));
    }));
    pop?.();
    surroundingAgent.eventLoop.runOnce();
  }

  createJSONModule(sourceText: string): PlainCompletion<SyntheticModuleRecord> {
    if (typeof sourceText !== 'string') {
      throw new TypeError('sourceText must be a string');
    }
    const pop = this.pushTopContext();
    const module = ParseJSONModule(sourceText);
    pop?.();
    return module;
  }

  createTextModule(sourceText: string): PlainCompletion<SyntheticModuleRecord> {
    if (typeof sourceText !== 'string') {
      throw new TypeError('sourceText must be a string');
    }
    const pop = this.pushTopContext();
    const module = CreateTextModule(sourceText);
    pop?.();
    return module;
  }

  createBytesModule(content: Uint8Array): PlainCompletion<SyntheticModuleRecord> {
    if (!(content instanceof Uint8Array)) {
      throw new TypeError('content must be a Uint8Array');
    }
    const pop = this.pushTopContext();
    const arrayBuffer = Q(skipDebugger(AllocateArrayBuffer(surroundingAgent.intrinsic('%ArrayBuffer%'), content.buffer.byteLength)));
    const module = CreateBytesModule(arrayBuffer);
    pop?.();
    return module;
  }
}

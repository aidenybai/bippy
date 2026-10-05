import {
  type FinalizationRegistryObject, Q, ObjectValue, SymbolValue, Assert, HostCallJobCallback, type JobCallbackRecord, Value, KeyForSymbol,
  GetActiveScriptOrModule,
  surroundingAgent,
  type Job,
  type PlainEvaluator,
} from '#self';


/** https://tc39.es/ecma262/#sec-host-cleanup-finalization-registry */
export function HostEnqueueFinalizationRegistryCleanupJob(finalizationRegistry: FinalizationRegistryObject): void {
  const hostHook = surroundingAgent.hostDefinedOptions.hostHooks?.HostEnqueueFinalizationRegistryCleanupJob;
  if (hostHook) {
    hostHook(finalizationRegistry);
    return;
  }
  if (surroundingAgent.finalizationRegistryScheduledForCleanup.has(finalizationRegistry)) return;
  surroundingAgent.finalizationRegistryScheduledForCleanup.add(finalizationRegistry);
  const cleanJob: Job = {
    queueName: 'FinalizationRegistryCleanup',
    job: function finalizationJob() {
      surroundingAgent.finalizationRegistryScheduledForCleanup.delete(finalizationRegistry);
      return CleanupFinalizationRegistry(finalizationRegistry);
    },
    callerRealm: surroundingAgent.currentRealmRecord,
    callerScriptOrModule: GetActiveScriptOrModule(),
  };
  surroundingAgent.jobQueue.enqueueFinalizationRegistryCleanupJob(cleanJob);
}

/** https://tc39.es/ecma262/#sec-clear-kept-objects */
export function ClearKeptObjects() {
  // 1. Let agentRecord be the surrounding agent's Agent Record.
  const agentRecord = surroundingAgent.AgentRecord;
  // 2. Set agentRecord.[[KeptAlive]] to a new empty List.
  agentRecord.KeptAlive = new Set();
}

/** https://tc39.es/ecma262/#sec-addtokeptobjects */
export function AddToKeptObjects(object: ObjectValue | SymbolValue) {
  // 1. Let agentRecord be the surrounding agent's Agent Record.
  const agentRecord = surroundingAgent.AgentRecord;
  // 2. Append object to agentRecord.[[KeptAlive]].
  agentRecord.KeptAlive.add(object);
}

/** https://tc39.es/ecma262/#sec-cleanup-finalization-registry */
export function* CleanupFinalizationRegistry(finalizationRegistry: FinalizationRegistryObject, callback?: JobCallbackRecord): PlainEvaluator<void> {
  Q(surroundingAgent.debugger_tryTouchDuringPreview(finalizationRegistry));
  // 1. Assert: finalizationRegistry has [[Cells]] and [[CleanupCallback]] internal slots.
  Assert('Cells' in finalizationRegistry && 'CleanupCallback' in finalizationRegistry);
  // 2. Set callback to finalizationRegistry.[[CleanupCallback]].
  if (callback === undefined) {
    callback = finalizationRegistry.CleanupCallback;
  }
  // 3. While finalizationRegistry.[[Cells]] contains a Record cell such that cell.[[WeakRefTarget]] is empty, an implementation may perform the following steps:
  for (let i = 0; i < finalizationRegistry.Cells.length; i += 1) {
    // a. Choose any such _cell_.
    const cell = finalizationRegistry.Cells[i];
    if (cell.WeakRefTarget !== undefined) {
      continue;
    }
    // b. Remove cell from finalizationRegistry.[[Cells]].
    finalizationRegistry.Cells.splice(i, 1);
    i -= 1;
    // c. Perform ? HostCallJobCallback(callback, undefined, « cell.[[HeldValue]] »).
    Q(yield* HostCallJobCallback(callback, Value.undefined, [cell.HeldValue]));
  }
}

/** https://tc39.es/ecma262/#sec-canbeheldweakly */
export function CanBeHeldWeakly(v: Value): v is ObjectValue | SymbolValue {
  // 1. If v is an Object, return true.
  if (v instanceof ObjectValue) {
    return true;
  }

  // 2. If v is a Symbol and KeyForSymbol(v) is undefined, return true.
  if (v instanceof SymbolValue && KeyForSymbol(v) === undefined) {
    return true;
  }

  // 3. Return false.
  return false;
}

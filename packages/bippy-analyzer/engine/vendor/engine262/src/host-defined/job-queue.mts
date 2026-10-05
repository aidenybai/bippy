import { callCallback } from '../utils/callback.mts';
import {
  AbruptCompletion, Assert, ClearKeptObjects, ExecutionContext, type GCMarker, type Job, type Markable, ThrowCompletion, Value, type ValueEvaluator, skipDebugger, surroundingAgent,
} from '#self';


/** https://tc39.es/ecma262/#sec-jobs */
export function runSingleJobInQueue(job: Job, onError: (error: Value) => void, finished: () => void) {
  // At some future point in time, when there is no running context in the agent for which the job is scheduled and that agent's execution context stack is empty, the implementation must:
  Assert(!surroundingAgent.executionContextStack.length);

  // 1. Perform any implementation-defined preparation steps.
  const { callerRealm, callerScriptOrModule, job: evaluator } = job;
  if (callerRealm) {
    // Spec: If a Realm Record is provided, these operations schedule the job to be performed at some future time in the provided realm, in the agent that owns the realm.
    const newContext = new ExecutionContext();
    surroundingAgent.executionContextStack.push(newContext);
    newContext.Function = Value.null;
    newContext.Realm = callerRealm;
    newContext.ScriptOrModule = callerScriptOrModule;
    surroundingAgent.evaluate((function* job(): ValueEvaluator {
      // 2. Invoke the Job Abstract Closure.
      const completion = yield* evaluator();
      surroundingAgent.executionContextStack.pop(newContext);
      continuation(completion);
      return Value.undefined;
    }()), () => {});
  } else {
    // Spec: If null is provided instead for the realm, then the job does not evaluate ECMAScript code.
    // 2. Invoke the Job Abstract Closure.
    const completion = skipDebugger(evaluator());
    continuation(completion);
  }

  function continuation(completion: unknown) {
    // 3. Perform any host-defined cleanup steps, after which the execution context stack must be empty.
    Assert(!surroundingAgent.executionContextStack.length);
    ClearKeptObjects();
    // The Abstract Closure must return a normal completion, implementing its own handling of errors.
    if (completion instanceof AbruptCompletion) {
      Assert(completion instanceof ThrowCompletion);
      onError(completion.Value);
    }
    finished();
  }
}

export interface JobQueue extends Markable {
  enqueueFinalizationRegistryCleanupJob(job: Job): void;
  enqueuePromiseJob(job: Job): void;
  enqueueTimeoutJob(job: Job): void;
  enqueueGenericJob(job: Job): void;
  onNewJob: Set<(job: Job) => void>;

  shift(): Job | undefined;
  shiftFinalizationRegistryCleanupJob?(): Job | undefined;
  shiftPromiseJob?(): Job | undefined;
  shiftTimeoutJob?(): Job | undefined;
  shiftGenericJob?(): Job | undefined;
  get length(): number;
}

export class BasicJobQueue extends Set<Job> implements JobQueue, Markable {
  enqueueFinalizationRegistryCleanupJob(job: Job): void {
    this.add(job);
    callCallback(this.onNewJob, job);
  }

  enqueuePromiseJob(job: Job): void {
    this.add(job);
    callCallback(this.onNewJob, job);
  }

  enqueueTimeoutJob(job: Job): void {
    this.add(job);
    callCallback(this.onNewJob, job);
  }

  enqueueGenericJob(job: Job): void {
    this.add(job);
    callCallback(this.onNewJob, job);
  }

  onNewJob: JobQueue['onNewJob'] = new Set();

  shift(): Job | undefined {
    const [job] = this;
    this.delete(job);
    return job;
  }

  get length(): number {
    return this.size;
  }

  mark(marker: GCMarker): void {
    for (const job of this) {
      marker(job.job);
      marker(job.callerRealm);
      marker(job.callerScriptOrModule);
    }
  }
}

export class ByTypeJobQueue implements JobQueue, Markable {
  #all = new Set<Job>();

  #finalizationRegistryCleanupJobs = new Set<Job>();

  #promiseJobs = new Set<Job>();

  #timeoutJobs = new Set<Job>();

  #genericJobs = new Set<Job>();

  enqueueFinalizationRegistryCleanupJob(job: Job): void {
    this.#finalizationRegistryCleanupJobs.add(job);
    this.#all.add(job);
    callCallback(this.onNewJob, job);
  }

  enqueuePromiseJob(job: Job): void {
    this.#promiseJobs.add(job);
    this.#all.add(job);
    callCallback(this.onNewJob, job);
  }

  enqueueTimeoutJob(job: Job): void {
    this.#timeoutJobs.add(job);
    this.#all.add(job);
    callCallback(this.onNewJob, job);
  }

  enqueueGenericJob(job: Job): void {
    this.#genericJobs.add(job);
    this.#all.add(job);
    callCallback(this.onNewJob, job);
  }

  onNewJob: JobQueue['onNewJob'] = new Set();

  shift(): Job | undefined {
    const [job] = this.#all;
    this.#all.delete(job);
    this.#finalizationRegistryCleanupJobs.delete(job);
    this.#promiseJobs.delete(job);
    this.#timeoutJobs.delete(job);
    this.#genericJobs.delete(job);
    return job;
  }

  shiftFinalizationRegistryCleanupJob(): Job | undefined {
    const [job] = this.#finalizationRegistryCleanupJobs;
    this.#finalizationRegistryCleanupJobs.delete(job);
    this.#all.delete(job);
    return job;
  }

  shiftPromiseJob(): Job | undefined {
    const [job] = this.#promiseJobs;
    this.#promiseJobs.delete(job);
    this.#all.delete(job);
    return job;
  }

  shiftTimeoutJob(): Job | undefined {
    const [job] = this.#timeoutJobs;
    this.#timeoutJobs.delete(job);
    this.#all.delete(job);
    return job;
  }

  shiftGenericJob(): Job | undefined {
    const [job] = this.#genericJobs;
    this.#genericJobs.delete(job);
    this.#all.delete(job);
    return job;
  }

  get length(): number {
    return this.#all.size;
  }

  mark(marker: GCMarker): void {
    for (const job of this.#all) {
      marker(job.job);
      marker(job.callerRealm);
      marker(job.callerScriptOrModule);
    }
  }
}

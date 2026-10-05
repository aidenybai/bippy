import { callCallback } from '../utils/callback.mts';
import {
  Agent,
  type GCMarker, type Job, type Markable,
  runSingleJobInQueue,
} from '#self';

/** https://nodejs.org/learn/asynchronous-work/event-loop-timers-and-nexttick */
export type NodeJSJobType = 'timers' | 'pending callbacks' | 'idle-prepare' | 'poll' | 'check' | 'close callbacks';
export type EventLoopRunType = 'manual' | 'automatic';

export interface EventLoop extends Markable {
  /**
   * Enqueue a host job (macrotask) now.
   */
  enqueue(type: NodeJSJobType | string, job: Job): void;

  /**
   * Enqueue a host job (macrotask) in the future.
   * It will keep `hasPendingJobs` to be `true` until `enqueue` is called.
   *
   * @example
   * ```
   * eventLoop.enqueueAsync('timers', job, (enqueue, cancel) => {
   *   setTimeout(() => {
   *     enqueue();
   *   }, timeout);
   * });
   * ```
   */
  enqueueAsync(type: NodeJSJobType | string, job: Job, executor: (enqueue: () => void, cancel: () => void) => void): void;

  /** Change the automatic run type of the event loop and run it */
  run(type: EventLoopRunType): void;

  runOnce(): void;

  readonly hasPendingJobs: boolean;
  /**
   * Register a callback to be called when there are no async queued jobs.
   *
   * This can be used to implement a mechanism to exit the program when all code has finished executing.
   */
  onNoPendingJob: Set<() => void>;
}

export abstract class AbstractEventLoop implements EventLoop {
  protected readonly surroundingAgent: Agent;

  #runType?: EventLoopRunType;

  #flushState: 'idle' | 'running' | 'rerun' = 'idle';

  public readonly onNoPendingJob: Set<() => void> = new Set();

  constructor(surroundingAgent: Agent) {
    this.surroundingAgent = surroundingAgent;
  }

  abstract enqueue(type: NodeJSJobType | string, job: Job): void;

  protected abstract shiftNextJob(): Job | undefined;

  protected abstract get hasQueuedJobs(): boolean;

  protected tryScheduleAutomaticFlush() {
    this.#tryScheduleAutomaticFlush();
  }

  #tryScheduleAutomaticFlush = () => {
    if (this.#runType !== 'automatic') return;
    this.runOnce();
  };

  #pendingJobs = new Set<Job>();

  /**
   * Enqueue a host job (macrotask) in the future.
   * It will keep `hasPendingJobs` to be `true` until `enqueue` is called.
   *
   * @example
   * ```
   * eventLoop.enqueueAsync('timers', job, (enqueue, cancel) => {
   *   setTimeout(() => {
   *     enqueue();
   *   }, timeout);
   * });
   * ```
   */
  enqueueAsync(type: NodeJSJobType | string, job: Job, doAsyncEnqueue: (enqueue: () => void, cancel: () => void) => void): void {
    this.#pendingJobs.add(job);
    doAsyncEnqueue(() => {
      this.#pendingJobs.delete(job);
      this.enqueue(type, job);
      this.#callNoPendingJobsCallback();
    }, () => {
      this.#pendingJobs.delete(job);
      this.#callNoPendingJobsCallback();
    });
  }

  get hasPendingJobs(): boolean {
    return this.#pendingJobs.size > 0;
  }

  /** Change the automatic run type of the event loop */
  run(type: EventLoopRunType): void {
    this.surroundingAgent.jobQueue.onNewJob.delete(this.#tryScheduleAutomaticFlush);
    this.surroundingAgent.onNoEvaluator.delete(this.#tryScheduleAutomaticFlush);
    this.#runType = type;
    if (type === 'automatic') {
      this.surroundingAgent.jobQueue.onNewJob.add(this.#tryScheduleAutomaticFlush);
      this.surroundingAgent.onNoEvaluator.add(this.#tryScheduleAutomaticFlush);
    }
    this.runOnce();
  }

  runOnce() {
    if (this.surroundingAgent.executionContextStack.length > 0 || this.surroundingAgent.isPaused()) return;
    if (this.#flushState === 'running') {
      this.#flushState = 'rerun';
      return;
    }
    if (this.#flushState === 'rerun') return;
    this.#flushState = 'running';
    this.#continueFlush();
  }

  #continueFlush() {
    let previousJobSyncFinished = true;
    while (previousJobSyncFinished) {
      previousJobSyncFinished = false;

      const job = this.shiftNextJob();
      if (!job) {
        this.#finishFlush();
        return;
      }

      let currentJobSyncFinished = true;
      runSingleJobInQueue(job, (error) => {
        this.surroundingAgent.hostDefinedOptions.uncaughtExceptionTrackers?.forEach((tracker) => tracker(error));
      }, () => {
        if (currentJobSyncFinished) {
          previousJobSyncFinished = true;
          return;
        }
        this.#continueFlush();
      });
      currentJobSyncFinished = false;
    }
  }

  #finishFlush() {
    if (this.#flushState === 'rerun') {
      this.#flushState = 'running';
      this.#continueFlush();
      return;
    }
    this.#flushState = 'idle';
    this.#callNoPendingJobsCallback();
  }

  #callNoPendingJobsCallback() {
    if (this.surroundingAgent.jobQueue.length === 0 && !this.hasQueuedJobs && !this.hasPendingJobs) {
      callCallback(this.onNoPendingJob);
    }
  }

  mark(marker: GCMarker): void {
    for (const job of this.#pendingJobs) {
      marker(job.callerRealm);
      marker(job.callerScriptOrModule);
      marker(job.job);
    }
  }
}

export class MicroTaskEventLoop extends AbstractEventLoop {
  enqueue(_type: string, job: Job): void {
    this.surroundingAgent.jobQueue.enqueueGenericJob(job);
    this.tryScheduleAutomaticFlush();
  }

  protected shiftNextJob(): Job | undefined {
    return this.surroundingAgent.jobQueue.shift();
  }

  protected get hasQueuedJobs(): boolean {
    // all jobs are microtasks, there are no jobs queued in this subclass.
    return false;
  }
}

/** https://developer.mozilla.org/en-US/docs/Web/API/HTML_DOM_API/Microtask_guide/In_depth */
export class WebLikeEventLoop extends AbstractEventLoop {
  protected jobsByType: Record<string, Set<Job>> = Object.create(null);

  protected queuedJobs = new Map<Job, string>();

  /**
   * Enqueue a host job (macrotask) now.
   */
  enqueue(type: NodeJSJobType | string, job: Job): void {
    this.jobsByType[type] ??= new Set<Job>();
    this.jobsByType[type].add(job);
    this.queuedJobs.set(job, type);
    this.tryScheduleAutomaticFlush();
  }

  protected shiftNextJob(): Job | undefined {
    const queuedJob = this.surroundingAgent.jobQueue.shift();
    if (queuedJob) return queuedJob;
    const macrotask = this.queuedJobs.entries().next().value;
    if (!macrotask) return undefined;
    this.queuedJobs.delete(macrotask[0]);
    this.jobsByType[macrotask[1]]!.delete(macrotask[0]);
    return macrotask[0];
  }

  protected get hasQueuedJobs(): boolean {
    return this.queuedJobs.size > 0;
  }

  override mark(marker: GCMarker): void {
    super.mark(marker);
    for (const job of this.queuedJobs.keys()) {
      marker(job.job);
      marker(job.callerRealm);
      marker(job.callerScriptOrModule);
    }
  }
}

const NODEJS_PHASES = [
  'timers',
  'pending callbacks',
  'idle-prepare',
  'poll',
  'check',
  'close callbacks',
] as const satisfies readonly NodeJSJobType[];
function isNodeJSJobType(type: NodeJSJobType | string): type is NodeJSJobType {
  return NODEJS_PHASES.includes(type as NodeJSJobType);
}

/** https://nodejs.org/learn/asynchronous-work/event-loop-timers-and-nexttick */
export class NodeJSLikeEventLoop extends AbstractEventLoop {
  fallbackType: NodeJSJobType = 'poll';

  protected jobsByType: Record<NodeJSJobType, Set<Job>> = {
    'timers': new Set(),
    'pending callbacks': new Set(),
    'idle-prepare': new Set(),
    'poll': new Set(),
    'check': new Set(),
    'close callbacks': new Set(),
  };

  protected queuedJobs = new Set<Job>();

  enqueue(type: NodeJSJobType | string, job: Job): void {
    const queueType = isNodeJSJobType(type) ? type : this.fallbackType;
    this.jobsByType[queueType].add(job);
    this.queuedJobs.add(job);
    this.tryScheduleAutomaticFlush();
  }

  #phase_index = 0;

  #advancePhase() {
    this.#phase_index = (this.#phase_index + 1) % NODEJS_PHASES.length;
  }

  #shiftCurrentPhaseTask(): Job | undefined {
    const type = NODEJS_PHASES[this.#phase_index]!;
    const [job] = this.jobsByType[type];
    if (!job) {
      return undefined;
    }
    this.jobsByType[type].delete(job);
    this.queuedJobs.delete(job);
    return job;
  }

  protected shiftNextJob(): Job | undefined {
    const queuedJob = this.surroundingAgent.jobQueue.shift();
    if (queuedJob) return queuedJob;

    for (let i = 0; i < NODEJS_PHASES.length; i += 1) {
      const macrotask = this.#shiftCurrentPhaseTask();
      if (macrotask) return macrotask;
      this.#advancePhase();
    }

    return undefined;
  }

  protected get hasQueuedJobs(): boolean {
    return this.queuedJobs.size > 0;
  }

  override mark(marker: GCMarker): void {
    super.mark(marker);
    for (const job of this.queuedJobs) {
      marker(job.job);
      marker(job.callerRealm);
      marker(job.callerScriptOrModule);
    }
  }
}

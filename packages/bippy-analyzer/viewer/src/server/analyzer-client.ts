import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { viewerRoot } from "./paths";
import type { WorkerAsk, WorkerReply } from "./worker";

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

interface Worker {
  child: ChildProcessByStdio<Writable, Readable, null>;
  pending: Map<number, Pending>;
  nextId: number;
}

declare global {
  var bippyAnalyzerWorker: Worker | undefined;
}

const isReply = (value: unknown): value is WorkerReply =>
  typeof value === "object" &&
  value !== null &&
  "id" in value &&
  typeof value.id === "number" &&
  "ok" in value &&
  typeof value.ok === "boolean";

const settle = (worker: Worker, reply: WorkerReply): void => {
  const pending = worker.pending.get(reply.id);
  if (!pending) return;
  worker.pending.delete(reply.id);
  if (reply.ok) pending.resolve(reply.result);
  else pending.reject(new Error(reply.error));
};

const startWorker = (): Worker => {
  const child = spawn("pnpm", ["-s", "exec", "tsx", "src/server/worker.ts"], {
    cwd: viewerRoot,
    stdio: ["pipe", "pipe", "inherit"],
  });
  const worker: Worker = { child, pending: new Map(), nextId: 1 };
  createInterface({ input: child.stdout }).on("line", (line) => {
    const parsed: unknown = JSON.parse(line);
    if (isReply(parsed)) settle(worker, parsed);
  });
  child.on("exit", () => {
    for (const pending of worker.pending.values()) pending.reject(new Error("Analyzer exited"));
    worker.pending.clear();
    if (globalThis.bippyAnalyzerWorker === worker) globalThis.bippyAnalyzerWorker = undefined;
  });
  return worker;
};

const getWorker = (): Worker => {
  globalThis.bippyAnalyzerWorker ??= startWorker();
  return globalThis.bippyAnalyzerWorker;
};

export const ask = (request: WorkerAsk): Promise<unknown> => {
  const worker = getWorker();
  const id = worker.nextId++;
  return new Promise((resolve, reject) => {
    worker.pending.set(id, { resolve, reject });
    worker.child.stdin.write(`${JSON.stringify({ id, ...request })}\n`);
  });
};

import { createInterface } from "node:readline";
import { listExamples } from "./examples";
import { savePaste } from "./paste";
import { getAnalyzerJson, getViewFile } from "./view-model";

export type WorkerAsk =
  | { kind: "view"; file: string }
  | { kind: "json"; file: string }
  | { kind: "examples" }
  | { kind: "paste"; code: string };

export type WorkerRequest = WorkerAsk & { id: number };

export type WorkerReply =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

const isRequest = (value: unknown): value is WorkerRequest =>
  typeof value === "object" &&
  value !== null &&
  "id" in value &&
  typeof value.id === "number" &&
  "kind" in value &&
  typeof value.kind === "string";

const handle = (request: WorkerRequest): unknown => {
  switch (request.kind) {
    case "view":
      return getViewFile(request.file);
    case "json":
      return getAnalyzerJson(request.file);
    case "examples":
      return listExamples();
    case "paste":
      return getViewFile(savePaste(request.code));
  }
};

const reply = (message: WorkerReply): void => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

const serve = (line: string): void => {
  const parsed: unknown = JSON.parse(line);
  if (!isRequest(parsed)) return;
  try {
    reply({ id: parsed.id, ok: true, result: handle(parsed) });
  } catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    reply({ id: parsed.id, ok: false, error: message });
  }
};

createInterface({ input: process.stdin }).on("line", serve);

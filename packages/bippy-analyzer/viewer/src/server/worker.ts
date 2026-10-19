import { createInterface } from "node:readline";
import { z } from "zod";
import { listExamples } from "./examples";
import { getAnalyzerJson, getViewFile } from "./view-model";

export const workerAskSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("view"), file: z.string() }),
  z.object({ kind: z.literal("json"), file: z.string() }),
  z.object({ kind: z.literal("examples") }),
]);

export type WorkerAsk = z.infer<typeof workerAskSchema>;

const workerRequestSchema = z.intersection(workerAskSchema, z.object({ id: z.number() }));

type WorkerRequest = z.infer<typeof workerRequestSchema>;

export const workerReplySchema = z.discriminatedUnion("ok", [
  z.object({ id: z.number(), ok: z.literal(true), result: z.unknown() }),
  z.object({ id: z.number(), ok: z.literal(false), error: z.string() }),
]);

export type WorkerReply = z.infer<typeof workerReplySchema>;

const handle = (request: WorkerRequest): unknown => {
  switch (request.kind) {
    case "view":
      return getViewFile(request.file);
    case "json":
      return getAnalyzerJson(request.file);
    case "examples":
      return listExamples();
  }
};

const reply = (message: WorkerReply): void => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

const serve = (line: string): void => {
  const request = workerRequestSchema.safeParse(JSON.parse(line));
  if (!request.success) return;
  try {
    reply({ id: request.data.id, ok: true, result: handle(request.data) });
  } catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    reply({ id: request.data.id, ok: false, error: message });
  }
};

const warm = (files: string[]): void => {
  const [file, ...rest] = files;
  if (file === undefined) return;
  setImmediate(() => {
    try {
      getViewFile(file);
    } catch (error) {
      process.stderr.write(`${String(error)}\n`);
    }
    warm(rest);
  });
};

createInterface({ input: process.stdin }).on("line", serve);
warm(listExamples().map((example) => example.file));

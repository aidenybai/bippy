import { existsSync, readFileSync } from "node:fs";
import { Session } from "node:inspector";
import { fileURLToPath } from "node:url";
import { writeRawCoverage, type V8CoverageEntry } from "./fixture.js";

interface ScriptCoverage {
  scriptId: string;
  url: string;
  functions: unknown[];
}

interface PreciseCoverageResult {
  result: ScriptCoverage[];
}

interface ScriptSourceResult {
  scriptSource: string;
}

const post = <Result>(
  session: Session,
  method: string,
  params?: Record<string, unknown>,
): Promise<Result> =>
  new Promise((resolve, reject) => {
    session.post(method, params ?? {}, (error, result) => {
      if (error) reject(error);
      else resolve(result as Result);
    });
  });

const readDiskSource = (url: string): string | null => {
  try {
    const path = url.startsWith("file://") ? fileURLToPath(url) : url;
    if (!existsSync(path)) return null;
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

const resolveSource = async (
  session: Session,
  entry: ScriptCoverage,
  sourceCache: Map<string, string>,
): Promise<string | null> => {
  const cached = sourceCache.get(entry.scriptId) ?? sourceCache.get(entry.url);
  if (cached) return cached;

  // Prefer the script V8 actually executed. Vitest/vite-node often keeps a
  // file://…/*.ts URL while running transformed JS — disk would return TS and
  // silently corrupt byte offsets.
  try {
    const { scriptSource } = await post<ScriptSourceResult>(session, "Debugger.getScriptSource", {
      scriptId: entry.scriptId,
    });
    if (typeof scriptSource === "string" && scriptSource.length > 0) {
      sourceCache.set(entry.scriptId, scriptSource);
      sourceCache.set(entry.url, scriptSource);
      return scriptSource;
    }
  } catch {
    // fall through to disk
  }

  const fromDisk = readDiskSource(entry.url);
  if (fromDisk !== null) {
    sourceCache.set(entry.scriptId, fromDisk);
    sourceCache.set(entry.url, fromDisk);
    return fromDisk;
  }
  return null;
};

const shouldKeepUrl = (url: string): boolean => {
  if (!url) return false;
  if (url.startsWith("node:")) return false;
  if (url.includes("node_modules")) return false;
  return true;
};

export const flushNodeCoverage = async (
  session: Session,
  rawDir: string,
  sourceCache: Map<string, string>,
): Promise<void> => {
  const { result } = await post<PreciseCoverageResult>(session, "Profiler.takePreciseCoverage");
  const entries: V8CoverageEntry[] = [];
  for (const entry of result) {
    if (!shouldKeepUrl(entry.url)) continue;
    const source = await resolveSource(session, entry, sourceCache);
    if (source === null) continue;
    entries.push({
      url: entry.url,
      source,
      scriptId: entry.scriptId,
      functions: entry.functions,
    });
  }
  writeRawCoverage(rawDir, entries);
};

export interface NodeCoverageSession {
  session: Session;
  sourceCache: Map<string, string>;
}

export const startNodeCoverageSession = async (): Promise<NodeCoverageSession | null> => {
  const session = new Session();
  try {
    session.connect();
    await post(session, "Profiler.enable");
    await post(session, "Debugger.enable");
    await post(session, "Profiler.startPreciseCoverage", {
      callCount: true,
      detailed: true,
    });
    return { session, sourceCache: new Map() };
  } catch {
    try {
      session.disconnect();
    } catch {
      // ignore
    }
    return null;
  }
};

export const stopNodeCoverageSession = async (session: Session): Promise<void> => {
  try {
    await post(session, "Profiler.stopPreciseCoverage");
    await post(session, "Profiler.disable");
    session.disconnect();
  } catch {
    // ignore: coverage is best-effort
  }
};

/** One-shot Node V8 capture: start precise coverage, run `use`, write one dump. */
export const captureNodeCoverage = async (
  rawDir: string,
  use: () => Promise<void>,
): Promise<void> => {
  const started = await startNodeCoverageSession();
  try {
    await use();
  } finally {
    if (started) {
      try {
        await flushNodeCoverage(started.session, rawDir, started.sourceCache);
      } catch {
        // ignore
      }
      await stopNodeCoverageSession(started.session);
    }
  }
};

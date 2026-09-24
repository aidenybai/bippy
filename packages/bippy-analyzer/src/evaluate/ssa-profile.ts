import { formatSourceLocation } from "../parse/source-location.js";
import type { FunctionLikeNode, ParsedSourceFile, SourceLocation } from "../parse/source-types.js";

export interface SsaFallback {
  category: "static" | "input" | "deoptimization";
  reason: string;
  location: SourceLocation | null;
}

export interface SsaCompilationSample {
  milliseconds: number;
  blocks: number;
  instructions: number;
  phis: number;
}

export interface SsaAttemptRecord {
  fallback: SsaFallback | null;
  isUncertain: boolean;
  milliseconds: number;
  compilation: SsaCompilationSample | null;
}

export interface SsaFallbackCount {
  fallback: SsaFallback;
  count: number;
}

export interface SsaFunctionProfile {
  node: FunctionLikeNode;
  file: ParsedSourceFile;
  invocations: number;
  executions: number;
  uncertainExecutions: number;
  fallbacks: Map<string, SsaFallbackCount>;
  compilation: SsaCompilationSample | null;
  executionMilliseconds: number;
  attemptMilliseconds: number;
  fallbackMilliseconds: number;
  fallbackSelfMilliseconds: number;
}

export interface SsaProfile {
  functions: Map<FunctionLikeNode, SsaFunctionProfile>;
  childMilliseconds: number[];
}

let activeProfile: SsaProfile | null = null;

export const getSsaProfile = (): SsaProfile | null => activeProfile;

export const startSsaProfile = (): SsaProfile => {
  if (activeProfile) throw new Error("An SSA profile is already active");
  activeProfile = { functions: new Map(), childMilliseconds: [] };
  return activeProfile;
};

export const stopSsaProfile = (profile: SsaProfile): void => {
  if (activeProfile !== profile) throw new Error("Stopping an inactive SSA profile");
  activeProfile = null;
};

const getFunctionProfile = (
  profile: SsaProfile,
  node: FunctionLikeNode,
  file: ParsedSourceFile,
): SsaFunctionProfile => {
  const existing = profile.functions.get(node);
  if (existing) return existing;
  const created: SsaFunctionProfile = {
    node,
    file,
    invocations: 0,
    executions: 0,
    uncertainExecutions: 0,
    fallbacks: new Map(),
    compilation: null,
    executionMilliseconds: 0,
    attemptMilliseconds: 0,
    fallbackMilliseconds: 0,
    fallbackSelfMilliseconds: 0,
  };
  profile.functions.set(node, created);
  return created;
};

const addChildMilliseconds = (profile: SsaProfile, milliseconds: number): void => {
  const depth = profile.childMilliseconds.length;
  if (depth) profile.childMilliseconds[depth - 1] += milliseconds;
};

export const getFallbackKey = (fallback: SsaFallback): string =>
  `${fallback.category}:${fallback.reason}@${formatSourceLocation(fallback.location)}`;

export const recordSsaAttempt = (
  profile: SsaProfile,
  node: FunctionLikeNode,
  file: ParsedSourceFile,
  attempt: SsaAttemptRecord,
): void => {
  const functionProfile = getFunctionProfile(profile, node, file);
  functionProfile.invocations++;
  functionProfile.compilation ??= attempt.compilation;
  addChildMilliseconds(profile, attempt.milliseconds);
  if (!attempt.fallback) {
    functionProfile.executions++;
    if (attempt.isUncertain) functionProfile.uncertainExecutions++;
    functionProfile.executionMilliseconds += attempt.milliseconds;
    return;
  }
  functionProfile.attemptMilliseconds += attempt.milliseconds;
  const key = getFallbackKey(attempt.fallback);
  const counted = functionProfile.fallbacks.get(key);
  if (counted) counted.count++;
  else functionProfile.fallbacks.set(key, { fallback: attempt.fallback, count: 1 });
};

export const measureSsaFallback = <Result>(
  profile: SsaProfile,
  node: FunctionLikeNode,
  file: ParsedSourceFile,
  run: () => Result,
): Result => {
  const functionProfile = getFunctionProfile(profile, node, file);
  profile.childMilliseconds.push(0);
  const startedAt = performance.now();
  try {
    return run();
  } finally {
    const elapsed = performance.now() - startedAt;
    const childMilliseconds = profile.childMilliseconds.pop() ?? 0;
    functionProfile.fallbackMilliseconds += elapsed;
    functionProfile.fallbackSelfMilliseconds += elapsed - childMilliseconds;
    addChildMilliseconds(profile, elapsed);
  }
};

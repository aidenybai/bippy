import { z } from "zod";

export class ParserError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Input (manifest, snapshot, generated table, package manifest) that does not match its schema. */
export class SchemaError extends ParserError {
  constructor(
    readonly source: string,
    readonly issues: z.ZodError,
  ) {
    super(`${source}: ${z.prettifyError(issues)}`);
  }
}

export const parseWithSchema = <Output>(
  schema: z.ZodType<Output>,
  value: unknown,
  source: string,
): Output => {
  const result = schema.safeParse(value);
  if (!result.success) throw new SchemaError(source, result.error);
  return result.data;
};

/** A `.d.ts` import specifier that neither an ambient `declare module` nor module resolution provides. */
export class DeclarationModuleError extends ParserError {
  constructor(
    readonly specifier: string,
    readonly fromFile: string,
    reason: string,
  ) {
    super(`cannot resolve declaration module "${specifier}" from ${fromFile}: ${reason}`);
  }
}

export class StaleGeneratedFileError extends ParserError {
  constructor(readonly filePath: string) {
    super(`${filePath} is out of date; run the generator that owns it`);
  }
}

export class CommandFailedError extends ParserError {
  constructor(
    readonly command: string,
    readonly exitCode: number | null,
  ) {
    super(`\`${command}\` exited with code ${exitCode}`);
  }
}

export class CommandTimeoutError extends ParserError {
  constructor(
    readonly command: string,
    readonly timeoutMs: number,
  ) {
    super(`\`${command}\` timed out after ${timeoutMs}ms`);
  }
}

export class DevServerError extends ParserError {
  constructor(
    message: string,
    readonly logPath: string,
  ) {
    super(`${message}; see ${logPath}`);
  }
}

export class CorpusRevisionError extends ParserError {
  constructor(
    readonly cloneDirectory: string,
    readonly head: string,
    readonly pinned: string,
  ) {
    super(
      `${cloneDirectory} is at ${head.slice(0, 10)} but the manifest pins ${pinned.slice(0, 10)}`,
    );
  }
}

export class NoCommitsError extends ParserError {
  constructor(
    readonly url: string,
    readonly title: string,
    readonly pageErrors: string[],
  ) {
    super(
      [`no React commits observed at ${url} ("${title}")`, ...pageErrors]
        .join("; ")
        .slice(0, 1_000),
    );
  }
}

export class HarnessInjectionError extends ParserError {
  constructor(readonly url: string) {
    super(`harness globals missing on ${url}; the init script did not run`);
  }
}

export class BundleError extends ParserError {}

export class ReactRuntimeError extends ParserError {}

export class FrameworkTargetError extends ParserError {}

export class ComponentKindError extends ParserError {}

/** A decision marker in a captured static tree lacks the id the materializer stamps on every one. */
export class MarkerDecisionError extends ParserError {
  constructor(readonly markerName: string) {
    super(`${markerName} marker without a decision id`);
  }
}

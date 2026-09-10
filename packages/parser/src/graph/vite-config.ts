import { existsSync } from "node:fs";
import path from "node:path";
import { DEV_SERVER_MODE } from "../evaluate/bundler-globals.js";
import { Interpreter, UNKNOWN_PROJECT } from "../evaluate/interpreter.js";
import { bytesValue } from "../evaluate/typed-arrays.js";
import {
  FALSE_VALUE,
  getKnownObjectKeys,
  getTruthiness,
  isNullish,
  objectFromRecord,
  primitiveValue,
  UNDEFINED_VALUE,
} from "../evaluate/values.js";
import { SourceFileCache } from "../parse/parse-source-file.js";
import type { ProcessEnvironment, ProjectContext, StaticValue } from "../types.js";
import { ModuleGraph } from "./module-graph.js";
import type { ModuleResolver } from "./module-resolver.js";

// Vite loads `vite.config.*` from the directory it runs in (or `--config`),
// calls a function export with the command's environment and reads the result.
// The config is ordinary TypeScript run in Node, so it is evaluated like any
// server module: plugin factories from packages stay external, and only the
// fields the dev server's asset URLs depend on are read.

const VITE_CONFIG_FILES = ["js", "mjs", "cjs", "ts", "mts", "cts"].map(
  (extension) => `vite.config.${extension}`,
);

const DEFAULT_ASSETS_INLINE_LIMIT = 4096;
const DEFAULT_PUBLIC_DIRECTORY = "public";
const DEFAULT_BASE = "/";
const VITE_APP_TYPES = new Set(["spa", "mpa", "custom"]);
const GIT_LFS_PREFIX = Buffer.from("version https://git-lfs.github.com");

export type ViteAppType = "spa" | "mpa" | "custom";

export interface ViteConfig {
  /** Served root (`root`), resolved against where Vite runs. */
  root: string;
  /** Directory served as-is at the URL root (`publicDir`), resolved against the root; null when disabled. */
  publicDir: string | null;
  /** Public base path the dev server prefixes URLs with (`base`), as Vite resolves it in dev. */
  base: string;
  /** The mode the dev server runs in (`--mode`, `import.meta.env.MODE`). */
  mode: string;
  /** `appType`: only `spa` answers an unmatched HTML-accepting GET with the root `index.html`. */
  appType: ViteAppType;
  /** The `server.proxy` contexts (path prefixes, or `^`-anchored patterns) forwarded upstream; null when the config leaves them undecided. */
  proxyContexts: string[] | null;
  /** `build.assetsInlineLimit` applied to an asset: Vite's decision, or null when the config leaves it undecided. */
  shouldInlineAsset: (filePath: string, content: Buffer) => boolean | null;
}

export interface ViteConfigOptions {
  /** The app's directory: the served root when no config is found. */
  rootDirectory: string;
  /** Where the dev command runs; the config is looked up there before `rootDirectory` (a workspace script may delegate to the app's own). */
  devDirectory?: string;
  resolver: ModuleResolver;
  hasDeclaredDependency: ProjectContext["hasDeclaredDependency"];
  readPackageVersion: ProjectContext["readPackageVersion"];
  /** The environment the config module reads through `process.env`. */
  environment?: ProcessEnvironment;
  /** The command line the dev server is started with; its `--config` and `--mode` flags apply. */
  devCommand?: string;
}

interface ViteCliOptions {
  configPath: string | null;
  mode: string | null;
}

const CLI_FLAGS: Record<string, keyof ViteCliOptions> = {
  "-c": "configPath",
  "--config": "configPath",
  "-m": "mode",
  "--mode": "mode",
};

const parseViteCli = (command: string | undefined): ViteCliOptions => {
  const options: ViteCliOptions = { configPath: null, mode: null };
  const words = command?.split(/\s+/) ?? [];
  words.forEach((word, index) => {
    const [flag, inlineValue] = word.split("=", 2);
    const option = CLI_FLAGS[flag];
    const value = inlineValue ?? words[index + 1];
    if (option !== undefined && value !== undefined) options[option] = value;
  });
  return options;
};

export const findViteConfig = (rootDirectory: string): string | undefined =>
  VITE_CONFIG_FILES.map((fileName) => path.join(rootDirectory, fileName)).find((candidate) =>
    existsSync(candidate),
  );

interface ViteConfigLocation {
  configPath: string;
  /** The directory Vite runs in, which `root` and `--config` resolve against. */
  cwd: string;
}

const locateViteConfig = (
  directories: string[],
  configPath: string | null,
): ViteConfigLocation | null => {
  for (const cwd of directories) {
    const candidate = configPath === null ? findViteConfig(cwd) : path.resolve(cwd, configPath);
    if (candidate !== undefined && existsSync(candidate)) return { configPath: candidate, cwd };
  }
  return null;
};

const isGitLfsPlaceholder = (content: Buffer): boolean =>
  content.subarray(0, GIT_LFS_PREFIX.length).equals(GIT_LFS_PREFIX);

const isUnderLimit = (limit: number, content: Buffer): boolean =>
  content.length < limit && !isGitLfsPlaceholder(content);

const shouldInlineByDefault = (content: Buffer): boolean =>
  isUnderLimit(DEFAULT_ASSETS_INLINE_LIMIT, content);

const getStringLiteral = (value: StaticValue): string | null =>
  value.kind === "primitive" && typeof value.value === "string" ? value.value : null;

/** `resolveBaseUrl` while serving: an empty or relative base is `/`, anything else (an external URL included) is its pathname, which `import.meta.env.BASE_URL` reads verbatim. */
const resolveDevBase = (base: StaticValue): string => {
  const literal = getStringLiteral(base);
  if (literal === null || literal === "" || literal.startsWith(".")) return DEFAULT_BASE;
  return new URL(literal, "http://vite.dev").pathname;
};

const resolvePublicDir = (publicDir: StaticValue, root: string): string | null => {
  if (publicDir.kind === "primitive" && (publicDir.value === false || publicDir.value === "")) {
    return null;
  }
  return path.resolve(root, getStringLiteral(publicDir) ?? DEFAULT_PUBLIC_DIRECTORY);
};

/** What alternatives agree on; null when they differ or one is undecided. */
const agreedDecision = (decisions: (boolean | null)[]): boolean | null => {
  const [first] = decisions;
  return first !== undefined && decisions.every((decision) => decision === first) ? first : null;
};

/** A callback's return as Vite reads it: nullish defers to the default limit, anything else is its truthiness. */
const decideFromCallbackResult = (result: StaticValue, content: Buffer): boolean | null => {
  if (result.kind === "branch") {
    return agreedDecision(
      result.alternatives.map((alternative) => decideFromCallbackResult(alternative, content)),
    );
  }
  const isResultNullish = isNullish(result);
  if (isResultNullish === null) return null;
  return isResultNullish ? shouldInlineByDefault(content) : getTruthiness(result);
};

const isViteAppType = (value: string): value is ViteAppType => VITE_APP_TYPES.has(value);

const resolveAppType = (appType: StaticValue): ViteAppType => {
  const literal = getStringLiteral(appType);
  return literal !== null && isViteAppType(literal) ? literal : "spa";
};

/** The keys of `server.proxy`: Vite forwards a request whose URL starts with one (or matches a `^` pattern). */
const resolveProxyContexts = (proxy: StaticValue): string[] | null => {
  if (isNullish(proxy) === true) return [];
  return proxy.kind === "object" ? getKnownObjectKeys(proxy) : null;
};

export const defaultViteConfig = (rootDirectory: string, mode = DEV_SERVER_MODE): ViteConfig => ({
  root: rootDirectory,
  publicDir: path.resolve(rootDirectory, DEFAULT_PUBLIC_DIRECTORY),
  base: DEFAULT_BASE,
  mode,
  appType: "spa",
  proxyContexts: [],
  shouldInlineAsset: (_filePath, content) => shouldInlineByDefault(content),
});

export const loadViteConfig = ({
  rootDirectory,
  devDirectory = rootDirectory,
  resolver,
  hasDeclaredDependency,
  readPackageVersion,
  environment,
  devCommand,
}: ViteConfigOptions): ViteConfig => {
  const cli = parseViteCli(devCommand);
  const cliMode = cli.mode ?? DEV_SERVER_MODE;
  const location = locateViteConfig([...new Set([devDirectory, rootDirectory])], cli.configPath);
  if (location === null) return defaultViteConfig(rootDirectory, cliMode);
  const { configPath, cwd } = location;
  const graph = new ModuleGraph({ resolver, sourceFileCache: new SourceFileCache() });
  const module = graph.getModule(configPath);
  if (!module) return defaultViteConfig(cwd, cliMode);
  const interpreter = new Interpreter(graph, {
    hostPlatform: "node",
    environment,
    project: {
      ...UNKNOWN_PROJECT,
      rootDirectory: cwd,
      servedDirectory: cwd,
      hasDeclaredDependency,
      readPackageVersion,
    },
  });
  const context = interpreter.createModuleContext(module);
  const exported = interpreter.evaluateModuleExport(module, "default");
  const configEnv = objectFromRecord({
    command: primitiveValue("serve"),
    mode: primitiveValue(cliMode),
    isSsrBuild: FALSE_VALUE,
    isPreview: FALSE_VALUE,
  });
  const config =
    exported.kind === "function" || exported.kind === "native-function"
      ? interpreter.callAwaited(exported, [configEnv], context, null)
      : exported;
  /** `config?.[key]`: an absent section falls back to Vite's defaults rather than throwing. */
  const readField = (object: StaticValue, key: string): StaticValue =>
    isNullish(object) === true
      ? UNDEFINED_VALUE
      : interpreter.getProperty(object, key, context, null);
  const root = path.resolve(cwd, getStringLiteral(readField(config, "root")) ?? "");
  const mode = cli.mode ?? getStringLiteral(readField(config, "mode")) ?? DEV_SERVER_MODE;
  const assetsInlineLimit = readField(readField(config, "build"), "assetsInlineLimit");
  /** `mergeWithDefaults` fills only `undefined` with the 4096 default; `null` stays and `Number(null)` is `0`. */
  const decideFromLimit = (
    limit: StaticValue,
    filePath: string,
    content: Buffer,
  ): boolean | null => {
    switch (limit.kind) {
      case "branch":
        return agreedDecision(
          limit.alternatives.map((alternative) => decideFromLimit(alternative, filePath, content)),
        );
      case "primitive":
        return limit.value === undefined
          ? shouldInlineByDefault(content)
          : isUnderLimit(Number(limit.value), content);
      case "function":
      case "native-function":
        return decideFromCallbackResult(
          interpreter.callValue(
            limit,
            [primitiveValue(filePath), bytesValue("Uint8Array", content)],
            context,
            null,
          ),
          content,
        );
      default:
        return null;
    }
  };
  return {
    root,
    publicDir: resolvePublicDir(readField(config, "publicDir"), root),
    base: resolveDevBase(readField(config, "base")),
    mode,
    appType: resolveAppType(readField(config, "appType")),
    proxyContexts: resolveProxyContexts(readField(readField(config, "server"), "proxy")),
    shouldInlineAsset: (filePath, content) => decideFromLimit(assetsInlineLimit, filePath, content),
  };
};

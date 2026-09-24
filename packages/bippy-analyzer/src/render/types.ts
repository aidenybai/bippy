import type { RuntimeSnapshot } from "../harness/snapshot.js";
import type { HostPlatform } from "../host/host-realm.js";
import type { Diagnostic } from "../parse/source-types.js";
import type { GuardContext } from "../symbolic/guards.js";
import type {
  ExternalValueProvider,
  JsonValue,
  ModuleTranspiler,
  ProcessEnvironment,
  RuntimeObservations,
} from "../types.js";

export interface StaticRenderStats {
  fiberCount: number;
  textCount: number;
  branchCount: number;
  repeatCount: number;
  opaqueCount: number;
  unknownCount: number;
  modulesLoaded: number;
}

export interface StaticRenderResult {
  /** The fiber tree React committed for the materialized element, as bippy observed it. */
  snapshot: RuntimeSnapshot;
  /** Every tree committed while effects, state updates and timers settled, in commit order. */
  commits: RuntimeSnapshot[];
  commitCauses?: GuardContext[];
  diagnostics: Diagnostic[];
  stats: StaticRenderStats;
}

export interface StaticRendererOptions {
  rootDirectory: string;
  /** The bundler's served root (Vite `root`), relative to `rootDirectory`; `rootDirectory` itself by default. */
  servedDirectory?: string;
  /** Directory served as-is at the URL root (Vite `publicDir`), relative to `rootDirectory`; `public/` under the served root by default. */
  publicDirectory?: string;
  tsconfigPath?: string;
  /** Bundler `resolve.alias` entries, targets relative to `rootDirectory`. */
  aliases?: Record<string, string>;
  conditionNames?: string[];
  maxComponentDepth?: number;
  maxFiberCount?: number;
  maxRecursionPerComponent?: number;
  maxCallDepth?: number;
  maxSteps?: number;
  /** Quiet window (no React commit) after which the runtime snapshot is taken; timers delayed at least this long have not fired by then. */
  settleMs?: number;
  /** Milliseconds a timer may fire before its delay as `Date.now()` measures it (see `ClockReading`). */
  timerUnderrunMs?: number;
  resolveExternalPackages?: boolean;
  /** Package names to analyze from source; `@scope/*` admits every package in a scope (monorepo workspaces). */
  externalPackageAllowList?: string[];
  /** Apply React Server Components semantics: components outside `"use client"` modules render without a fiber. */
  serverComponents?: boolean;
  renderIntoDocument?: boolean;
  /** The JavaScript host the client code runs on, deciding which globals exist; browser when unset. Server-side code always sees Node. */
  hostPlatform?: HostPlatform;
  /**
   * Functions the boot code calls before mounting (registries, stores), as
   * `path#exportName` or `path#exportName(globalName, ...)` to pass `window`
   * properties; evaluated in order before the root.
   */
  bootstrap?: string[];
  /** `window` properties the served page defines (server-injected config); nested objects are partial, so unlisted keys stay unknown. */
  globals?: Record<string, JsonValue>;
  /** Expressions the bundler inlines at build time (`DefinePlugin`, Vite `define`), keyed by source text such as `process.env.FLAG`; an environment variable or bundler shim (`global`) given `null` is left unset. */
  defines?: Record<string, JsonValue>;
  /** The config the bundler's svgr plugin hands `@svgr/core` (`plugins`, `svgo`, `dimensions`, ...); unset, the `@svgr/webpack`/`@svgr/rollup` loader defaults apply. */
  svgr?: Record<string, JsonValue>;
  /** The server process's environment, whole; unlisted variables are unset. */
  environment?: ProcessEnvironment;
  /** The command line the dev server is started with; bundler flags such as Vite's `--config`/`--mode` apply to the static render. */
  devCommand?: string;
  /** Directory `devCommand` runs in, where the bundler looks its config up; relative to `rootDirectory`, which it is when unset. */
  devDirectory?: string;
  /** URL path (pathname, search, hash) the page is rendered at; `location` reads it. */
  route?: string;
  /** Origin (`http://localhost:3000`) the dev server serves the page from; `location` reads it and same-origin asset URLs resolve to its static files. */
  origin?: string;
  /** Defaults to what the root's Vite config implies (Vite ≤ 7 without an swc/oxc React plugin transpiles with esbuild), else `name-preserving`. */
  transpiler?: ModuleTranspiler;
  /** Vite plugins (by name, with their `name:` and `name-` companions) a framework model stands in for; the app's config is resolved without them. */
  modeledVitePlugins?: readonly string[];
  /** What a running page was observed to hold; the render takes these as its runtime inputs. */
  observations?: RuntimeObservations;
  externalValues?: ExternalValueProvider;
  /** Decisions the materializer selects instead of rendering every alternative; a replay of one enumerated state. */
  decisions?: PinnedDecisions;
}

export interface PinnedBranchDecision {
  /** Index into the alternatives as the pattern reader orders them (a negated predicate reads swapped). */
  alternativeIndex: number;
  /** Decisions inside the chosen alternative. */
  inside: PinnedDecisions;
}

export interface PinnedRepeatDecision {
  /** Decisions inside each iteration; the length is the pinned count. */
  iterations: PinnedDecisions[];
}

/**
 * The decisions of one enumerated state, keyed by the id the materializer
 * stamps on its `$Branch` and `$Repeat` markers. Ids are numbered per
 * decision scope (the root, one alternative, one iteration), so the nested
 * maps follow the tree the way the materializer does.
 */
export interface PinnedDecisions {
  branches: ReadonlyMap<string, PinnedBranchDecision>;
  repeats: ReadonlyMap<string, PinnedRepeatDecision>;
}

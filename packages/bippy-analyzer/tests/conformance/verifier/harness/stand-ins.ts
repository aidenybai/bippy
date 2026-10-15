import { builtinModules } from "node:module";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, sep } from "node:path";
import type { DepOptimizationConfig, Plugin } from "vite";
import {
  PACKAGE_SPECIFIER_PATTERN,
  PATH_SPECIFIER_PATTERN,
  isAppSourceModule,
  isRequirable,
} from "./packages";
import { PREBUNDLED_STUBS, STAND_IN_SOURCE } from "./stubs";

type OptimizerPlugin = NonNullable<
  NonNullable<DepOptimizationConfig["esbuildOptions"]>["plugins"]
>[number];

const SERVER_ONLY_PACKAGES = new Set([
  "@prisma/client",
  "firebase-admin",
  "@clerk/backend",
  "@clerk/nextjs/server",
  "@neondatabase/serverless",
  "@planetscale/database",
  "@upstash/redis",
  "@vercel/blob",
  "@vercel/kv",
  "@vercel/postgres",
  "bcrypt",
  "cross-spawn",
  "dotenv",
  "dotenv/config",
  "execa",
  "ioredis",
  "mongodb",
  "mongoose",
  "mysql2",
  "next-auth",
  "next-auth/next",
  "nodemailer",
  "npm-run-path",
  "pg",
  "postgres",
  "resend",
  "stripe",
]);
const SERVER_ONLY_PREFIXES = [
  "@arcjet/",
  "@aws-sdk/",
  "@prisma/client/",
  "drizzle-orm/node-postgres",
  "drizzle-orm/postgres-js",
  "drizzle-orm/neon-",
  "drizzle-orm/pglite",
  "drizzle-orm/mysql2",
  "drizzle-orm/libsql",
  "drizzle-orm/better-sqlite3",
  "drizzle-orm/vercel-postgres",
  "drizzle-orm/planetscale-serverless",
  "firebase-admin/",
  "next-auth/providers/",
  "node:",
];
const SERVER_ONLY_ADAPTER_PATTERN = /^@(?:next-)?auth\/.+-adapter$/;
const STAND_IN_MODULE_PREFIX = "\0bippy-verify-stand-in:";
const MISSING_MODULE_NAMESPACE = "bippy-verify-missing-module";
const NODE_BUILTIN_NAMESPACE = "bippy-verify-node-builtin";
const NODE_BUILTINS = new Set(builtinModules);
const LAZY_IMPORT_KINDS = new Set(["require-call", "dynamic-import"]);

const isServerOnlyPackage = (specifier: string): boolean =>
  SERVER_ONLY_PACKAGES.has(specifier) ||
  SERVER_ONLY_PREFIXES.some((prefix) => specifier.startsWith(prefix)) ||
  SERVER_ONLY_ADAPTER_PATTERN.test(specifier);

const isNodeOnlyModule = (
  specifier: string,
  importer: string | undefined,
  polyfilledModules: Set<string>,
): boolean => {
  const name = specifier.replace(/^node:/, "").split("/")[0] ?? "";
  if (!NODE_BUILTINS.has(name) || polyfilledModules.has(name)) return false;
  return (
    specifier.startsWith("node:") ||
    importer === undefined ||
    !isRequirable(`${name}/package.json`, importer)
  );
};

const isAppFile = (id: string): boolean =>
  isAbsolute(id) && !id.includes(`${sep}node_modules${sep}`) && existsSync(id);

const createStandInModuleSource = (names: Set<string>): string =>
  [
    `import { STAND_IN } from ${JSON.stringify(STAND_IN_SOURCE)};`,
    "export default STAND_IN;",
    ...[...names]
      .filter((name) => name !== "default")
      .map((name) => `export const ${name} = STAND_IN;`),
  ].join("\n");

export const createStandInPlugin = (
  polyfilledModules: Set<string>,
  packageImports: Map<string, Set<string>>,
): Plugin => ({
  name: "bippy-verify-stand-ins",
  enforce: "pre",
  async resolveId(source, importer) {
    if (isServerOnlyPackage(source)) return `${STAND_IN_MODULE_PREFIX}${source}`;
    if (!isNodeOnlyModule(source, importer, polyfilledModules)) return null;
    if (source.startsWith("node:")) return `${STAND_IN_MODULE_PREFIX}${source}`;
    const resolved = await this.resolve(source, importer, { skipSelf: true });
    return resolved && isAppFile(resolved.id) ? null : `${STAND_IN_MODULE_PREFIX}${source}`;
  },
  load: (id) =>
    id.startsWith(STAND_IN_MODULE_PREFIX)
      ? createStandInModuleSource(
          packageImports.get(id.slice(STAND_IN_MODULE_PREFIX.length)) ?? new Set(),
        )
      : null,
});

export const createMissingModulePlugin = (): Plugin => ({
  name: "bippy-verify-missing-modules",
  enforce: "pre",
  async resolveId(source, importer) {
    if (!importer || !isAppSourceModule(importer) || !PACKAGE_SPECIFIER_PATTERN.test(source))
      return null;
    return (
      (await this.resolve(source, importer, { skipSelf: true })) ??
      `${STAND_IN_MODULE_PREFIX}${source}`
    );
  },
});

export const createPrebundledStubPlugin = (): OptimizerPlugin => ({
  name: "bippy-verify-prebundled-stubs",
  setup: (build) => {
    build.onResolve({ filter: /^(?:server-only|next\/font\/local)$/ }, ({ path }) => {
      const stubPath = PREBUNDLED_STUBS.get(path);
      return stubPath ? { path: stubPath } : undefined;
    });
  },
});

export const createMissingDependencyPlugin = (): OptimizerPlugin => ({
  name: MISSING_MODULE_NAMESPACE,
  setup: (build) => {
    build.onResolve({ filter: /.*/ }, ({ path, importer, kind }) =>
      LAZY_IMPORT_KINDS.has(kind) &&
      importer &&
      !PATH_SPECIFIER_PATTERN.test(path) &&
      !isRequirable(path, importer)
        ? { path, namespace: MISSING_MODULE_NAMESPACE }
        : undefined,
    );
    build.onLoad({ filter: /.*/, namespace: MISSING_MODULE_NAMESPACE }, ({ path }) => ({
      contents: `throw new Error(${JSON.stringify(`Cannot find module '${path}'`)});`,
      loader: "js",
    }));
  },
});

export const createNodeBuiltinPlugin = (polyfilledModules: Set<string>): OptimizerPlugin => ({
  name: NODE_BUILTIN_NAMESPACE,
  setup: (build) => {
    build.onResolve({ filter: /.*/ }, ({ path, importer }) =>
      isServerOnlyPackage(path) || isNodeOnlyModule(path, importer, polyfilledModules)
        ? { path, namespace: NODE_BUILTIN_NAMESPACE }
        : undefined,
    );
    build.onLoad({ filter: /.*/, namespace: NODE_BUILTIN_NAMESPACE }, () => ({
      contents: `module.exports = require(${JSON.stringify(STAND_IN_SOURCE)}).STAND_IN;`,
      loader: "js",
      resolveDir: dirname(STAND_IN_SOURCE),
    }));
  },
});

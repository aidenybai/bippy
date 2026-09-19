import { readFileSync } from "node:fs";
import { z } from "zod";
import { parseWithSchema } from "./errors.js";

interface PackageManifest {
  name?: string;
  version?: string;
  sideEffects?: boolean | string[];
  bundledVersions?: Record<string, string>;
  homepage?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
}

const dependenciesSchema = z.record(z.string(), z.string()).optional();

const packageManifestSchema: z.ZodType<PackageManifest> = z.object({
  name: z.string().optional(),
  version: z.string().optional(),
  sideEffects: z.union([z.boolean(), z.array(z.string())]).optional(),
  bundledVersions: dependenciesSchema,
  homepage: z.string().optional(),
  dependencies: dependenciesSchema,
  devDependencies: dependenciesSchema,
  peerDependencies: dependenciesSchema,
  optionalDependencies: dependenciesSchema,
  workspaces: z
    .union([z.array(z.string()), z.object({ packages: z.array(z.string()).optional() })])
    .optional(),
});

export const readPackageManifest = (manifestPath: string): PackageManifest =>
  parseWithSchema(
    packageManifestSchema,
    JSON.parse(readFileSync(manifestPath, "utf8")),
    manifestPath,
  );

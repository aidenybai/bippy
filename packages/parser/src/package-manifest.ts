import { readFileSync } from "node:fs";
import { z } from "zod";
import { parseWithSchema } from "./errors.js";

export interface PackageManifest {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

const dependenciesSchema = z.record(z.string(), z.string()).optional();

const packageManifestSchema: z.ZodType<PackageManifest> = z.object({
  name: z.string().optional(),
  version: z.string().optional(),
  dependencies: dependenciesSchema,
  devDependencies: dependenciesSchema,
  peerDependencies: dependenciesSchema,
  optionalDependencies: dependenciesSchema,
});

export const readPackageManifest = (manifestPath: string): PackageManifest =>
  parseWithSchema(
    packageManifestSchema,
    JSON.parse(readFileSync(manifestPath, "utf8")),
    manifestPath,
  );

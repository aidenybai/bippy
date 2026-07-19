import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_REPOSITORY_URL = "git+https://github.com/aidenybai/bippy.git";
const WORKSPACE_DIRECTORIES = ["packages"];

const rootDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");

const collectPackageManifestPaths = () => {
  const packageManifestPaths = [];

  for (const workspaceDirectoryName of WORKSPACE_DIRECTORIES) {
    const workspaceDirectory = join(rootDirectory, workspaceDirectoryName);
    if (!existsSync(workspaceDirectory)) continue;

    for (const workspaceEntry of readdirSync(workspaceDirectory, { withFileTypes: true })) {
      if (!workspaceEntry.isDirectory()) continue;

      const packageManifestPath = join(workspaceDirectory, workspaceEntry.name, "package.json");
      if (!existsSync(packageManifestPath)) continue;

      packageManifestPaths.push(packageManifestPath);
    }
  }

  return packageManifestPaths;
};

const offendingPackages = [];

for (const packageManifestPath of collectPackageManifestPaths()) {
  const packageManifest = JSON.parse(readFileSync(packageManifestPath, "utf8"));
  if (packageManifest.private === true) continue;

  const repositoryUrl =
    typeof packageManifest.repository === "string"
      ? packageManifest.repository
      : packageManifest.repository?.url;

  if (repositoryUrl !== EXPECTED_REPOSITORY_URL) {
    offendingPackages.push({
      name: packageManifest.name,
      packageManifestPath,
      repositoryUrl: repositoryUrl ?? "(missing)",
    });
  }
}

if (offendingPackages.length > 0) {
  console.error(
    `\nProvenance check failed. npm publish with provenance requires every publishable package to declare repository.url === "${EXPECTED_REPOSITORY_URL}".\n`,
  );

  for (const offendingPackage of offendingPackages) {
    console.error(
      `  - ${offendingPackage.name}: ${offendingPackage.repositoryUrl}\n    ${offendingPackage.packageManifestPath}`,
    );
  }

  console.error("");
  process.exit(1);
}

console.log("Provenance check passed: all publishable packages declare a matching repository.url.");

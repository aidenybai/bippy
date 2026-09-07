import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runCommand } from "./process.js";
import {
  type CorpusCheckout,
  type CorpusRepository,
  getRepositoryDirectoryName,
  getRepositoryUrl,
} from "./repositories.js";
import { linkWorkspacePackages } from "./workspaces.js";

export interface CheckoutOptions {
  /** Directory that holds one clone per repository. */
  cacheDirectory: string;
  /** Directory that holds one set of workspace package links per repository. */
  linksDirectory: string;
  /** Fetch the branch tip again for clones that already exist. */
  update: boolean;
  /** Fail instead of cloning when a repository is missing from the cache. */
  offline: boolean;
}

const CLONE_TIMEOUT_MS = 20 * 60_000;

const git = (args: string[], cwd: string): Promise<string> =>
  runCommand("git", args, {
    cwd,
    timeoutMs: CLONE_TIMEOUT_MS,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1" },
  });

/**
 * Shallow clone of the default branch; only the working tree matters for
 * analysis, so history is not fetched. Dependencies are not installed, but
 * workspace packages are linked so cross-package imports resolve to source.
 * Returns the checkout together with the commit that was analyzed, for
 * reproducible reports.
 */
export const checkoutRepository = async (
  repository: CorpusRepository,
  options: CheckoutOptions,
): Promise<CorpusCheckout> => {
  mkdirSync(options.cacheDirectory, { recursive: true });
  const directoryName = getRepositoryDirectoryName(repository);
  const rootDirectory = join(options.cacheDirectory, directoryName);
  const exists = existsSync(join(rootDirectory, ".git"));
  if (!exists) {
    if (options.offline) throw new Error(`${repository.slug} is not in ${options.cacheDirectory}`);
    await git(
      [
        "clone",
        "--depth",
        "1",
        "--single-branch",
        "--branch",
        repository.defaultBranch,
        "--no-tags",
        getRepositoryUrl(repository),
        rootDirectory,
      ],
      options.cacheDirectory,
    );
  } else if (options.update && !options.offline) {
    await git(["fetch", "--depth", "1", "origin", repository.defaultBranch], rootDirectory);
    await git(["reset", "--hard", "FETCH_HEAD"], rootDirectory);
    await git(["clean", "-fdx", "--exclude=node_modules", "--exclude=.env*"], rootDirectory);
  }
  const commit = (await git(["rev-parse", "HEAD"], rootDirectory)).trim();
  const linkedModules = linkWorkspacePackages(
    rootDirectory,
    join(options.linksDirectory, directoryName),
  );
  return {
    name: repository.slug,
    rootDirectory,
    appDirectory: repository.appDirectory,
    entryFiles: repository.entryFiles,
    framework: repository.framework,
    reactVersion: repository.reactVersion,
    live: repository.live,
    commit,
    moduleDirectories: linkedModules ? [linkedModules] : [],
  };
};

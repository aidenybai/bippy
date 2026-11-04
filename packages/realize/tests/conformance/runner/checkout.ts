import type { RepoConfig } from "./repos";

const CHECKOUT_SCRIPT = [
  "set -euo pipefail",
  "directory=$1 repository=$2 revision=$3 patch_file=$4",
  "shift 4",
  'git init -q "$directory"',
  'cd "$directory"',
  'git remote add origin "$repository"',
  "if [ $# -gt 0 ]; then",
  '  git sparse-checkout set "$@"',
  '  git fetch -q --depth 1 --filter=blob:none origin "$revision"',
  "else",
  '  git fetch -q --depth 1 origin "$revision"',
  "fi",
  "git checkout -q FETCH_HEAD",
  'if [ -n "$patch_file" ]; then git apply --whitespace=nowarn "$patch_file"; fi',
].join("\n");

export const getCheckoutArguments = (
  directory: string,
  source: Pick<RepoConfig, "repository" | "revision" | "patchFile">,
  sparsePaths: string[] = [],
): string[] => [
  "-c",
  CHECKOUT_SCRIPT,
  "checkout",
  directory,
  source.repository,
  source.revision,
  source.patchFile ?? "",
  ...sparsePaths,
];

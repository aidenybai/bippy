import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { readCorpusManifest } from "../../src/corpus/manifest.js";

export interface CorpusRepository {
  repository: string;
  revision: string;
  /** Whole-source checkout; applications only check out utility directories. */
  isLibrary: boolean;
}

const LIBRARY_REVISIONS: Record<string, string> = {
  "angus-c/just": "d8c5dd18941062d8db7e9310ecc8f53fd607df54",
  "blakeembrey/change-case": "9d5505c7e807544a18d98052802985069ac190d0",
  "blakeembrey/pluralize": "1c42761e49f7a78b756841528d99dfbbca8d903c",
  "chalk/ansi-regex": "d0dd70ac3b496aefbf941fa50443ed502a28e3c7",
  "component/escape-html": "b42947eefa79efff01b3fe988c4c7e7b051ec8d8",
  "d3/d3-array": "be0ae0d2b36ab91b833294ad2cfc5d5905acbd0f",
  "d3/d3-color": "71c7f100f9fa85a1c70fcbaeb5f803ee8db5620d",
  "d3/d3-format": "ebdc2d530277df379157f82fee6ea5623d179bd7",
  "d3/d3-interpolate": "2eeffc0d02f2947552cf0a0b73bdf26fe90e1c28",
  "dcastil/tailwind-merge": "7fcb814ea439b749aa18b72415b0e21837811853",
  "developit/mitt": "6b41670516ed8e8b738612f60491995470aa63b3",
  "epoberezkin/fast-deep-equal": "a8e7172b6c411ec320d6045fd4afbd2abc1b4bde",
  "fb55/entities": "95f78fe08d7db1c279de852622e42c99fddb3552",
  "fb55/htmlparser2": "9d40676a8badfea0dff6d3963c1bcadc2ace82e1",
  "jashkenas/underscore": "db2025c3c55b3e0cac2b46dd01ee103d4c9e7b1a",
  "JedWatson/classnames": "abd6314010de053a09df5acc53e474ff65cea470",
  "jonschlinkert/kind-of": "3c7e8fd86094cfdb1b1bd048a39f699161da62e4",
  "juliangarnier/anime": "01b81be1df6843ccfe0a71c0699a746bf740dd77",
  "lodash/lodash": "2b5e6f7399a7b48005140b5d5c6bc6c0e62919a8",
  "lukeed/clsx": "925494cf31bcd97d3337aacd34e659e80cae7fe2",
  "lukeed/dequal": "37c21f675c1f538f2d4b63ebf19a161411e7a5fd",
  "lukeed/dlv": "827954487f2ac84b36672f925a0e57ca7c94dcd3",
  "lukeed/klona": "e563341d88f433e74a9b4c3c0372d4ba55d2f79e",
  "lukeed/regexparam": "d05da2631beb7c5620774dae207cb09c7cbf24cc",
  "markedjs/marked": "ef0704c58459e927c805b92a5cc7d0c629e6fe43",
  "mathiasbynens/esrever": "14b34013dad49106ca08c0e65919f1fc8fea5331",
  "mathiasbynens/he": "36afe179392226cf1b6ccdb16ebbb7a5a844d93a",
  "mathiasbynens/punycode.js": "9e1b2cda98d215d3a73fcbfe93c62e021f4ba768",
  "mesqueeb/is-what": "2848e945baf4e0ab266ffa1a89c6da4490870f91",
  "omgovich/colord": "1404cfe80cf8fe6df1a876ea3b12aa8eccc7feff",
  "pillarjs/path-to-regexp": "7dd6f8f7bd63ae8bffca0968144508228dc61729",
  "planttheidea/fast-equals": "7eee0e9acae634683644976d97b97c109150c3ab",
  "Qix-/color-convert": "5c106a633b5cd2de554d9c287ad31f9eeca7a271",
  "ramda/ramda": "d599a072eb7a2ac6fcb45244646804fa7964eab1",
  "remeda/remeda": "e8292ddf03f8a334cf8b048983d518f89fe6be97",
  "simov/slugify": "8d8c538c53ddf5c1023c8b4769681bb53877746b",
  "sindresorhus/camelcase": "3146708d5ffcd91a8cbc483e4a2585a39545da48",
  "sindresorhus/decamelize": "365e2e909c93c8a5e7c9398523290ba0b35a3a93",
  "sindresorhus/is": "e9c026c611c1160eaad50da00be4e676b626018f",
  "sindresorhus/pretty-bytes": "1d517bb3671b2777dfa501b3415c2a950f767484",
  "sindresorhus/slugify": "3b17b2e84b97624a683aafaa38184bf2746fab22",
  "sodiray/radash": "4cab1900d08e0997abc4f17aec3cbfe18958d766",
  "toss/es-toolkit": "ee72fc74b763d8cb48095e1981a5bcef19ba5cee",
  "validatorjs/validator.js": "9ff342479591ca5a43cb30000195bcf55c1bbed9",
};

const UTILITY_DIRECTORIES = ["utils", "util", "lib", "helpers", "shared", "common"];
const SOURCE_EXTENSIONS = ["ts", "tsx", "js", "mjs", "jsx"];
const APPLICATION_PATTERNS = [
  ...UTILITY_DIRECTORIES.flatMap((directory) =>
    SOURCE_EXTENSIONS.map((extension) => `/**/${directory}/**/*.${extension}`),
  ),
  ...["util", "utils", "helper", "helpers", "format", "string", "math"].flatMap((stem) =>
    SOURCE_EXTENSIONS.map((extension) => `/**/*${stem}*.${extension}`),
  ),
  "!/**/node_modules/**",
];

const MANIFEST_PATH = resolve(import.meta.dirname, "../../corpus/manifest.json");

export const getCorpusRepositories = (): CorpusRepository[] => [
  ...Object.entries(LIBRARY_REVISIONS).map(([repository, revision]) => ({
    repository,
    revision,
    isLibrary: true,
  })),
  ...readCorpusManifest(MANIFEST_PATH).entries.map((entry) => ({
    repository: entry.repository.replace("https://github.com/", ""),
    revision: entry.revision,
    isLibrary: false,
  })),
];

export const getCheckoutDirectory = (corpusDirectory: string, repository: CorpusRepository) =>
  join(corpusDirectory, `${repository.repository.replace("/", "__")}@${repository.revision}`);

const runGit = (directory: string, parameters: string[]): void => {
  execFileSync("git", ["-C", directory, ...parameters], {
    stdio: "ignore",
    timeout: 600_000,
  });
};

/** A shallow, blob-filtered checkout pinned to the revision; null when it cannot be fetched. */
export const ensureCorpusCheckout = (
  corpusDirectory: string,
  repository: CorpusRepository,
): string | null => {
  const directory = getCheckoutDirectory(corpusDirectory, repository);
  const marker = join(directory, ".corpus-complete");
  if (existsSync(marker)) return directory;
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  try {
    runGit(directory, ["init", "--quiet"]);
    runGit(directory, [
      "remote",
      "add",
      "origin",
      `https://github.com/${repository.repository}.git`,
    ]);
    if (!repository.isLibrary)
      runGit(directory, ["sparse-checkout", "set", "--no-cone", ...APPLICATION_PATTERNS]);
    runGit(directory, [
      "fetch",
      "--quiet",
      "--depth",
      "1",
      "--filter=blob:none",
      "origin",
      repository.revision,
    ]);
    runGit(directory, ["checkout", "--quiet", "FETCH_HEAD"]);
    mkdirSync(marker);
    return directory;
  } catch {
    rmSync(directory, { recursive: true, force: true });
    return null;
  }
};

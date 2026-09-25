# Ten-repository module-resolution audit

**New project-facing API:** a [separate audit of `createResolver`](project-audit.md) matched 1,694 of the same 2,299 requests. Invoify’s wrapped configuration is an additional unsupported case. The results below remain the earlier explicit-policy and native-adapter audit; they must not be attributed to the new discovery API.

The audit compares 2,299 literal request occurrences in 579 selected source files. Seven of ten resolver contexts match every observed request. The other contexts retain nine unresolved requests and twelve Rollup external-policy differences. These are not ten passing applications.

[The manifest](manifest.json) pins all ten repository revisions. [Results](results.json) record versions, source hashes, commands, installation attempts and outcomes. [Request records](requests.jsonl) retain every native/core comparison, including failures. Paths inside the containers start with `/project`.

## Measured results

| Repository                     | Installed toolchain                           | Source files | Requests | Matched | Unresolved | Different policy |
| ------------------------------ | --------------------------------------------- | -----------: | -------: | ------: | ---------: | ---------------: |
| nlw-expert-react               | Vite 5.0.12                                   |            4 |       17 |      17 |          0 |                0 |
| ignite-todo                    | Vite 4.5.0                                    |            8 |       21 |      21 |          0 |                0 |
| hariadiarief dashboard starter | Vite 6.0.11                                   |           72 |      299 |     299 |          0 |                0 |
| ecommerce-react                | Vite 3.0.2                                    |          131 |      620 |     620 |          0 |                0 |
| invoify                        | Next 15.3.8 client webpack resolver           |          137 |      584 |     584 |          0 |                0 |
| commerce                       | Next 15.6.0-canary.60 client webpack resolver |           64 |      200 |     198 |          2 |                0 |
| nextjs-saas-starter            | Next 15.6.0-canary.59 client webpack resolver |           38 |      164 |     157 |          7 |                0 |
| zustand-demo                   | Rollup 4.62.4, repository root                |           15 |       18 |       6 |          0 |               12 |
| p-limit                        | Node 26.4.0                                   |            1 |        1 |       1 |          0 |                0 |
| execa                          | Node 26.4.0                                   |          109 |      375 |     375 |          0 |                0 |
| Total                          |                                               |          579 |    2,299 |   2,278 |          9 |               12 |

“Matched” requires a successful native outcome with the same kind and identity. Two unresolved results do not count as a match. “Different policy” counts resolved native results that differ from the core resolver. `zustand-demo` is the historical manifest ID; this run tests Zustand’s repository-root Rollup configuration, not its demo application.

All four Vite production bundles compiled. Zustand’s base ESM bundle also compiled. The Rollup adapter independently returned external `zustand/vanilla` for `./vanilla.ts`, and the emitted bundle imported `zustand/vanilla` and `zustand/react`.

Zustand explains the twelve policy differences. Its build externalizes packages and rewrites internal source imports to package subpaths. The core filesystem resolver does neither. These differences remain in the report rather than becoming a universal alias rule.

Commerce’s two unresolved imports are `path` and `fs/promises` in an Open Graph source file. The SaaS starter includes seven Node builtin requests in the scanned files. Applying a client filesystem resolver to those requests is not correct layer assignment. These failures do not establish that the applications cannot build. The audit deliberately retains them instead of pretending every scanned source belongs in the browser.

The comparison also exposed a core bug. Explicit `builtinModules: false` still allowed fallback builtin classification. The fix respects that option. Native enhanced-resolve comparisons and explicit polyfill aliases cover the regression.

## Native Turbopack compilation

Separate Next CLI runs used each project’s installed version and configuration, with networking disabled:

| Project             | Result                                                                               | Evidence                                           |
| ------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------- |
| commerce            | Compile mode passed                                                                  | [Build log](native-builds/commerce.log)            |
| nextjs-saas-starter | Failed to fetch the Manrope Google Font                                              | [Build log](native-builds/nextjs-saas-starter.log) |
| invoify             | Next 15.3.8 panicked in `dynamic_imports.rs` while writing `/api/invoice/send/route` | [Build log](native-builds/invoify.log)             |

The command was `next build --turbopack --experimental-build-mode compile`. Invoify’s older CLI also received `--no-lint`. The initial attempt used that flag with the canary CLIs too; they rejected it before compilation. The corrected commands did not change project sources or increase deadlines.

These runs do not perform prerendering or application acceptance. Next can execute configuration, build hooks and page-data collection in compile mode. No credentials were supplied. Font download failures and the native panic remain failures; neither was replaced with a stub or an upgraded Next version. Comparisons after compilation found no changes to tracked project files.

The package also has a separate native Next 15.5.18 fixture. It checks emitted markers for React Server Components, browser code and client-side components compiled for server rendering. That fixture proves three selected export branches, not complete Next integration.

## What the audit measures

The collector scans tracked JavaScript and TypeScript under `src`, `app`, `components`, `lib`, `hooks`, `contexts`, `store`, `stores`, `utils`, and `pages`, plus root `index.js`. It excludes declaration files and named test/mock directories and files. It skips 47 explicit type-only import/export statements. It records literal static imports, re-exports, dynamic imports, CommonJS calls and TypeScript external import assignments. No nonliteral calls were recorded in this selection.

This is a syntactic scan, not a reachable dependency graph. It does not prove that a `require` identifier is unshadowed. It does not enumerate CSS, HTML, glob expansion, generated imports, worker requests, or all source directories. TypeScript analysis cannot establish that every retained import survives a toolchain’s transforms.

The references differ by toolchain:

- Vite uses the project’s installed plugin resolver and separately runs its production build. The core comparison transcribes selected filesystem options, not the full plugin pipeline. Regex aliases omitted from that transcription remain listed in the results. Development resolution and production compilation are distinct checks.
- Next loads the installed framework’s real client webpack configuration and configured resolver. It does not infer each source file’s actual server, client or edge layer. The separate CLI runs provide native compilation evidence, not per-edge Turbopack parity.
- Rollup loads Zustand’s upstream base ESM configuration. It probes source requests through that context and generates its bundle. It does not run every output variant, declaration generation or postbuild script.
- Node uses a separate subprocess with native ESM/CommonJS resolution and file-existence checks. It does not execute the packages’ exported functions.

The Vite and webpack adapters delegate to their supplied toolchains. Calling an adapter and its underlying resolver twice would not be independent evidence. Here the comparisons concern core policy versus native outcomes, while explicit-target fixtures and build output checks test adapter behavior separately.

## Isolation and failed attempts

The recorded environment is Node 26.4.0 on Linux arm64, using the image digest in `context.ts`. Installations skip lifecycle scripts. Analysis containers have no network, a read-only root filesystem, dropped capabilities, and no host credentials. Mounts expose the selected project, read-only tooling and that project’s report directory. Projects remain writable for toolchain caches.

Each analysis container has a 2 GiB memory limit, two CPUs and 256 PIDs. The audit test limit is 120 seconds; its container limit is 150 seconds. Native Next compilation has a 120-second container limit. Installation attempts have a 240-second limit.

Initial bind-mounted installs ended with code 137 for eight projects. Named-volume retries completed seven of those projects. Invoify required another installation attempt at the same limit. All ten final audits ran; none was replaced or removed. `results.json` preserves the installation attempts. Initial harness corrections included the Vite+ executable path, older Vite defaults and an unavailable `webpack.init` method. Those setup errors are not counted as resolver successes or toolchain defects.

Every final audit checked tracked bytes against the pinned checkout before and after analysis. All ten source checks passed. Matching imports alone does not establish sandbox security or whole-application compatibility.

## Reproduce

Use Node 26 and Docker. From `packages/bippy-analyzer`, choose a new directory:

```sh
pnpm exec tsx corpus/module-resolution/setup.ts /tmp/bippy-resolver-audit
pnpm exec tsx corpus/module-resolution/install.ts /tmp/bippy-resolver-audit
pnpm exec tsx corpus/module-resolution/run.ts /tmp/bippy-resolver-audit audit
pnpm exec tsx corpus/module-resolution/build-next.ts /tmp/bippy-resolver-audit native-build
```

The setup script fetches exact commits with isolated Git configuration. Installation uses project lockfiles where present. Tooling uses the archived npm lockfile. The two Node projects disable package-lock generation; their compressed installed-tree snapshots record the measured installations, but are not cold-install lockfiles. Their dependency ranges can resolve differently on a later run. [Lock metadata](locks.json) records the uncompressed hashes and distinguishes those snapshots from the tooling lock.

The audit and native-build commands return nonzero when any target fails. The recorded corpus therefore has nonzero audit and build outcomes. Do not turn those into an application pass count. Reports use exclusive run directories; use a new label instead of overwriting evidence. The optional fourth argument selects a recorded installation receipt suffix, as used for the captured retries.

Run resolution before native builds because build tools may generate or change project files. No automatic source repair or network retry runs inside the audit. Remove only the dedicated Docker volumes listed in installation receipts when you no longer need their installed dependencies and build artifacts.

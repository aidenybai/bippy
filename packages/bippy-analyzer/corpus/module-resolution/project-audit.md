# Project resolver audit

The new `createResolver` API matches **1,694 of 2,299 request occurrences** across the same ten pinned repositories. Six selected resolver contexts match completely. This is not universal resolution or application acceptance.

The audit ran against resolver commit `95c4d9ea`, with fresh native comparisons and the existing installed dependencies. It took 30.5 seconds across ten containers. All tracked source checks passed, and every native reference outcome matched the earlier audit. No resolver fixes, per-project overrides, exclusions or deadline increases were applied during this run.

[Results and configuration diagnostics](project-results.json) and [all request comparisons](project-requests.jsonl) preserve the failures independently of the earlier [explicit-policy audit](README.md).

| Repository                     | Matched / requests | Remaining difference                                 |
| ------------------------------ | -----------------: | ---------------------------------------------------- |
| nlw-expert-react               |            17 / 17 | —                                                    |
| ignite-todo                    |            21 / 21 | —                                                    |
| hariadiarief dashboard starter |          299 / 299 | —                                                    |
| ecommerce-react                |          620 / 620 | —                                                    |
| invoify                        |            0 / 584 | Unsupported wrapped Next configuration               |
| commerce                       |          198 / 200 | Two Node builtins under a client reference policy    |
| nextjs-saas-starter            |          157 / 164 | Seven Node builtins under a client reference policy  |
| Zustand repository root        |             6 / 18 | Twelve externalization/subpath-rewriting differences |
| p-limit                        |              1 / 1 | —                                                    |
| execa                          |          375 / 375 | —                                                    |
| **Total**                      |  **1,694 / 2,299** | **605 nonmatches**                                   |

## What failed

**Invoify is a regression from the earlier explicit-policy comparison.** The installed Next resolver still resolves all 584 requests. Its configuration exports `withBundleAnalyzer(withNextIntl(nextConfig))` and includes a webpack callback. The static configuration reader cannot evaluate that wrapper chain, so it rejects the configuration before looking up any request—even otherwise ordinary tsconfig aliases. We did not treat arbitrary wrappers as identity functions or bypass the configuration. Dynamic configuration discovery remains necessary.

**Commerce and the SaaS starter retain a layer-policy mismatch.** The project API identifies nine Node builtins; the native Next client resolver rejects them. Some scanned files are server-side utilities. These results establish neither browser builtin support nor application build failure. Correct source-layer assignment is still missing.

**Zustand retains a build-policy mismatch.** The facade collects its tsconfig but does not discover `rollup.config.mjs`. The actual Rollup configuration externalizes `./vanilla.ts` to `zustand/vanilla` and externalizes packages such as React and Immer. The facade returns source or dependency files instead. Finding an existing file is not the same as reproducing the build’s decision.

All four Vite production bundles and Zustand’s base ESM bundle compiled again. These native builds do not execute applications inside engine262. Next compilation was not repeated in this audit; the earlier compile-mode results remain separate evidence.

## Method and limits

The facade receives only the project root, platform and mode. It discovers its own configuration; the audit does not feed it aliases or other policies extracted from native tools. Import/require is selected for each request. Vite and Next use browser/development contexts; Node and Rollup use node/production source-lookup contexts.

The same scanner retained 579 selected source files and 2,299 literal request occurrences. Existing native Node, Vite, Next client webpack and Rollup comparisons ran inside the network-disabled, resource-limited containers described in the [audit methodology](README.md). Matched failures are not acceptance. Raw IDs remain in the records; Node file URLs are normalized to filesystem paths, retaining query/fragment, only for identity comparison.

The facade reports unexecuted toolchain hooks for all four Vite configurations. Their selected source requests still matched, but this does not validate arbitrary virtual modules or hook-driven aliases. No transitive graph, transforms, browser host, React lifecycle, or engine execution was validated here.

## Reproduce

Use the existing setup/install commands in [the corpus README](README.md). A fresh setup copies the current sources and audit harness. Then select the project implementation with the fifth positional argument:

```sh
pnpm exec tsx corpus/module-resolution/run.ts /tmp/bippy-resolver-audit project-v1 install project
```

The captured run reused the original installed projects and selected receipts, using `install-selected` instead of `install`. Its audit command correctly exited **1**. Use a fresh run label rather than overwriting receipts. `project-results.json` records the actual Docker arguments, source hashes, revisions, versions and distinct discovered configurations.

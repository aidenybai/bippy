# Browser and Node discovery audit

Every one of the same **2,299 import occurrences** now has independent browser and Node outcomes. Discovery found **2,215 in both contexts, 84 only in Node, and none unresolved in both**. These are source-discovery decisions, not application execution results.

The nine Next builtin requests previously tested only against the browser reference are now explicitly classified **Node-only**. Execa contributes another 75 Node-only requests. No browser failure is replaced with a Node result.

[Results and configuration receipts](project-discovery-results.json) and [all request outcomes](project-discovery-requests.jsonl) record `project-discovery-v1` against implementation commit `21115a04`. Earlier [static-only](project-audit.md) and [configuration-execution](project-execution-audit.md) evidence remains intact.

| Repository                     |      Both | Browser-only | Node-only | Neither | Both, different targets |
| ------------------------------ | --------: | -----------: | --------: | ------: | ----------------------: |
| nlw-expert-react               |        17 |            0 |         0 |       0 |                       0 |
| ignite-todo                    |        21 |            0 |         0 |       0 |                       0 |
| hariadiarief dashboard starter |       299 |            0 |         0 |       0 |                      14 |
| ecommerce-react                |       620 |            0 |         0 |       0 |                       1 |
| invoify                        |       584 |            0 |         0 |       0 |                       8 |
| commerce                       |       198 |            0 |         2 |       0 |                       0 |
| nextjs-saas-starter            |       157 |            0 |         7 |       0 |                      17 |
| Zustand repository root        |        18 |            0 |         0 |       0 |                       0 |
| p-limit                        |         1 |            0 |         0 |       0 |                       0 |
| execa                          |       300 |            0 |        75 |       0 |                       3 |
| **Total**                      | **2,215** |        **0** |    **84** |   **0** |                  **43** |

## Why both results matter

For 43 occurrences, both policies resolve but select different files. In Invoify, for example, `@dnd-kit/sortable` selects `dist/sortable.esm.js` under the browser policy and `dist/index.js` under the Next Node-server policy. In the SaaS starter, `lucide-react` selects ESM versus CommonJS files. Execa's `get-stream` selects `source/exports.js` versus `source/index.js`.

`discover()` preserves those identities and returns no preferred execution target. Its classification counts non-unresolved decisions; callers must still inspect each outcome's kind. An ignored module, builtin, virtual module or external reference is not automatically executable source.

A resolver no longer needs a default platform for discovery. Single-context `resolve()` and `getConfiguration()` still require a platform on the constructor or request. Import/require branches remain separate within each platform, and errors remain attached to the context that produced them.

## Native comparisons remain separate

The existing native comparison still measures **2,278/2,299 matches** and exits **1**. Its selected reference contexts are unchanged for comparability; they do not assign an application's source layers. Nine browser builtin rejections remain shared failures in that comparison, while twelve Zustand source lookups still differ from Rollup externalization.

The supplementary native Node checks still match all nine builtin identities and all twelve Zustand source targets. Those checks now use the stored Node discovery outcome rather than making an extra facade lookup.

The additional context for every other occurrence is a discovery result, not a newly established native differential match. No claim of 4,598 native matches is made. Unit tests independently check both conditional-export targets against native esbuild, and installed Next fixtures verify distinct client/server callbacks, caching, and a failure confined to one context.

## Integrity and limits

The scanner still selects 579 files and 2,299 requests. All original native outcomes are unchanged. All tracked-source integrity checks passed, mounted implementation bytes match the recorded hashes, and no configuration errors occurred. Four native Vite bundles and Zustand's base ESM bundle compiled again. Next compilation was not repeated.

The ten isolated containers took 32.9 seconds in total, with no timeouts or deadline changes. Next configuration remains explicitly authorized, bounded, and run inside the existing network-disabled containers. No application plugins or configuration edits were introduced.

Discovery is not a reachable dependency graph or proof of runtime compatibility. It does not assign Next layers, select RSC/SSR/edge policies, implement arbitrary compiler hooks, transform modules, or execute React inside engine262. The [API contract](../../docs/project-resolution.md) retains those boundaries.

## Reproduce

After the existing [setup and install steps](README.md), use a fresh label and the project implementation:

```sh
pnpm exec tsx corpus/module-resolution/run.ts /tmp/bippy-resolver-audit project-discovery install project
```

The captured run used `project-discovery-v1` and reused the selected installed-tree receipts with `install-selected`. Primary native comparison failures still produce a nonzero exit; discovery classifications are reported separately, not used to overwrite that status.

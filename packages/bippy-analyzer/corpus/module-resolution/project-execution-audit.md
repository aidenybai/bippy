# Project resolver: Next configuration execution

Invoify's wrapped configuration previously blocked all 584 requests. With authorized Next configuration execution, **584/584 now match** its installed Next client webpack resolver. The facade now matches **2,278/2,299 requests** across the same ten pinned repositories, up from 1,694 in the [static-only audit](project-audit.md).

Seven contexts match completely. The primary audit still exits **1**: nine requests remain unresolved in browser context, and twelve source lookups differ from Rollup's packaging decisions. Neither category is relabeled as a pass.

[Results, configurations and process receipts](project-execution-results.json) and [all request comparisons](project-execution-requests.jsonl) record run `project-v3`, against resolver commit `03ec6866`. The original audit files remain unchanged.

| Repository                     | Matched / requests | Remaining primary outcome             |
| ------------------------------ | -----------------: | ------------------------------------- |
| nlw-expert-react               |            17 / 17 | —                                     |
| ignite-todo                    |            21 / 21 | —                                     |
| hariadiarief dashboard starter |          299 / 299 | —                                     |
| ecommerce-react                |          620 / 620 | —                                     |
| invoify                        |          584 / 584 | —                                     |
| commerce                       |          198 / 200 | Two shared browser-context failures   |
| nextjs-saas-starter            |          157 / 164 | Seven shared browser-context failures |
| Zustand repository root        |             6 / 18 | Twelve externalization differences    |
| p-limit                        |              1 / 1 | —                                     |
| execa                          |          375 / 375 | —                                     |
| **Total**                      |  **2,278 / 2,299** | **21 nonmatches**                     |

## What changed

**Next configuration executes before lookup.** The facade invokes the project's installed Next loader and materializes its client or Node-server webpack configuration in a bounded child process. Invoify's wrappers and webpack callback run; their resulting filesystem settings feed Oxc. The audit supplies no extracted aliases or project-specific policies. Application entry modules are not compiled or evaluated by this worker.

**Builtins respect the selected platform.** The facade now rejects all nine Node builtin requests under the browser policy, agreeing with the native client resolver's failures. Matching failures are not passes. Separate requests with an explicit Node platform match native Node builtin identities in **9/9 cases**. These checks do not infer which Next layer actually owns a source file, implement RSC/edge contexts, or supply engine262 host APIs.

**Source lookup is checked separately from packaging.** For the twelve Zustand requests that Rollup externalizes, native Node ESM lookup of each original source specifier selects the same physical file as the facade: **12/12 match**. This does not read Rollup configuration in the facade or substitute an installed package for an externalized sibling source. The existing Rollup oracle still runs, and its external identities remain in the primary comparison. A source match is not distribution-build equivalence.

Each of these 21 supplementary checks is stored in its request's `sourceCheck` field, with an explicit scope and both outcomes. They are not added to the primary match count or treated as whole-application acceptance.

## Integrity and execution boundaries

- The scanner retained the same 579 files and 2,299 requests. No requests were excluded or projects replaced.
- All native reference outcomes are identical to the earlier explicit-policy audit, including errors.
- All tracked project bytes remained unchanged. Captured source hashes were checked against the sources mounted into the containers.
- Ten containers took 22.1 seconds in total; none timed out. Existing container/test deadlines were unchanged.
- All four native Vite production bundles and Zustand's base ESM bundle compiled again. Next compilation was not repeated; its earlier offline font failure and native panic remain separate evidence.
- Downloaded configuration ran inside the existing network-disabled, resource-limited containers. No lifecycle scripts, host credentials, application configuration edits, or Bippy application plugins were introduced.

The configuration worker has its own ten-second default deadline, 512 MiB JavaScript heap limit, bounded output, and a fresh environment. Its successful output and warnings are exposed in configuration metadata. A child process alone is **not** a security sandbox; the outer container provides the downloaded-code boundary.

This validates selected **Next webpack filesystem settings**, not Turbopack or complete webpack plugin behavior. Compiler hooks, loaders, externals and framework layers remain outside this policy. Callbacks receive synthetic build metadata. Unsupported resolver plugins fail explicitly; missing optional peers remain unresolved where Next might ignore them. Vite's unexecuted-hook diagnostics also remain visible. See the [API's scope and execution contract](../../docs/project-resolution.md).

## Reproduce

Use the setup/install steps in the [corpus README](README.md), then run the project implementation with a fresh label:

```sh
pnpm exec tsx corpus/module-resolution/run.ts /tmp/bippy-resolver-audit project-execution install project
```

The captured run reused the pinned installed trees and selected installation receipts with `install-selected`, under label `project-v3`. Preserve earlier receipts and use a new label for every rerun. The command's nonzero exit is expected until the primary comparison's unresolved and externalization outcomes are addressed under their own contracts.

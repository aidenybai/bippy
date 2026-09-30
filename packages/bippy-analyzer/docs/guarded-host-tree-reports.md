# Guarded host-tree reports

`createGuardedHostTreeReport()` stores supplied host snapshots under Boolean guards. `specializeGuardedHostTree()` selects observations for an assignment. Neither function executes an application, discovers branches, or establishes branch isolation. Both functions are exported from the package API.

Every report uses scope `guarded-host-tree-observations-v1`. Its `execution` and `coverage` fields remain `not-verified`, including when supplied guards cover all assignments. This is a report component, not the general React analyzer.

## Input and selection

Supply unique observation identifiers, declared Boolean input names, guards, and outcomes. Guards support constants, truthy Boolean inputs, negation, and conjunction. Input paths must be empty. Other domains and undeclared variables reject before a report is returned.

```ts
import { createGuardedHostTreeReport, specializeGuardedHostTree } from "bippy-analyzer";

const report = createGuardedHostTreeReport(
  ["enabled"],
  [
    {
      id: "provided-commit",
      guard: {
        kind: "truthy",
        variable: { input: "enabled", path: [], measure: "value" },
      },
      outcome: {
        kind: "commit",
        snapshot: '{"type":"button","props":{},"children":["Enabled"]}',
      },
    },
  ],
);

const selected = specializeGuardedHostTree(report, new Map([["enabled", true]]));
const missing = specializeGuardedHostTree(report, new Map([["enabled", false]]));
```

`selected` contains the observation identifier and canonical snapshot. `missing` is `{ kind: "uncovered" }`, not an empty commit. Selection requires exactly the declared Boolean inputs and reads each assignment once before testing guards. More than one matching observation returns `ambiguous` with all matching identifiers. Equal snapshots do not resolve ambiguity.

Outcomes distinguish committed output, guest throws, unsupported behavior, incomplete execution, engine failures, and mismatches. Diagnostics retain their message and optional name. The producer must classify diagnostics correctly. A diagnostic that overlaps a commit remains ambiguous rather than disappearing behind the commit.

## Snapshot and identity contract

A commit supplies JSON text in the serialized React Test Renderer host-tree shape. Roots can be null, text, a host element, or an array of host nodes. Elements contain exactly `type`, `props`, and `children`. Props contain JSON data. Children contain host nodes or are null. Invalid shapes, non-finite parsed numbers, and negative zero reject rather than lose information during report serialization.

The builder parses text. It does not traverse guest objects, call a component, or run a guest serializer. Producing the input snapshot is the caller’s responsibility. Guest `JSON.stringify` can invoke getters or `toJSON`; this API does not authorize that operation.

The report stores a content graph with numeric node references. Equal node content shares storage. Child references preserve sibling order and repeated positions. Observation identifiers remain distinct, even when their trees share every node. Guards select entire trees, so selection cannot combine one branch’s label with another branch’s props.

Node identifiers are content references, not fiber, DOM, component, or state identities. Equal output does not establish equal application state. This format does not recover information lost before serialization:

- Callback and symbol-valued props
- Keys, fibers, source locations, and component boundaries
- Object aliases and non-JSON values
- Hidden children omitted by React Test Renderer
- Render attempts, effects, pending work, and transition causes

The builder copies and freezes its output. It sorts observation identifiers and prop keys for deterministic JSON output. It preserves guard structure and declared input order. Valid serialized reports round-trip through JSON and specialize without engine access. This is a typed data contract, not a validator for arbitrary forged report objects. Scope changes require a new version identifier.

## Limits and trust

Defaults are 256 observations, 10,000 distinct nodes, 100,000 visited entries, depth 128, and 1,000,000 snapshot and diagnostic UTF-16 code units. Identifiers contain 1 to 128 UTF-16 code units. Reports allow at most 128 Boolean inputs. You can override the five report limits, but depth cannot exceed 128.

`HostTreeReportError` distinguishes `invalid-input` from `budget-exceeded`. Exhaustion throws without returning a partial report. Repeated content still consumes traversal entries before interning. Selection also bounds node expansion.

These limits are not a sandbox or a bound on all native parsing, allocation, or serialization work. Native metadata, proxies, getters, and ambient built-ins remain trusted. The report builder does not change engine checkpoints or permit host effects.

## Evidence and remaining work

`tests/host-tree-report.test.ts` covers 38 report cases. Four existing opaque-Boolean React specializations now pass their committed host output through the public report API. Each selected snapshot matches the independent native React observation. The opposite assignment remains uncovered. These are separate specialization witnesses, not shared-prefix exploration.

The final tests against the predecessor public exports produce 42 failures and one unchanged module-admission pass. The failures show the missing API, not a newly discovered engine semantic bug. An earlier assertion accepted any throw when the error constructor export was absent. Its ten misleading passes are retained in the validation logs. The final assertions require the report error name and code. An initial formatter parse failure from a missing closing brace is also retained. A changing assignment getter exposed repeated reads during selection. The failing test is retained; selection now copies each Boolean once.

The engine artifact is unchanged. [Validation receipts](host-tree-report-validation/summary.json) record the source hashes and commands. React source inspection used `ReactTestRenderer.js:toJSON` at revision `d083ec1da1e5252abd3ddfdde6dfbc09701a2c51`. That function omits hidden instances and extracts rendered children separately from props. PR #115’s `SymbolicTree` and `SymbolicCommit` informed the guarded-commit representation; no interpreter or hook implementation was copied.

Linux CI at `3b90a652` passes 2,055 units but only 72 of 74 smoke variants. Both numeric `substr` variants exceed the unchanged ten-second timeout. E2E also fails: the native core suite exceeds its 300,000 ms setup timeout. The native job reports 42 failed and 12 passed tests. Publishing succeeds. [Final CI evidence](host-tree-report-validation/ci-status.json) retains the logs and diagnostic profiles. Neither failure is reclassified as a pass.

Branch isolation remains blocked. An engine-owned report producer, component identity and provenance, transitions, repeated families, the demo, and the analysis CLI remain unfinished. See the [completion checklist](symbolic-react-status.md) before treating this report format as a completed analyzer.

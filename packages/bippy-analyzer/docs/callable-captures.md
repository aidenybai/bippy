# Callable constructor captures

The engine’s existing `callable` decorator now declares references held by its native proxy. The original proxy, constructor target, frozen handler, and call trap remain unchanged. No replacement call or construction algorithm is added.

## Reproduced branch leak

A declared native callback retains a callable proxy. Its constructor target or custom call trap retains a mutable counter. The predecessor cannot discover that counter through the proxy. Restoring the Agent continuation leaves the first branch’s increment in place, so the second result is 11 instead of 1 or 10.

The decorator now calls `registerNativeClosure` on function-valued proxies. Its read-only bindings expose `target`, `handler`, and `onCalled`. The existing capture machinery follows their declared captures and restores the counter. Both orders match independent native runs, with one prefix per order. Separate target and trap fixtures prevent either reference from masking the other.

The frozen handler is a plain native record. Declaring `onCalled` separately lets the collector reach the callback without traversing arbitrary native records. Tests verify retained object and symbol targets, then remove the guest root and verify collection. Neither the constructor nor trap runs during collection.

## Boundaries

The manifest reports `[[CallableProxyState]]` as unowned. Declaring these links does not validate or restore arbitrary proxy, target, handler-referent, class, or instance storage. The counter fixture keeps that storage unchanged and supplies trusted declarations for its native callbacks.

Registration does not inspect proxy properties, replace callable identity, change receivers, or change `new.target`. Non-function results keep their original behavior without registration. Arbitrary foreign proxies remain unregistered. The capture registry and its getters remain trusted host machinery, not a sandbox or complete ownership proof.

## Validation

All 17 final cases pass. The exact predecessor fails 16 and passes the foreign-proxy control. Tests cover six actual engine facades, default and custom call behavior, construction, reflection, freezing, exact thrown-object identity, four branch forks, and four collection cases. Twelve independent native observations check branch values and retained values.

The initial 12-case predecessor failures and subsequent 17-case runs remain archived. A message-based exception assertion was replaced with exact identity comparison. The exact final-source predecessor run was then repeated. No intermediate build or type failure occurred.

All 2,017 units across 73 files, types, two relocated builds, offline installation, and the unchanged local 74-case smoke pass. Fresh source conformance passes 623 variants. Input hashes, compiled hashes, and verdicts match reused published weak-reference and `Reflect.construct` reports. Those published reports were not rerun. [Validation receipts](callable-capture-validation/summary.json) contain the reports, hashes, and logs.

Linux CI at `541a7683` passes 2,017 units but only 72 of 74 smoke variants. Both numeric `substr` variants exceed the unchanged ten-second timeout. The engine hash matches the local build. Thirty-second profiles take about 12.8 and 12.9 seconds; they are diagnostics, not gate passes. E2E and publishing succeed. [Final CI evidence](callable-capture-validation/ci-status.json) retains the logs and profiles.

## React ownership remains incomplete

The React diagnostic still selects 2,199 guest objects and rejects its first timer in both orders. Each order has one prefix and no branch tree observation. It intentionally ignores class and proxy ownership warnings while exercising the host-effect guard.

Discovery now finds 2,819 native functions, with 2,798 registered and 21 unregistered. The predecessor diagnostic found 2,749, with 2,734 registered and 15 unregistered. Following callable targets resolves seven facade entries but exposes further decimal-library functions and the capture-registry function. More discovery is not complete ownership, and an unregistered count need not decrease.

The patch preserves the existing decorator used by engine implementations. It does not implement guest Proxy snapshots, general React isolation, guarded trees, transitions, or repeated-state families.

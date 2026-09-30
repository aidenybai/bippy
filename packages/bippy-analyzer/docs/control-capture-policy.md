# Private control discovery policies

Control discovery now has a private policy entry point for the future automatic execution owner. It can distinguish explicit native-capture expansion from deliberately opaque inspection. It does not implement that owner or admit any engine implementation by default.

## Explicit inspection

`engine/extensions/execution-machine.mts` exports `captureControlWithPolicy` for internal module consumers. The engine’s public index does not export it. Production Agent checkpoints still use the existing `captureControl(owner)` contract through the shared discovery routine. The strict entry point currently has standalone lowered-control consumers in tests, not a production automatic-owner caller.

A policy supplies `inspect(value)` for every discovered non-control object:

- `{ mode: "expand", references }` follows explicit references and the original native capture manifest.
- `{ mode: "opaque", references }` follows explicit references without calling `getNativeCaptures` on that object through this discovery path.
- An absent inspection or unknown mode throws `Unclassified control dependency` before direct metadata expansion.
- Either valid mode must provide references. Missing references throw `Control capture policies require explicit references`.

Modes and reference lists are read once. An invalid mode does not read the reference list. References retain the original iteration order and enter the live root list as they are yielded. Discovery processes descendants in the original last-in-first-out order and deduplicates identities, including cycles. Opacity does not admit descendants.

Observed ambient names require `admitAmbient(name)` to return literal `true`. Without approval, capture throws `Unclassified control ambient: ${name}` before calling the policy’s `capture`. This applies to control manifests and expanded native manifests. Opaque declarations do not expose their manifest’s ambient names through this path; their policy must account for those capabilities separately.

The original control-frame, capture-lock, binding restoration, failure poisoning, and callback-receiver protocols remain in use. Inspection, reference iteration, ambient approval, and capture failures preserve the thrown value. They release the capture lock but do not roll back trusted hook effects or clean up owner-created resources.

## Compatibility and limits

The public owner contract is unchanged. Missing `references`, or a returned nullish value, still means an empty list followed by native metadata expansion. It does not acquire strict rejection or opaque semantics. Existing Agent guards and checkpoint cleanup remain unchanged.

An opaque declaration is a trusted policy decision, not proof of immutability, source provenance, allocation identity, or execution ownership. The policy assumes responsibility for omitted capture cells, referents, native storage, ambient capabilities, and effects. No compiler source label automatically permits opacity.

The policy only controls direct discovery. It does not suppress collector metadata access, direct `getNativeCaptures`, control-frame capture factories, restore callbacks, or future calls. It is not whole-graph preflight, a write barrier, a host-effect permission, or a sandbox. Reflection, metadata, and policy callbacks remain trusted. No new work or allocation budget is added.

A negative control declares a callback opaque and omits its native counter. The counter reaches two after restoration. Direct `getNativeCaptures` still invokes its factory. Explicit decisions therefore do not justify changing execution or coverage reports to verified.

## Evidence

Twenty-seven tests cover rejection, mode/reference getter counts, callback receivers, expansion, opaque dependencies, cycles, reference order, live-root timing, exact failures, recovery, ambient approval, and restoration poisoning. Both native branch orders preserve one prefix and return 11/12 after a supplied owner restores its selected callback state. Another fixture verifies that expanded captured bindings still restore through the original control mechanism. These are lowered native-control fixtures, not automatic engine262 Script or React forks.

The same final tests against predecessor `81baae20` produce 25 absent-internal-export failures and two existing controls. They do not establish 25 semantic fixes. The initial TS18048 narrowing error, stale-build test failures, and embedded-fixture syntax error remain in the receipt. Read-only review found no critical issues or warnings. Its suggested opaque-descendant and ambient-failure cases were added.

Final local checks pass 70 focused cases, 2,469 units across 102 files, types, two relocated builds, offline installation, and the root check. The unchanged 74-case smoke passes. Fresh WeakRef/yield conformance passes 181 variants in each engine with matching input, compiled, and verdict hashes. Unit/Test262 timeouts remain five/ten seconds, with two Test262 workers and a ten-minute CI job limit. See the [validation receipt](control-capture-policy-validation/summary.json).

Predecessor CI36764608658 fails its analyzer smoke gate: 2,442 units pass, but both numeric-substr variants exceed ten seconds. The smoke result is 72/74. E2E36764608708 and publish36764608675 pass. One-worker, thirty-second diagnostics take 12.864/13.104 seconds; they do not change the failed gate verdict.

## Remaining production work

The automatic owner must supply audited implementation contracts and original Agent/Realm/Script/environment/context storage policies. It must own completion notification effects or use a separately defined engine-owned notification protocol. Unknown capabilities must reject before branch effects; a source-module allowlist is insufficient.

The exact aliased-closure Script still lacks accepted automatic branches. General shared-prefix React isolation, automatic reports, transitions, repeated families, and the integrated demo remain incomplete. React’s `mountRef` and bound state dispatch retain mutable guest graphs; these policy decisions do not own them.

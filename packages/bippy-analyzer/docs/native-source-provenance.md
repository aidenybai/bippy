# Native source provenance

`getNativeSourceModule(closure)` distinguishes compiler-issued native capture metadata from public capture declarations. It returns a normalized module label or `undefined`. This is an input to future ownership admission, not proof that a function’s state or effects are owned.

Public `registerNativeClosure` can replace a capture declaration. Treating any registered function as engine-owned would let a caller supply an empty declaration for arbitrary code. Source provenance therefore uses a separate compiler registration path and is revoked by public re-registration.

## Build and runtime boundary

The production builder passes normalized module names when lowering maintained engine source. The capture transform then uses `registerEngineClosure` instead of public registration. This helper is internal to the bundled capture module and is not exported by the engine API. Registration keeps the original function identity, prototype, name, and own properties.

The private capture carrier stores the source label beside the capture factory. `getNativeSourceModule` reads that private field without calling the factory or any captured getter. A query can succeed before a captured lexical binding is initialized. Reading that binding still throws the original `ReferenceError`.

Labels describe maintained source modules, including patches, rather than unchanged upstream source text. They use names such as `engine262/src/intrinsics/FunctionPrototype.mts`, not temporary build paths. Relocated builds produce identical engine bytes.

The build pipeline is trusted. Standalone compiler calls can explicitly supply labels for their own bundles. A label is not a signature or a sandbox boundary. The private carrier class belongs to one runtime instance, so another bundle’s labels do not register its functions in this engine.

## Replacement and unsupported forms

Public `registerNativeClosure` always clears source provenance, even when the function previously had a compiler label. Capture replacement remains supported for discovery and GC. It does not transfer the compiler label to replacement metadata.

These operations do not mint or forward a label:

- adding a `sourceModule` property;
- supplying an extra argument to public registration;
- copying a labeled function’s own descriptors;
- wrapping it in a native Proxy or binding it with native `bind`;
- registering a function in a different bundle.

Queries do not invoke Proxy traps, including on revoked callable proxies. Unregistered values return `undefined`. Functions excluded from capture transformation, unsupported naming forms, and publicly replaced declarations can also lack labels. Absence does not prove that code came from outside the engine.

The existing control support module remains excluded from source transformation. The new label adds no GC edge and does not change capture traversal, binding restoration, or collector rules.

## Ownership still required

A labeled function can still reference mutable storage, ambient capabilities, native classes, proxies, and unsupported records. Its own properties can change without removing its label. Tests deliberately retain a label after attaching an unowned mutable record. Class manifests still report `[[ClassState]]` as unowned.

The rejecting execution owner still needs these contracts:

- storage schemas that enumerate outgoing dependencies and restore original records;
- validated read-only dependencies and explicit ambient capabilities;
- private admission checks before generic capture expansion;
- rejection of unsupported future calls, allocations, and effects.

A source label cannot replace any of them. No ownership classifier, branch permission, capture-completeness certificate, or automatic React owner is added. Host-effect guards remain enabled.

## Evidence

`native-source-provenance.test.ts` checks thirteen cases. They cover the private/public boundary, replacement, spoofing, proxy/bind/descriptor copying, foreign bundles, callable forms, lexical initialization, and nested generator restoration. A parent factory’s manifest retains its existing self-binding but does not expose the injected private registrar.

`native-source-react.test.ts` uses actual React state dispatch. The guest bound function has no native source label. Its original engine `Call` implementation has the FunctionPrototype module label. Mount, increment, and unmount snapshots match an independent native React run. Dispatch identity remains stable. This is concrete compatibility evidence, not shared-prefix React isolation.

The [validation receipts](native-source-provenance-validation/summary.json) retain fourteen predecessor failures caused by absent provenance API/exports. These are missing-feature baselines, not fourteen engine semantic regressions. An initial class-marker assertion incorrectly searched bindings instead of ambient names. Another expected an empty parent manifest instead of its existing self-binding. Both failed assertions remain archived.

Final checks include 94 focused cases, 2,323 unit tests across 93 files, and 202 fresh matching source/published bind and class-TDZ variants. Concrete conformance does not verify execution ownership. General React isolation, automatic reports, guarded transitions, repeated-state families, and demo integration remain incomplete.

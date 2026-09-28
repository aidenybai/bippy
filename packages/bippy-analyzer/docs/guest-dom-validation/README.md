# Guest DOM setup records

These are retained failures, not accepted parity results. The records preserve the original diagnostics and machine paths. The out-of-memory record encodes the log as a JSON string with its SHA-256, preserving trailing whitespace.

- `initial-load.txt`: both DOM tests failed before rendering. The separate React Test Renderer selection passed.
- `diagnostic-oom.json`: the production guest load reported missing `String.prototype.substr`. Formatting the retained engine value then exhausted the test process heap.
- `missing-location.txt`: after adding the intrinsic and safe diagnostic serialization, production passed. Development failed in both V8 and engine262 because the fixture lacked location data.

The final fixture declares fixed location data and records `console.info`. It runs LinkeDOM inside engine262 and V8. A separate Chromium run uses the same component with the browser's DOM. Both production and development counter sequences pass. The [concrete execution contract](../concrete-execution.md#react-dom-counter) states the selection and remaining limits.

`ConcreteGuestError.value` still retains the original engine value. It is non-enumerable and excluded from `toJSON()`. Diagnostic output uses scalar metadata, including engine-created error strings and stacks. It does not inspect the guest object through getters or string coercion.

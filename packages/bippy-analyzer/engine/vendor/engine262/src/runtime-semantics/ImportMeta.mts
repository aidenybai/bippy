import { HostGetImportMetaProperties, HostFinalizeImportMeta } from '../host-defined/engine.mts';
import { ObjectValue, Value } from '../value.mts';
import { X } from '../completion.mts';
import { SourceTextModuleRecord } from '../modules.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import {
  Assert,
  GetActiveScriptOrModule,
  OrdinaryObjectCreate,
  CreateDataPropertyOrThrow,
} from '#self';

/** https://tc39.es/ecma262/#sec-meta-properties */
//   ImportMeta : `import` `.` `meta`
export function Evaluate_ImportMeta(_ImportMeta: ParseNode.ImportMeta) {
  // 1. Let module be ! GetActiveScriptOrModule().
  const module = X(GetActiveScriptOrModule());
  // 2. Assert: module is a Source Text Module Record.
  Assert(module instanceof SourceTextModuleRecord);
  // 3. Let importMeta be module.[[ImportMeta]].
  let importMeta = module.ImportMeta;
  // 4. If importMeta is empty, then
  if (importMeta === undefined) {
    // a. Set importMeta to ! OrdinaryObjectCreate(null).
    importMeta = X(OrdinaryObjectCreate(Value.null));
    // b. Let importMetaValues be ! HostGetImportMetaProperties(module).
    const importMetaValues = X(HostGetImportMetaProperties(module));
    // c. For each Record { [[Key]], [[Value]] } p that is an element of importMetaValues, do
    for (const p of importMetaValues) {
      // i. Perform ! CreateDataPropertyOrThrow(importMeta, p.[[Key]], p.[[Value]]).
      X(CreateDataPropertyOrThrow(importMeta, p.Key, p.Value));
    }
    // d. Perform ! HostFinalizeImportMeta(importMeta, module).
    X(HostFinalizeImportMeta(importMeta, module));
    // e. Set module.[[ImportMeta]] to importMeta.
    module.ImportMeta = importMeta;
    // f. Return importMeta.
    return importMeta;
  } else { // 5. Else,
    // a. Assert: Type(importMeta) is Object.
    Assert(importMeta instanceof ObjectValue);
    // b. Return importMeta.
    return importMeta;
  }
}

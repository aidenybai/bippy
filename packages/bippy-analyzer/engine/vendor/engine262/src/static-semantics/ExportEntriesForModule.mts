import { Value } from '../value.mts';
import { OutOfRange, isArray } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { ImportedNames, StringValue, type ExportEntry, type ModuleRequestRecord } from './all.mts';

export function ExportEntriesForModule(node: ParseNode | readonly ParseNode[], module: ModuleRequestRecord | null): ExportEntry[] {
  if (isArray(node)) {
    const specs: ExportEntry[] = [];
    node.forEach((n) => {
      specs.push(...ExportEntriesForModule(n, module));
    });
    return specs;
  }
  switch (node.type) {
    case 'ExportFromClause':
      if (node.ModuleExportName) {
        // 1. Let exportName be the StringValue of ModuleExportName.
        const exportName = StringValue(node.ModuleExportName);
        // 2. Let entry be the ExportEntry Record { [[ModuleRequest]]: module, [[ImportName]]: ~namespace~, [[LocalName]]: null, [[ExportName]]: exportName, [[NamespaceNamesFilter]]: empty }.
        //    (proposal-deferred-reexports renamed ~all~ to ~namespace~ for star-as exports.)
        const entry: ExportEntry = {
          ModuleRequest: module,
          ImportName: 'namespace',
          LocalName: null,
          ExportName: exportName,
          NamespaceNamesFilter: [],
        };
        // 3. Return a new List containing entry.
        return [entry];
      } else {
        // 1. Let entry be the ExportEntry Record { [[ModuleRequest]]: module, [[ImportName]]: ~all-but-default~, [[LocalName]]: null, [[ExportName]]: null, [[NamespaceNamesFilter]]: empty }.
        const entry: ExportEntry = {
          ModuleRequest: module,
          ImportName: 'all-but-default',
          LocalName: null,
          ExportName: null,
          NamespaceNamesFilter: [],
        };
        // 2. Return a new List containing entry.
        return [entry];
      }
    case 'ExportSpecifier': {
      const sourceName = StringValue(node.localName);
      const exportName = StringValue(node.exportName);
      let localName: string | null;
      let importName: string | null;
      if (module === null) {
        localName = sourceName;
        importName = null;
      } else { // 4. Else,
        localName = null;
        importName = sourceName;
      }
      return [{
        ModuleRequest: module,
        ImportName: importName === null ? null : Value(importName),
        LocalName: localName,
        ExportName: exportName,
        NamespaceNamesFilter: [],
      }];
    }
    case 'NamedExports':
      if (node.NamespaceExportName) {
        const exportName = StringValue(node.NamespaceExportName);
        const importedNames = ImportedNames(node);
        const entry: ExportEntry = {
          ModuleRequest: module,
          ImportName: 'filtered-namespace',
          LocalName: null,
          ExportName: exportName,
          NamespaceNamesFilter: importedNames,
        };
        return [entry];
      }
      return ExportEntriesForModule(node.ExportsList, module);
    default:
      throw OutOfRange.nonExhaustive(node);
  }
}

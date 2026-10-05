import { Value } from '../value.mts';
import { OutOfRange } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import {
  BoundNames, ImportedNames, StringValue, type ImportEntry, type ModuleRequestRecord,
} from './all.mts';

export function ImportEntriesForModule(node: ParseNode, module: ModuleRequestRecord): ImportEntry[] {
  switch (node.type) {
    case 'ImportClause':
      switch (true) {
        case !!node.ImportedDefaultBinding && !!node.NameSpaceImport: {
          // 1. Let entries be ImportEntriesForModule of ImportedDefaultBinding with argument module.
          const entries = ImportEntriesForModule(node.ImportedDefaultBinding, module);
          // 2. Append to entries the elements of the ImportEntriesForModule of NameSpaceImport with argument module.
          entries.push(...ImportEntriesForModule(node.NameSpaceImport, module));
          // 3. Return entries.
          return entries;
        }
        case !!node.ImportedDefaultBinding && !!node.NamedImports: {
          // 1. Let entries be ImportEntriesForModule of ImportedDefaultBinding with argument module.
          const entries = ImportEntriesForModule(node.ImportedDefaultBinding, module);
          // 2. Append to entries the elements of the ImportEntriesForModule of NamedImports with argument module.
          entries.push(...ImportEntriesForModule(node.NamedImports, module));
          // 3. Return entries.
          return entries;
        }
        case !!node.ImportedDefaultBinding:
          return ImportEntriesForModule(node.ImportedDefaultBinding, module);
        case !!node.NameSpaceImport:
          return ImportEntriesForModule(node.NameSpaceImport, module);
        case !!node.NamedImports:
          return ImportEntriesForModule(node.NamedImports, module);
        default:
          throw OutOfRange.nonExhaustive(node);
      }
    case 'ImportedDefaultBinding': {
      // 1. Let localName be the sole element of BoundNames of ImportedBinding.
      const localName = BoundNames(node.ImportedBinding)[0];
      // 2. Let defaultEntry be the ImportEntry Record { [[ModuleRequest]]: module, [[ImportName]]: "default", [[LocalName]]: localName }.
      const defaultEntry: ImportEntry = {
        ModuleRequest: module,
        ImportName: Value('default'),
        LocalName: localName,
      };
      // 3. Return a new List containing defaultEntry.
      return [defaultEntry];
    }
    case 'NameSpaceImport': {
      // 1. Let localName be the StringValue of ImportedBinding.
      const localName = StringValue(node.ImportedBinding);
      if (node.NamedImports) {
        const importedNames = ImportedNames(node.NamedImports);
        const entry: ImportEntry = {
          ModuleRequest: module,
          ImportName: 'filtered-namespace-object',
          LocalName: localName,
          NamespaceNamesFilter: importedNames,
        };
        return [entry];
      }
      // 2. Let entry be the ImportEntry Record { [[ModuleRequest]]: module, [[ImportName]]: ~namespace~, [[LocalName]]: localName, [[NamespaceNamesFilter]]: empty }.
      const entry: ImportEntry = {
        ModuleRequest: module,
        ImportName: 'namespace',
        LocalName: localName,
        NamespaceNamesFilter: [],
      };
      // 3. Return a new List containing entry.
      return [entry];
    }
    case 'NamedImports': {
      const specs: ImportEntry[] = [];
      node.ImportsList.forEach((n) => {
        specs.push(...ImportEntriesForModule(n, module));
      });
      return specs;
    }
    case 'ImportSpecifier':
      if (node.ModuleExportName) {
        // 1. Let importName be the StringValue of ModuleExportName.
        const importName = StringValue(node.ModuleExportName);
        // 2. Let localName be the StringValue of ImportedBinding.
        const localName = StringValue(node.ImportedBinding);
        // 3. Let entry be the ImportEntry Record { [[ModuleRequest]]: module, [[ImportName]]: importName, [[LocalName]]: localName }.
        const entry: ImportEntry = {
          ModuleRequest: module,
          ImportName: Value(importName),
          LocalName: localName,
          NamespaceNamesFilter: [],
        };
        // 4. Return a new List containing entry.
        return [entry];
      } else {
        // 1. Let localName be the sole element of BoundNames of ImportedBinding.
        const localName = BoundNames(node.ImportedBinding)[0];
        // 2. Let entry be the ImportEntry Record { [[ModuleRequest]]: module, [[ImportName]]: localName, [[LocalName]]: localName }.
        const entry: ImportEntry = {
          ModuleRequest: module,
          ImportName: Value(localName),
          LocalName: localName,
          NamespaceNamesFilter: [],
        };
        // 3. Return a new List containing entry.
        return [entry];
      }
    default:
      throw OutOfRange.nonExhaustive(node);
  }
}

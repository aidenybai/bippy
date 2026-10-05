import type { ParseNode } from '../parser/ParseNode.mts';
import { OutOfRange, isArray, type Mutable } from '../utils/language.mts';
import { StringValue } from './all.mts';
import { MergeImportedNames, type LoadedModuleRequestRecord } from '#self';

// https://tc39.es/proposal-deferred-reexports/
export type ImportedNamesValue = 'all' | 'all-but-default' | readonly string[];

// https://tc39.es/ecma262/#modulerequest-record
export interface ModuleRequestRecord {
  readonly Specifier: string;
  readonly Attributes: readonly ImportAttributeRecord[];
  readonly Phase: 'source' | 'defer' | 'evaluation';
  readonly ImportedNames: ImportedNamesValue;
}

// https://tc39.es/ecma262/#importattribute-record
export interface ImportAttributeRecord {
  readonly Key: string;
  readonly Value: string;
}

/** https://tc39.es/proposal-defer-import-eval/#sec-ModuleRequestsKeyEqual */
export function ModuleRequestsKeyEqual(left: ModuleRequestRecord | LoadedModuleRequestRecord, right: ModuleRequestRecord | LoadedModuleRequestRecord) {
  // 1. If left.[[Specifier]] is not right.[[Specifier]], return false.
  if (left.Specifier !== right.Specifier) {
    return false;
  }
  // 2. Let leftAttrs be left.[[Attributes]].
  const leftAttrs = left.Attributes;
  // 3. Let rightAttrs be right.[[Attributes]].
  const rightAttrs = right.Attributes;
  // 4. Let leftAttrsCount be the number of elements in leftAttrs.
  const leftAttrsCount = leftAttrs.length;
  // 5. Let rightAttrsCount be the number of elements in rightAttrs.
  const rightAttrsCount = rightAttrs.length;
  // 6. If leftAttrsCount ≠ rightAttrsCount, return false.
  if (leftAttrsCount !== rightAttrsCount) {
    return false;
  }
  // 7. For each ImportAttribute Record l of leftAttrs, do
  for (const l of leftAttrs) {
    // a. If rightAttrs does not contain an ImportAttribute Record r such that l.[[Key]] is r.[[Key]] and l.[[Value]] is r.[[Value]], return false.
    if (!rightAttrs.some((r) => l.Key === r.Key && l.Value === r.Value)) {
      return false;
    }
  }
  // 8. Return true.
  return true;
}

// https://tc39.es/ecma262/#sec-withclausetoattributes
function WithClauseToAttributes(node: ParseNode.WithClause): ImportAttributeRecord[] {
  const attributes: ImportAttributeRecord[] = [];
  for (const attribute of node.WithEntries) {
    attributes.push({
      Key: StringValue(attribute.AttributeKey),
      Value: StringValue(attribute.AttributeValue),
    });
  }
  attributes.sort((a, b) => (a.Key < b.Key ? -1 : 1));
  return attributes;
}

/** https://tc39.es/proposal-deferred-reexports/#sec-ImportedNames */
export function ImportedNames(node: ParseNode.NamedImports | ParseNode.NamedExports): readonly string[];
export function ImportedNames(node: ParseNode | readonly ParseNode[]): ImportedNamesValue;
export function ImportedNames(node: ParseNode | readonly ParseNode[]): ImportedNamesValue {
  if (isArray(node)) {
    let importedNames: ImportedNamesValue = [];
    for (const item of node) {
      const additionalImportedNames = ImportedNames(item);
      importedNames = MergeImportedNames(importedNames, additionalImportedNames);
    }
    return importedNames;
  }
  switch (node.type) {
    case 'ImportClause':
      if (node.ImportedDefaultBinding && node.NameSpaceImport) {
        const names1 = ImportedNames(node.ImportedDefaultBinding);
        const names2 = ImportedNames(node.NameSpaceImport);
        return MergeImportedNames(names1, names2);
      }
      if (node.ImportedDefaultBinding && node.NamedImports) {
        const names1 = ImportedNames(node.ImportedDefaultBinding);
        const names2 = ImportedNames(node.NamedImports);
        return MergeImportedNames(names1, names2);
      }
      if (node.ImportedDefaultBinding) {
        return ImportedNames(node.ImportedDefaultBinding);
      }
      if (node.NameSpaceImport) {
        return ImportedNames(node.NameSpaceImport);
      }
      if (node.NamedImports) {
        return ImportedNames(node.NamedImports);
      }
      throw OutOfRange.nonExhaustive(node);
    case 'ImportedDefaultBinding':
      return ['default'];
    case 'NameSpaceImport':
      if (node.NamedImports) {
        return ImportedNames(node.NamedImports);
      }
      return 'all';
    case 'NamedImports':
      return ImportedNames(node.ImportsList);
    case 'ImportSpecifier':
      return [StringValue(node.ModuleExportName ?? node.ImportedBinding)];
    case 'ExportFromClause':
      if (node.ModuleExportName) {
        return 'all';
      }
      return 'all-but-default';
    case 'NamedExports':
      return ImportedNames(node.ExportsList);
    case 'ExportSpecifier':
      return [StringValue(node.localName)];
    default:
      throw OutOfRange.nonExhaustive(node);
  }
}

/** https://tc39.es/proposal-deferred-reexports/#sec-ExportFromDeclarationModuleRequest */
export function ExportFromDeclarationModuleRequest(node: ParseNode.ExportDeclaration_NamedFrom): ModuleRequestRecord {
  const importedNames = ImportedNames(node.ExportFromClause);
  const specifier = StringValue(node.FromClause);
  const attributes = node.WithClause ? WithClauseToAttributes(node.WithClause) : [];
  return {
    Specifier: specifier, Attributes: attributes, Phase: 'evaluation', ImportedNames: importedNames,
  };
}

export function ModuleRequests(node: ParseNode): ModuleRequestRecord[] {
  switch (node.type) {
    case 'Module':
      if (node.ModuleBody) {
        return ModuleRequests(node.ModuleBody);
      }
      return [];
    case 'ModuleBody': {
      const requests: ModuleRequestRecord[] = [];
      for (const item of node.ModuleItemList) {
        const additionalRequests = ModuleRequests(item);
        for (const mr of additionalRequests) {
          const existing = requests.find((r) => ModuleRequestsKeyEqual(r, mr) && r.Phase === mr.Phase);
          if (existing) {
            (existing as Mutable<ModuleRequestRecord>).ImportedNames = MergeImportedNames(existing.ImportedNames, mr.ImportedNames);
          } else {
            requests.push(mr);
          }
        }
      }
      return requests;
    }
    case 'ImportDeclaration': {
      let specifier: string;
      if (node.FromClause) {
        specifier = StringValue(node.FromClause);
      } else if (node.ModuleSpecifier) {
        specifier = StringValue(node.ModuleSpecifier);
      } else {
        throw new Error('Unreachable: all imports must have either an ImportClause or a ModuleSpecifier');
      }
      const importedNames = node.ImportClause ? ImportedNames(node.ImportClause) : [];
      const attributes = node.WithClause ? WithClauseToAttributes(node.WithClause) : [];
      return [{
        Specifier: specifier, Attributes: attributes, Phase: node.Phase, ImportedNames: importedNames,
      }];
    }
    case 'ExportDeclaration':
      if (node.FromClause) {
        const fromNode = node as ParseNode.ExportDeclaration_NamedFrom;
        // `export defer ... from "m"` is tracked via [[OptionalIndirectExportEntries]]
        if (fromNode.Phase === 'defer') {
          return [];
        }
        return [ExportFromDeclarationModuleRequest(fromNode)];
      }
      return [];
    default:
      return [];
  }
}

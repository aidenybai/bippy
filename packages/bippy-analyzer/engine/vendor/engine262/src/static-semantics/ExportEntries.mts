import { JSStringValue } from '../value.mts';
import { OutOfRange, isArray } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import {
  BoundNames, ExportFromDeclarationModuleRequest, ExportEntriesForModule, type ModuleRequestRecord,
} from './all.mts';

export function ExportEntries(node: ParseNode | readonly ParseNode[]): ExportEntry[] {
  if (isArray(node)) {
    const entries: ExportEntry[] = [];
    node.forEach((n) => {
      entries.push(...ExportEntries(n));
    });
    return entries;
  }
  switch (node.type) {
    case 'Module':
      if (!node.ModuleBody) {
        return [];
      }
      return ExportEntries(node.ModuleBody);
    case 'ModuleBody':
      return ExportEntries(node.ModuleItemList);
    case 'ExportDeclaration':
      switch (true) {
        case !!node.ExportFromClause && !!node.FromClause: {
          const fromNode = node as ParseNode.ExportDeclaration_NamedFrom;
          // ExportDeclaration : `export` `defer` ExportFromClause FromClause WithClause? `;`
          // 1. Return a new empty List.
          // (https://tc39.es/proposal-deferred-reexports/#sec-static-semantics-exportentries)
          // The corresponding entries are produced by OptionalIndirectExportEntries instead.
          if (fromNode.Phase === 'defer') {
            return [];
          }
          // ExportDeclaration : `export` ExportFromClause FromClause WithClause? `;`
          // 1. Let module be the sole element of ModuleRequests of FromClause.
          // 2. Return ExportEntriesForModule of ExportFromClause with argument module.
          const module = ExportFromDeclarationModuleRequest(fromNode);
          return ExportEntriesForModule(fromNode.ExportFromClause, module);
        }
        case !!node.NamedExports: {
          // `export` NamedExports `;`
          // 1. Return ExportEntriesForModule(NamedExports, null).
          return ExportEntriesForModule(node.NamedExports, null);
        }
        case !!node.VariableStatement: {
          // `export` VariableStatement
          // 1. Let entries be a new empty List.
          const entries: ExportEntry[] = [];
          // 2. Let names be the BoundNames of VariableStatement.
          const names = BoundNames(node.VariableStatement);
          // 3. For each name in names, do
          for (const name of names) {
            // a. Append the ExportEntry Record { [[ModuleRequest]]: null, [[ImportName]]: null, [[LocalName]]: name, [[ExportName]]: name } to entries.
            entries.push({
              ModuleRequest: null,
              ImportName: null,
              LocalName: name,
              ExportName: name,
            });
          }
          // 4. Return entries.
          return entries;
        }
        case !!node.Declaration: {
          // `export` Declaration
          // 1. Let entries be a new empty List.
          const entries: ExportEntry[] = [];
          // 2. Let names be the BoundNames of Declaration.
          const names = BoundNames(node.Declaration);
          // 3. For each name in names, do
          for (const name of names) {
            // a. Append the ExportEntry Record { [[ModuleRequest]]: null, [[ImportName]]: null, [[LocalName]]: name, [[ExportName]]: name } to entries.
            entries.push({
              ModuleRequest: null,
              ImportName: null,
              LocalName: name,
              ExportName: name,
            });
          }
          // 4. Return entries.
          return entries;
        }
        case node.default && !!node.HoistableDeclaration: {
          // `export` `default` HoistableDeclaration
          // 1. Let names be BoundNames of HoistableDeclaration.
          const names = BoundNames(node.HoistableDeclaration);
          // 2. Let localName be the sole element of names.
          const localName = names[0];
          // 3. Return a new List containing the ExportEntry Record { [[ModuleRequest]]: null, [[ImportName]]: null, [[LocalName]]: localName, [[ExportName]]: "default" }.
          return [{
            ModuleRequest: null,
            ImportName: null,
            LocalName: localName,
            ExportName: 'default',
          } satisfies ExportEntry];
        }
        case node.default && !!node.ClassDeclaration: {
          // `export` `default` ClassDeclaration
          // 1. Let names be BoundNames of ClassDeclaration.
          const names = BoundNames(node.ClassDeclaration);
          // 2. Let localName be the sole element of names.
          const localName = names[0];
          // 3. Return a new List containing the ExportEntry Record { [[ModuleRequest]]: null, [[ImportName]]: null, [[LocalName]]: localName, [[ExportName]]: "default" }.
          return [{
            ModuleRequest: null,
            ImportName: null,
            LocalName: localName,
            ExportName: 'default',
          } satisfies ExportEntry];
        }
        case node.default && !!node.AssignmentExpression: {
          // `export` `default` AssignmentExpression `;`
          // 1. Let entry be the ExportEntry Record { [[ModuleRequest]]: null, [[ImportName]]: null, [[LocalName]]: "*default*", [[ExportName]]: "default" }.
          const entry: ExportEntry = {
            ModuleRequest: null,
            ImportName: null,
            LocalName: '*default*',
            ExportName: 'default',
          };
          // 2. Return a new List containing entry.
          return [entry];
        }
        default:
          throw OutOfRange.exhaustive(node);
      }
    default:
      return [];
  }
}

export interface ExportEntry {
  readonly ModuleRequest: ModuleRequestRecord | null;
  readonly ImportName: JSStringValue | null | 'namespace' | 'filtered-namespace' | 'source' | 'all-but-default';
  readonly LocalName: string | null;
  readonly ExportName: string | null;
  readonly NamespaceNamesFilter?: readonly string[];
}

/** https://tc39.es/proposal-deferred-reexports/#sec-static-semantics-optionalindirectexportentries */
export function OptionalIndirectExportEntries(node: ParseNode | readonly ParseNode[]): ExportEntry[] {
  if (isArray(node)) {
    // ModuleItemList : ModuleItemList ModuleItem
    //   1. Let entries1 be OptionalIndirectExportEntries of ModuleItemList.
    //   2. Let entries2 be OptionalIndirectExportEntries of ModuleItem.
    //   3. Return the list-concatenation of entries1 and entries2.
    const entries: ExportEntry[] = [];
    node.forEach((n) => {
      entries.push(...OptionalIndirectExportEntries(n));
    });
    return entries;
  }
  switch (node.type) {
    case 'Module':
      // Module : [empty]
      //   1. Return a new empty List.
      if (!node.ModuleBody) {
        return [];
      }
      return OptionalIndirectExportEntries(node.ModuleBody);
    case 'ModuleBody':
      return OptionalIndirectExportEntries(node.ModuleItemList);
    case 'ExportDeclaration': {
      // Only `ExportDeclaration : export defer ExportFromClause FromClause WithClause? ;`
      // produces optional indirect entries; every other ExportDeclaration production
      // (and ImportDeclaration / StatementListItem) returns a new empty List.
      if (!node.FromClause) {
        return [];
      }
      const fromNode = node as ParseNode.ExportDeclaration_NamedFrom;
      if (fromNode.Phase !== 'defer') {
        return [];
      }
      // 1. If WithClause is present, let request be ExportFromDeclarationModuleRequest(ExportFromClause, FromClause, WithClause).
      // 2. Else, let request be ExportFromDeclarationModuleRequest(ExportFromClause, FromClause).
      const request = ExportFromDeclarationModuleRequest(fromNode);
      // 3. Return ExportEntriesForModule of ExportFromClause with argument request.
      return ExportEntriesForModule(fromNode.ExportFromClause, request);
    }
    default:
      return [];
  }
}

import { Lexer } from './Lexer.mts';
import type { ParseNode, ParseNodesByType } from './ParseNode.mts';
import type { Scope } from './Scope.mts';

export abstract class BaseParser extends Lexer {
  protected abstract scope: Scope;

  abstract startNode<T extends ParseNode>(inheritStart?: ParseNode): ParseNode.Unfinished<T>;

  abstract finishNode<T extends ParseNode.Unfinished, K extends T['type'] & ParseNode['type']>(node: T, type: K): ParseNodesByType[K];

  /**
   * Repurpose a {@link ParseNode} of one type as a {@link ParseNode} of another type.
   * @param node The node to repurpose.
   * @param type The name of the new node type.
   * @param update an optional callback that can be used to mutate {@link node} to match the new node type.
   */
  protected repurpose<T extends ParseNode, K extends ParseNode['type']>(
    node: T,
    type: K,
    update?: (
      /** The same value as {@link node}, but cast to an unfinished node of the provided type */
      asNewNode: ParseNode.Unfinished<ParseNodesByType[K]>,
      /** The same value as {@link node} */
      asOldNode: T,
      /** The same value as {@link node}, but cast to a partial, mutable type so that excess properties can be removed. */
      asPartialNode: { -readonly [P in keyof T]?: T[P] },
    ) => void,
  ): ParseNodesByType[K] {
    // NOTE: must down-cast to `ParseNode` before up-casting to `Unfinished<T>` due to the incompatbile `type` discriminant.
    const unfinished = node as ParseNode.Unfinished<ParseNodesByType[K]>;
    unfinished.type = type;
    update?.(unfinished, node, node);
    return unfinished as ParseNode as ParseNodesByType[K];
  }
}

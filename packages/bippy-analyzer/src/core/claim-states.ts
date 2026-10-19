import type { ClaimContext } from "./claim-context";
import { isEffectHandler } from "./collect-handlers";
import type { Claim, Handler, SourceLocation, SymbolicValue } from "./types";
import { forEachSymbolicValue } from "./utils/for-each-symbolic-value";

interface Position {
  line: number;
  column: number;
}

const isBefore = (left: Position, right: Position): boolean =>
  left.line < right.line || (left.line === right.line && left.column <= right.column);

const isInside = (inner: SourceLocation, outer: SourceLocation): boolean =>
  typeof inner !== "symbol" &&
  typeof outer !== "symbol" &&
  isBefore(outer.start, inner.start) &&
  isBefore(inner.end, outer.end);

const findContainingHandler = (claim: Claim, context: ClaimContext): Handler | null =>
  claim.file === context.analysis.file
    ? (context.analysis.handlers.find((handler) => isInside(claim.loc, handler.loc)) ?? null)
    : null;

const collectBindingIds = (values: SymbolicValue[]): Set<number> => {
  const ids = new Set<number>();
  for (const value of values)
    forEachSymbolicValue(value, (part) => {
      if (part.kind === "Binding") ids.add(part.binding.id);
    });
  return ids;
};

const isAvailable = (handlerId: string, renderedIds: Set<string>, context: ClaimContext): boolean =>
  renderedIds.has(handlerId) ||
  context.analysis.handlers.some(
    (handler) =>
      handler.delegates.includes(handlerId) &&
      (isEffectHandler(handler) || renderedIds.has(handler.id)),
  );

export const getHandlerStates = (handler: Handler, context: ClaimContext): number[] | null =>
  isEffectHandler(handler)
    ? null
    : context.renderedHandlerIds.flatMap((renderedIds, index) =>
        isAvailable(handler.id, renderedIds, context) ? [index] : [],
      );

export const getClaimStates = (claim: Claim, context: ClaimContext): number[] | null => {
  const handler = claim.isInHandler ? findContainingHandler(claim, context) : null;
  if (claim.isInHandler && !handler) return null;
  const handlerStates = handler ? getHandlerStates(handler, context) : null;
  const bindingIds = collectBindingIds([claim.subject, ...claim.guards]);
  const relevant = context.regions.filter((region) =>
    region.bindingIds.some((id) => bindingIds.has(id)),
  );
  if (relevant.length === 0) return handlerStates;
  const regionStates = relevant.flatMap((region) => region.states);
  if (!handlerStates) return regionStates;
  const available = new Set(handlerStates);
  return regionStates.filter((index) => available.has(index));
};

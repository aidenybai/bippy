import type { SyntheticEvent } from "react";

export const mergeClassNames = (...classNames: (string | undefined)[]) =>
  classNames.filter(Boolean).join(" ");

export const composeEventHandlers =
  <Event extends SyntheticEvent>(
    external: ((event: Event) => void) | undefined,
    internal: ((event: Event) => void) | undefined,
  ) =>
  (event: Event) => {
    external?.(event);
    if (!event.defaultPrevented) internal?.(event);
  };

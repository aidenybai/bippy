import type { AppDispatch, RootState } from "./store";

export const checkServer =
  () => async (dispatch: AppDispatch, getState: () => RootState, extraArgument: string) => {
    const checked = dispatch({ type: "server/checked" });
    const muted: unknown = dispatch({ type: "noise" });
    return `${getState().server.label} ${checked.type} ${String(muted)} ${extraArgument}`;
  };

export const describeDispatcher =
  () =>
  (
    dispatch: (action: { type: string }) => { type: string },
    _getState: unknown,
    extraArgument: string,
  ) =>
    `${dispatch({ type: "server/checked" }).type} ${extraArgument}`;

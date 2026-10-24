export type ViewMode = "code" | "state-chart" | "json";

export const VIEW_MODES: ViewMode[] = ["code", "state-chart", "json"];

export const isViewMode = (value: unknown): value is ViewMode =>
  VIEW_MODES.some((mode) => mode === value);

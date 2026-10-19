export type ViewMode = "code" | "diagram" | "json";

export const VIEW_MODES: ViewMode[] = ["code", "diagram", "json"];

export const isViewMode = (value: unknown): value is ViewMode =>
  VIEW_MODES.some((mode) => mode === value);

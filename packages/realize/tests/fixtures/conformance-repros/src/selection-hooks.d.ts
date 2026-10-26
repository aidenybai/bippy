declare module "selection-hooks" {
  export function useSelectableList(options: {
    selection: Record<string, boolean>;
    onSelectionChange: (selection: Record<string, boolean>) => void;
  }): void;
}

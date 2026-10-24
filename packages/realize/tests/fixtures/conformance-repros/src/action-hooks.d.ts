declare module "action-hooks" {
  export function useAction(options: { onExecute: () => void }): { execute: () => void };
}

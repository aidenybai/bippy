declare module "when-lib" {
  import type { ReactNode } from "react";
  export const whenTrue: (flag: boolean, run: () => ReactNode) => ReactNode;
}

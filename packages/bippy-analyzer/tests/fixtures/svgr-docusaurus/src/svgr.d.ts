declare module "*.svg" {
  import type { ComponentType, SVGProps } from "react";

  const Component: ComponentType<SVGProps<SVGSVGElement> & { title?: string }>;
  export default Component;
}

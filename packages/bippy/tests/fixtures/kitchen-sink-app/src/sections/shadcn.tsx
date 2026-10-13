import { useState } from "react";

import type { LibrarySection } from "../section-registry";
import { ShadcnButton } from "../shadcn-ui/button";

const ShadcnSection = () => {
  const [clickCount, setClickCount] = useState(0);
  return (
    <div>
      <ShadcnButton
        data-testid="interact-shadcn"
        onClick={() => setClickCount((previous) => previous + 1)}
      >
        shadcn:{clickCount}
      </ShadcnButton>
      <ShadcnButton variant="outline" size="sm" asChild>
        <a href="#shadcn">link as child</a>
      </ShadcnButton>
    </div>
  );
};

export const shadcnSections: LibrarySection[] = [{ name: "shadcn-ui", Component: ShadcnSection }];

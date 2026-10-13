// bippy must install its devtools hook before react-dom initializes; the
// default (virtual) client entry would load react-dom first.
import "bippy/install-hook-only";

import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
  );
});

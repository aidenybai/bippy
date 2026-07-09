// bippy must install its devtools hook before react-dom initializes, and
// tanstack start's default (virtual) client entry loads react-dom before any
// route module gets a chance to run
import "bippy/install-hook-only";

import { StartClient } from "@tanstack/react-start/client";
import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <StartClient />
    </StrictMode>,
  );
});

// bippy must install its devtools hook before react-dom initializes; the
// default (virtual) client entry would load react-dom first.
import "bippy/install-hook-only";

import { RemixBrowser } from "@remix-run/react";
import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <RemixBrowser />
    </StrictMode>,
  );
});

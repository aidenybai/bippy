import { withSentryReactRouterV6Routing } from "@sentry/react";
import { Route, Routes } from "react-router";

const EarlyRoutes = withSentryReactRouterV6Routing(Routes);

export const Early = () => (
  <EarlyRoutes>
    <Route path="/" element={<p>early home</p>} />
    <Route path="*" element={<p>early fallback</p>} />
  </EarlyRoutes>
);

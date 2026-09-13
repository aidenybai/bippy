import { withSentryReactRouterV6Routing } from "@sentry/react";
import { Route, Routes } from "react-router";

export const Late = () => {
  const LateRoutes = withSentryReactRouterV6Routing(Routes);
  return (
    <LateRoutes>
      <Route path="/" element={<p>late home</p>} />
      <Route path="*" element={<p>late fallback</p>} />
    </LateRoutes>
  );
};

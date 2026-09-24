import { type RouteConfig } from "@react-router/dev/routes";
import { autoRoutes } from "react-router-auto-routes";

export default autoRoutes({ ignoredRouteFiles: ["**/*.test.{ts,tsx}"] }) satisfies RouteConfig;

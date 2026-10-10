// @ts-nocheck
import type { ReactNode } from "react";

export const hasPermission = (role: string, action: "edit" | "view"): boolean =>
  role === "admin" || action === "view";

export const getName = (): string => "Ada";

export const getStatus = (): "idle" | "busy" | undefined => "idle";

export const renderBadge = (): ReactNode => <span>Badge</span>;

export const renderIcon = () => <i />;

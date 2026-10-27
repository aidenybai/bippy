// @ts-nocheck
import type { ReactNode } from "react";

export const hasPermission = (role: string, action: "edit" | "view"): boolean =>
  role === "admin" || action === "view";

export declare const isAllowed: (role: string, action: "edit" | "view") => boolean;

export declare const getName: () => string;

export declare const getStatus: () => "idle" | "busy" | undefined;

export const renderBadge = (): ReactNode => <span>Badge</span>;

export const renderIcon = () => <i />;

export type Role = "admin" | "viewer";

export const hasPermission = (role: Role, action: "edit" | "view"): boolean =>
  role === "admin" || action === "view";

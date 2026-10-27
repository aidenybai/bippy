export interface User {
  name: string;
  isAdmin: boolean;
}

export const useUser = (): User => ({ name: "Ada", isAdmin: true });

export declare const user: () => "guest" | "member";

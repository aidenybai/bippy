export interface User {
  name: string;
  isAdmin: boolean;
}

export declare function useUser(): User;

export declare const user: () => "guest" | "member";

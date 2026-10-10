export interface User {
  name: string;
  isAdmin: boolean;
}

export const useUser = (): User => ({ name: "Ada", isAdmin: true });

export const user = (): "guest" | "member" => "guest";

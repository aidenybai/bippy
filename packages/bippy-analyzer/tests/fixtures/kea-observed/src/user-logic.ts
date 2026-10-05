import { actions, afterMount, kea, path, reducers, selectors } from "kea";
import { loaders } from "kea-loaders";

export interface User {
  name: string;
  role: "admin" | "member";
}

const fetchUser = async (): Promise<User> => ({ name: "Ada", role: "admin" });

export const userLogic = kea([
  path(["scenes", "user"]),
  actions({ increment: true, dismissBanner: true }),
  loaders({ user: [null as User | null, { loadUser: fetchUser }] }),
  reducers({
    count: [0, { increment: (state) => state + 1 }],
    isBannerVisible: [true, { dismissBanner: () => false }],
  }),
  selectors({
    greeting: [(s) => [s.user], (user: User | null) => (user ? `hi ${user.name}` : "anonymous")],
    isAdmin: [(s) => [s.user], (user: User | null) => user?.role === "admin"],
  }),
  afterMount(({ actions }) => {
    actions.loadUser();
    actions.increment();
    actions.increment();
  }),
]);

import type { ReactNode } from "react";
import { Provider } from "react-redux";

import { worker } from "@/api/server";
import { store } from "@/app/store";
import { apiSliceWithUsers } from "@/features/users/usersSlice";

worker.listen({ onUnhandledRequest: "bypass" });
store.dispatch(apiSliceWithUsers.endpoints.getUsers.initiate());

export default function Providers({ children }: { children: ReactNode }) {
  return <Provider store={store}>{children}</Provider>;
}

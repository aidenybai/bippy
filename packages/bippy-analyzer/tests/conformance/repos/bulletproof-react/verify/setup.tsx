import Cookies from "js-cookie";
import type { ReactNode } from "react";

import { AppProvider } from "@/app/provider";
import { enableMocking } from "@/testing/mocks";
import { db } from "@/testing/mocks/db";
import { AUTH_COOKIE, authenticate, hash } from "@/testing/mocks/utils";

const USER = {
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  password: "password",
  teamId: "team",
  role: "ADMIN",
  bio: "",
};

await enableMocking();
if (!db.user.findFirst({ where: { email: { equals: USER.email } } }))
  db.user.create({ ...USER, password: hash(USER.password) });
const session = authenticate(USER);
Cookies.set(AUTH_COOKIE, session.jwt);

export const scenarios = {
  discussion: (id: string, commentCount = 0) => {
    db.discussion.create({
      id,
      title: "Hello",
      body: "First post",
      authorId: session.user.id,
      teamId: USER.teamId,
    });
    for (let index = 0; index < commentCount; index++)
      db.comment.create({ body: `Comment ${index}`, authorId: session.user.id, discussionId: id });
  },
};

export default function Providers({ children }: { children: ReactNode }) {
  return <AppProvider>{children}</AppProvider>;
}

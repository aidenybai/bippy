import { test } from "../../../verifier/spec";

test.use({ repo: "bulletproof-react" });

test("lists discussions once they load", async ({ mountComponent }) => {
  const list = await mountComponent("DiscussionsList", {
    scenario: { name: "discussion", args: ["first"] },
  });
  await list.expectState("!discussionsQuery.isLoading ∧ discussionsQuery.data?.data");
});

test("shows a discussion with its author", async ({ mountComponent }) => {
  const view = await mountComponent("DiscussionView", {
    props: { discussionId: "first" },
    scenario: { name: "discussion", args: ["first"] },
  });
  await view.expectState(
    "!discussionQuery.isLoading ∧ discussionQuery.data?.data ∧ discussionQuery.data.data.author",
  );
});

test("shows nothing for a missing discussion", async ({ mountComponent }) => {
  const view = await mountComponent("DiscussionView", { props: { discussionId: "missing" } });
  await view.expectState("!discussionQuery.isLoading ∧ !discussionQuery.data?.data");
});

test("shows the empty comments state", async ({ mountComponent }) => {
  const comments = await mountComponent("CommentsList", {
    props: { discussionId: "first" },
    scenario: { name: "discussion", args: ["first"] },
  });
  await comments.expectState(
    "!commentsQuery.isLoading ∧ !commentsQuery.data?.pages.flatMap(function)?.length",
  );
});

test("pages through comments", async ({ mountComponent }) => {
  const comments = await mountComponent("CommentsList", {
    props: { discussionId: "first" },
    scenario: { name: "discussion", args: ["first", 12] },
  });
  await comments.expectState(
    "!commentsQuery.isLoading ∧ commentsQuery.data?.pages.flatMap(function)?.length ∧ commentsQuery.hasNextPage ∧ !commentsQuery.isFetchingNextPage",
  );
  await comments.click("Load More Comments");
  await comments.expectState(
    "!commentsQuery.isLoading ∧ commentsQuery.data?.pages.flatMap(function)?.length ∧ !commentsQuery.hasNextPage",
  );
});

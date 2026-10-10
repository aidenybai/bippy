import { test } from "../../../../tests/verify/spec.js";

test.use({ repo: "bulletproof-react" });

test("lists discussions once they load", async ({ mountComponent }) => {
  const list = await mountComponent("DiscussionsList", { scenario: ["discussion", "first"] });
  list.expectState("!discussionsQuery.isLoading ∧ discussionsQuery.data?.data");
});

test("shows a discussion with its author", async ({ mountComponent }) => {
  const view = await mountComponent("DiscussionView", {
    props: { discussionId: "first" },
    scenario: ["discussion", "first"],
  });
  view.expectState(
    "!discussionQuery.isLoading ∧ discussionQuery.data?.data ∧ discussionQuery.data.data.author",
  );
});

test("shows nothing for a missing discussion", async ({ mountComponent }) => {
  const view = await mountComponent("DiscussionView", { props: { discussionId: "missing" } });
  view.expectState("!discussionQuery.isLoading ∧ !discussionQuery.data?.data");
});

test("shows the empty comments state", async ({ mountComponent }) => {
  const comments = await mountComponent("CommentsList", {
    props: { discussionId: "first" },
    scenario: ["discussion", "first"],
  });
  comments.expectState(
    "!commentsQuery.isLoading ∧ !commentsQuery.data?.pages.flatMap(function)?.length",
  );
});

test("pages through comments", async ({ mountComponent }) => {
  const comments = await mountComponent("CommentsList", {
    props: { discussionId: "first" },
    scenario: ["discussion", "first", 12],
  });
  comments.expectState(
    "!commentsQuery.isLoading ∧ commentsQuery.data?.pages.flatMap(function)?.length ∧ commentsQuery.hasNextPage ∧ !commentsQuery.isFetchingNextPage",
  );
  await comments.click("Load More Comments");
  comments.expectState(
    "!commentsQuery.isLoading ∧ commentsQuery.data?.pages.flatMap(function)?.length ∧ !commentsQuery.hasNextPage",
  );
});

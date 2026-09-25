---
name: pr-writing
description: Write or revise PR descriptions using the writing guidelines and concrete, example-first explanations.
---

# PR writing

Read [the writing guidelines](references/writing-guidelines.md) before writing. They are bundled here; no other skill is required.

Read the relevant diff, implementation, and validation results. For a stacked PR, compare against its parent branch. Explain only what this PR changes. If you only have supplied prose, preserve its meaning without claiming you checked the code.

## Follow the tldr.md style

Use the approach from Bippy’s “How Bippy analyzes React source”:

- State what changes and why it matters.
- Show a small example, its input, and its expected result before introducing architecture terms.
- Follow that example through the code. Name what reads, stores, calls, or returns each value.
- Define unfamiliar terms after showing why they are needed.
- Keep conditions and state boundaries explicit. Explain what changes, what persists, and what resets.
- Label simplified code and omitted setup. Do not present illustrative output as a measured result.
- State limitations beside the claims they limit. Resolving a module does not prove it executes; one passing case does not prove general support.
- Link relevant code and tests rather than listing every edited file.

Keep short changes short. Do not add a tutorial or code example when a paragraph explains the change.

## Writing reference

[OpenCode Reloaded](https://anoma.ly/notes/opencode-reloaded/) explains a design through one concrete example. It shows how catalog mutations fail during refresh, explains the cause, and demonstrates rebuilding from ordered transformations. It introduces the `State` abstraction after the reader understands the mechanism.

Borrow that progression: behavior, example, cause, fix, result, then abstraction if needed. Do not invent failed approaches to tell a story. Do not imitate the essay’s jokes, profanity, rhetorical questions, or distinctive wording. The bundled guidelines take precedence over the reference’s voice.

## Check the draft

Use a specific title and a direct opening. Remove filler, promotional claims, repeated summaries, and file inventories. Let the change determine the headings; do not force a template.

Report what validation actually ran and what it established. Preserve failures, skipped cases, timeouts, unrun checks, and remaining limits. Distinguish local checks from CI and historical evidence from current results.

Return the title and body without commentary unless requested. Writing a description does not authorize publishing it or changing Git history.

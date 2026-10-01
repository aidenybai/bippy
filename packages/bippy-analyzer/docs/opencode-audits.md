# OpenCode audits

`scripts/opencode.ts` runs OpenCode 2 in-process using `@opencode/sdk`, pinned to
`opencode-go/deepseek-v4.1-flash`. No OpenCode CLI or separate server is needed.
Use Node 24 and `pnpm install`. Runs make paid model requests through your Go account.

The runner reuses the Go API credential from OpenCode's existing
`$XDG_DATA_HOME/opencode/auth.json` (default `~/.local/share/opencode/auth.json`),
or uses `OPENCODE_API_KEY`. It connects through the SDK without printing the key.
OAuth-only credentials are not supported by this bridge. It downloads the current
models.dev catalog because the SDK's bundled catalog predates this model.

## Run and supervise

From the repository root:

```sh
pnpm --filter bippy-analyzer opencode run replay-audit scripts/prompts/replay-audit.md
```

Prompt paths resolve from the package directory when using `pnpm --filter`.
Use absolute paths for prompts elsewhere. Include the path to your local
`facebook/react` clone in the prompt when requesting diagnostic code.

Leave the runner active. In another terminal:

```sh
pnpm --filter bippy-analyzer opencode status replay-audit
pnpm --filter bippy-analyzer opencode approve replay-audit <request-id>
pnpm --filter bippy-analyzer opencode reject replay-audit <request-id>
pnpm --filter bippy-analyzer opencode abort replay-audit
```

Inspect the full pending `input` in `status` before approving, including heredocs,
redirects, and directory changes. Commands otherwise run from the repository root.
Approval is one-time, never permanent; shell approval fails if the full input is unavailable.
File edits are allowed only in that run's artifact directory. Reads, globs, and searches are
allowed except for protected reads; shell commands and unspecified tools require approval.
These permissions are **not a sandbox**: an approved shell command can modify the repository
or read secrets. Do not approve commands that do either.

The runner exports progress once per second under the ignored
`packages/bippy-analyzer/.opencode-audits/<name>/`:

- `status.json`: outcome, pending permissions, and full tool inputs captured from live events.
- `session.json`: completed conversation messages, tool results, and model errors.
- `prompt-*.md`: submitted prompts.
- `artifacts/`: diagnostic scripts and reports written by the agent.

An SDK `succeeded` outcome means the agent finished, not that its findings are
correct. Review the evidence and send a follow-up in the same session:

```sh
pnpm --filter bippy-analyzer opencode run replay-audit /absolute/path/follow-up.md
```

Runs stop after 30 minutes or on Ctrl-C. Only one runner may use the local database
at a time. If a process is forcibly killed, check the PID in
`.opencode-audits/private/runner.lock` before removing the stale lock. A saved
status can also be stale after a crash.

The private database stores credentials as well as sessions. Do not commit,
share, or expose `.opencode-audits/private/` to an agent. Review session exports
and artifacts for sensitive repository content before sharing them. The runner
uses isolated SDK configuration and does not load user/project OpenCode plugins.

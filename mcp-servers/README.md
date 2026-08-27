# MCP servers

Two local stdio MCP servers, provided as reference material for this project.

- `jira-mcp-server.mjs` — get_ticket, get_ticket_comments, add_comment, post_qa_report, transition_ticket
- `gitlab-mcp-server.mjs` — optional; only needed if a ticket links a GitLab MR

Both read credentials from a `.env` file at the **project root** via a manual
parser (not the `dotenv` package, deliberately — dotenv prints to stdout on
load, which corrupts the MCP stdio protocol). VS Code launches these with
`cwd` set to the workspace root, so `.env` at the project root is what they'll
find.

Wired into `.vscode/mcp.json` already. After filling in `.env`:

1. Open Copilot Chat → switch to **Agent** mode
2. Click the tools icon (top-left of the chat box) → confirm `jira` and
   `gitlab` appear with their tools listed
3. If a server shows an auth error, re-check `.env` and use the tools icon's
   restart option — no need to reload VS Code

For QA results, use Jira's `post_qa_report` with the ticket ID and the path to
`qa-report.json`. It uploads the rendered report and available evidence, then
posts the report as native Atlassian Document Format (ADF). `add_comment` remains
available for plain comments or caller-supplied ADF.

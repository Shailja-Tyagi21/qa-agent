// Node 18+ has fetch built in — no node-fetch dependency needed.
import { readFileSync } from "fs";
import { resolve } from "path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// Load .env manually — dotenv/dotenvx prints to stdout which corrupts MCP stdio protocol
try {
  const envFile = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
  for (const line of envFile.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const val = match[2].trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  }
} catch { /* .env not found — rely on process.env */ }

const server = new Server(
  { name: "jira-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

const BASE_URL = process.env.JIRA_BASE_URL;
const EMAIL    = process.env.JIRA_EMAIL;
const TOKEN    = process.env.JIRA_API_TOKEN;

function getAuthHeader() {
  const encoded = Buffer.from(`${EMAIL}:${TOKEN}`).toString("base64");
  return `Basic ${encoded}`;
}

// Recursively extract plain text from Atlassian Document Format (ADF)
function extractAdfText(node) {
  if (!node) return "";
  if (node.type === "text") return node.text || "";
  if (Array.isArray(node.content)) {
    return node.content.map(extractAdfText).join(" ").replace(/\s+/g, " ").trim();
  }
  return "";
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_ticket",
        description: "Fetch a JIRA ticket by ID",
        inputSchema: {
          type: "object",
          properties: {
            ticket_id: { type: "string", description: "The JIRA ticket ID, e.g. PROJ-123" }
          },
          required: ["ticket_id"]
        }
      },
      {
        name: "get_ticket_comments",
        description: "Fetch comments on a JIRA ticket",
        inputSchema: {
          type: "object",
          properties: {
            ticket_id: { type: "string", description: "The JIRA ticket ID, e.g. PROJ-123" }
          },
          required: ["ticket_id"]
        }
      },
      {
        name: "add_comment",
        description: "Post a comment on a JIRA ticket",
        inputSchema: {
          type: "object",
          properties: {
            ticket_id: { type: "string", description: "The JIRA ticket ID" },
            body:      { type: "string", description: "Plain text comment body" }
          },
          required: ["ticket_id", "body"]
        }
      },
      {
        name: "transition_ticket",
        description: "Transition a JIRA ticket to a new status (e.g. In Progress, Done)",
        inputSchema: {
          type: "object",
          properties: {
            ticket_id:     { type: "string", description: "The JIRA ticket ID" },
            transition_id: { type: "string", description: "The transition ID to apply" }
          },
          required: ["ticket_id", "transition_id"]
        }
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // ── get_ticket ─────────────────────────────────────────────────────────────
  if (name === "get_ticket") {
    try {
      const response = await fetch(
        `${BASE_URL}/rest/api/3/issue/${args.ticket_id}`,
        {
          method: "GET",
          headers: { Authorization: getAuthHeader(), Accept: "application/json" }
        }
      );
      if (!response.ok) throw new Error(`JIRA API Error: ${response.status}`);
      const data = await response.json();

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            id:          data.key,
            title:       data.fields.summary,
            description: data.fields.description
              ? extractAdfText(data.fields.description)
              : "No description",
            status:      data.fields.status.name,
            priority:    data.fields.priority?.name || "None",
            assignee:    data.fields.assignee?.displayName || "Unassigned",
            labels:      data.fields.labels || []
          })
        }]
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }

  // ── get_ticket_comments ───────────────────────────────────────────────────
  if (name === "get_ticket_comments") {
    try {
      const response = await fetch(
        `${BASE_URL}/rest/api/3/issue/${args.ticket_id}/comment`,
        {
          method: "GET",
          headers: { Authorization: getAuthHeader(), Accept: "application/json" }
        }
      );
      if (!response.ok) throw new Error(`JIRA API Error: ${response.status}`);
      const data = await response.json();

      const comments = (data.comments || []).map(c => ({
        author:  c.author?.displayName || "Unknown",
        created: c.created,
        body:    extractAdfText(c.body)
      }));

      return { content: [{ type: "text", text: JSON.stringify({ total: data.total, comments }) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }

  // ── add_comment ───────────────────────────────────────────────────────────
  if (name === "add_comment") {
    try {
      const response = await fetch(
        `${BASE_URL}/rest/api/3/issue/${args.ticket_id}/comment`,
        {
          method: "POST",
          headers: {
            Authorization: getAuthHeader(),
            Accept: "application/json",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            body: {
              type:    "doc",
              version: 1,
              content: [{
                type:    "paragraph",
                content: [{ type: "text", text: args.body }]
              }]
            }
          })
        }
      );
      if (!response.ok) throw new Error(`JIRA API Error: ${response.status}`);
      const data = await response.json();

      return { content: [{ type: "text", text: JSON.stringify({ id: data.id, created: data.created }) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }

  // ── transition_ticket ─────────────────────────────────────────────────────
  if (name === "transition_ticket") {
    try {
      const response = await fetch(
        `${BASE_URL}/rest/api/3/issue/${args.ticket_id}/transitions`,
        {
          method: "POST",
          headers: {
            Authorization: getAuthHeader(),
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ transition: { id: args.transition_id } })
        }
      );
      if (!response.ok) throw new Error(`JIRA API Error: ${response.status}`);

      return { content: [{ type: "text", text: JSON.stringify({ success: true, ticket: args.ticket_id }) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }

  throw new Error(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);

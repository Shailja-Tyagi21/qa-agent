// Node 18+ has fetch built in — no node-fetch dependency needed.
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
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
  return `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`).toString("base64")}`;
}

// ── ADF (Atlassian Document Format) builders ────────────────────────────────
// Jira does not render Markdown — every comment must be a real ADF document
// tree. These are small, composable node constructors so tool handlers below
// build correct ADF without hand-nesting JSON inline.

const adf = {
  doc: (...content) => ({ type: "doc", version: 1, content: content.flat().filter(Boolean) }),

  text: (str, marks) => ({ type: "text", text: String(str ?? ""), ...(marks ? { marks } : {}) }),
  strong: (str) => adf.text(str, [{ type: "strong" }]),

  paragraph: (...inline) => ({
    type: "paragraph",
    content: inline.flat().filter(Boolean).map(n => (typeof n === "string" ? adf.text(n) : n))
  }),

  heading: (level, text) => ({
    type: "heading",
    attrs: { level: Math.min(Math.max(level, 1), 6) },
    content: [adf.text(text)]
  }),

  rule: () => ({ type: "rule" }),

  bulletList: (items) => ({
    type: "bulletList",
    content: items.map(i => ({ type: "listItem", content: [adf.paragraph(i)] }))
  }),

  orderedList: (items) => ({
    type: "orderedList",
    attrs: { order: 1 },
    content: items.map(i => ({ type: "listItem", content: [adf.paragraph(i)] }))
  }),

  // rows: array of arrays of plain strings (or pre-built inline nodes)
  table: (headers, rows) => ({
    type: "table",
    attrs: { isNumberColumnEnabled: false, layout: "default" },
    content: [
      {
        type: "tableRow",
        content: headers.map(h => ({ type: "tableHeader", attrs: {}, content: [adf.paragraph(adf.strong(h))] }))
      },
      ...rows.map(row => ({
        type: "tableRow",
        content: row.map(cell => ({ type: "tableCell", attrs: {}, content: [adf.paragraph(cell)] }))
      }))
    ]
  }),

  panel: (panelType, ...inline) => ({
    type: "panel",
    attrs: { panelType }, // info | note | success | warning | error
    content: [adf.paragraph(...inline)]
  })
};

const MIME_TYPES = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp",
  ".webm": "video/webm", ".mp4": "video/mp4"
};
function mimeFor(filePath) {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

/**
 * Shared upload core — used by upload_screenshots (agent supplies paths
 * directly) and post_qa_report (attaches the sibling qa-report.html and
 * session video). Returns each file's numeric attachment id/filename/size;
 * nothing here needs to resolve a Media Services UUID since none of these
 * files get embedded inline in a comment anymore — they're plain Jira
 * attachments, visible in the Attachments panel.
 */
async function uploadFilesToJira(ticketId, filePaths) {
  if (!filePaths.length) return [];
  const form = new FormData();
  for (const p of filePaths) {
    const abs = resolve(process.cwd(), p);
    const bytes = readFileSync(abs); // throws clearly if the path is wrong
    form.append("file", new Blob([bytes], { type: mimeFor(abs) }), abs.split(/[\\/]/).pop());
  }
  // Do NOT set Content-Type manually — fetch/undici sets the multipart
  // boundary automatically from the FormData instance. Setting it by hand
  // breaks the boundary and Jira rejects the upload with a 400.
  const response = await fetch(
    `${BASE_URL}/rest/api/3/issue/${ticketId}/attachments`,
    {
      method: "POST",
      headers: {
        Authorization: getAuthHeader(),
        Accept: "application/json",
        "X-Atlassian-Token": "no-check" // required by this endpoint specifically
      },
      body: form
    }
  );
  if (!response.ok) throw new Error(`JIRA API Error: ${response.status} — ${await response.text().catch(() => '')}`);
  const uploaded = await response.json();
  return uploaded.map(a => ({ id: a.id, filename: a.filename, size: a.size }));
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
        description: "Post a comment on a JIRA ticket. Pass either 'body' for a plain single-paragraph comment, or 'adf' for a fully-formatted comment (headings, tables, bold, bullet lists) — pass a complete Atlassian Document Format document object as 'adf' when you need real formatting; Jira renders ADF natively but does NOT render markdown syntax (**, |, #) as formatting.",
        inputSchema: {
          type: "object",
          properties: {
            ticket_id: { type: "string", description: "The JIRA ticket ID" },
            body:      { type: "string", description: "Plain text comment body — wrapped in a single paragraph. Ignored if 'adf' is provided." },
            adf:       { type: "object", description: "A complete ADF document: { type: 'doc', version: 1, content: [...] }. Takes priority over 'body' when present." }
          },
          required: ["ticket_id"]
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
      },
      {
        name: "upload_screenshots",
        description: "Upload one or more local files as attachments to a JIRA ticket (visible in the Attachments panel). Generic file-upload utility — not tied to the QA report flow.",
        inputSchema: {
          type: "object",
          properties: {
            ticket_id:  { type: "string", description: "The JIRA ticket ID" },
            file_paths: {
              type: "array", items: { type: "string" },
              description: "Paths to local files (relative to the workspace root or absolute), e.g. ['qa-runs/SCRUM-1-.../images/ss_SCRUM-1_S1.png']"
            }
          },
          required: ["ticket_id", "file_paths"]
        }
      },
      {
        name: "post_qa_summary",
        description: "Post a fully-formatted, text-only QA report comment on a JIRA ticket. Pass structured data — this tool builds the ADF document (headings, tables, bold, verdict panel) so you don't have to hand-author ADF JSON. Matches the layout in assets/report-format.md. Does not attach or embed screenshots/video — use upload_screenshots separately if you want files on the ticket, or use post_qa_report for the full flow (report.json → HTML report + video attached + summary comment).",
        inputSchema: {
          type: "object",
          properties: {
            ticket_id: { type: "string", description: "The JIRA ticket ID" },
            title:     { type: "string", description: "Feature/ticket title" },
            verdict:   { type: "string", enum: ["APPROVED", "REJECTED", "CONDITIONAL", "BLOCKED"] },
            conclusion:{ type: "string", description: "One-line summary shown under the verdict heading" },
            locale:    { type: "string" },
            viewport:  { type: "string" },
            targetUrl: { type: "string" },
            testDate:  { type: "string", description: "YYYY-MM-DD" },
            summary: {
              type: "object",
              description: "Scenario counts",
              properties: {
                total: { type: "number" }, passed: { type: "number" }, failed: { type: "number" },
                partial: { type: "number" }, skipped: { type: "number" }
              }
            },
            scenarios: {
              type: "array", description: "Each: {id, name, acCoverage, viewport, status}",
              items: { type: "object" }
            },
            bugs: {
              type: "array", description: "Each: {id, title, severity, url, steps:[], expected, actual, consoleErrors}",
              items: { type: "object" }
            },
            acceptanceCriteria: {
              type: "array", description: "Each: {id, requirement, testCase, status}",
              items: { type: "object" }
            },
            commentScenarios: {
              type: "array", description: "Each: {source, number, summary, testCase, status, notes}",
              items: { type: "object" }
            },
            observations: { type: "array", items: { type: "string" } },
            reportPath: { type: "string", description: "Local path to qa-report.html, referenced as text only — not attached" }
          },
          required: ["ticket_id", "verdict", "summary"]
        }
      },
      {
        name: "post_qa_report",
        description: "The fast path: give it a ticket id and the path to qa-report.json — it reads the file, attaches the sibling qa-report.html (a self-contained report with screenshots and video already embedded) to the ticket, attaches the raw session video separately for quick playback, attaches the generated {ticketId}.feature file (as copied into this same run folder by SKILL.md Phase 7), and posts a text-only summary comment (verdict, tables, bug narrative — no re-embedded screenshots/video, since those already live in the attachments). Use this instead of manually calling upload_screenshots + post_qa_summary when you have a qa-report.json already written to disk (the normal case after Phase 7).",
        inputSchema: {
          type: "object",
          properties: {
            ticket_id:   { type: "string", description: "The JIRA ticket ID" },
            report_path: { type: "string", description: "Path to qa-report.json, e.g. 'qa-runs/SCRUM-1-2026-08-20-1352/qa-report.json'" },
            attach_html_report: { type: "boolean", description: "Set false to skip attaching qa-report.html. Defaults to true." },
            attach_video: { type: "boolean", description: "Set false to skip attaching the raw session video. Defaults to true." },
            attach_feature_file: { type: "boolean", description: "Set false to skip attaching the generated {ticketId}.feature file. Defaults to true." }
          },
          required: ["ticket_id", "report_path"]
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
      if (!args.adf && !args.body) {
        throw new Error("add_comment requires either 'adf' or 'body'");
      }
      const commentBody = args.adf || {
        type:    "doc",
        version: 1,
        content: [{
          type:    "paragraph",
          content: [{ type: "text", text: args.body }]
        }]
      };
      const response = await fetch(
        `${BASE_URL}/rest/api/3/issue/${args.ticket_id}/comment`,
        {
          method: "POST",
          headers: {
            Authorization: getAuthHeader(),
            Accept: "application/json",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ body: commentBody })
        }
      );
      if (!response.ok) throw new Error(`JIRA API Error: ${response.status} — ${await response.text().catch(() => '')}`);
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

  // ── upload_screenshots ───────────────────────────────────────────────────
  if (name === "upload_screenshots") {
    try {
      const paths = args.file_paths || [];
      if (!paths.length) throw new Error("file_paths must be a non-empty array");
      const result = await uploadFilesToJira(args.ticket_id, paths);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }

  // ── post_qa_summary ──────────────────────────────────────────────────────
const VERDICT_META = {
  APPROVED:    { icon: "✅", label: "APPROVED", panel: "success" },
  CONDITIONAL: { icon: "🟡", label: "CONDITIONAL APPROVAL", panel: "warning" },
  REJECTED:    { icon: "🔴", label: "REJECTED", panel: "error" },
  BLOCKED:     { icon: "🔵", label: "BLOCKED", panel: "note" }
};

/**
 * Builds the ADF document for a QA report comment.
 *
 * This is a text-only summary — verdict, tables, and bug narratives. Visual
 * evidence (screenshots, video) intentionally isn't re-embedded here: it
 * already lives in the self-contained qa-report.html and the video, both
 * attached to the ticket separately (see post_qa_report), so duplicating it
 * inline in the comment would just be the same evidence twice.
 */
function buildAdfReport(args) {
  const v = VERDICT_META[args.verdict] || VERDICT_META.BLOCKED;
  const content = [];

  content.push(adf.heading(2, `QA Report — ${args.title || args.ticketId || args.ticket_id}`));
  content.push(adf.paragraph(
    adf.strong("Locale: "), args.locale || "—", "   ",
    adf.strong("Viewport: "), args.viewport || "—", "   ",
    adf.strong("Date: "), args.testDate || "—"
  ));
  if (args.targetUrl) content.push(adf.paragraph(adf.strong("Target: "), args.targetUrl));
  content.push(adf.rule());

  content.push(adf.panel(v.panel, adf.strong(`${v.icon} QA VERDICT: ${v.label}`)));
  if (args.conclusion) content.push(adf.paragraph(args.conclusion));

  const s = args.summary || {};
  content.push(adf.heading(3, "Summary"));
  content.push(adf.table(
    ["Metric", "Count"],
    [
      ["Total scenarios", String(s.total ?? 0)],
      ["Passed", String(s.passed ?? 0)],
      ["Failed", String(s.failed ?? 0)],
      ["Partial", String(s.partial ?? 0)],
      ["Skipped", String(s.skipped ?? 0)],
      ["Bugs found", String((args.bugs || []).length)]
    ]
  ));

  if (args.acceptanceCriteria?.length) {
    content.push(adf.heading(3, "Acceptance criteria coverage"));
    content.push(adf.table(
      ["AC", "Requirement", "Test case", "Status"],
      args.acceptanceCriteria.map(a => [a.id || "—", a.requirement || "—", a.testCase || "—", a.status || "—"])
    ));
  }

  if (args.commentScenarios?.length) {
    content.push(adf.heading(3, "Comment scenario coverage"));
    content.push(adf.table(
      ["Source", "#", "Scenario", "Test case", "Status", "Notes"],
      args.commentScenarios.map(c => [c.source || "—", String(c.number ?? "—"), c.summary || "—", c.testCase || "—", c.status || "—", c.notes || ""])
    ));
  }

  if (args.scenarios?.length) {
    content.push(adf.heading(3, "Scenarios executed"));
    content.push(adf.table(
      ["ID", "Name", "AC", "Status"],
      args.scenarios.map(sc => [sc.id || "—", sc.name || "—", sc.acCoverage || "—", sc.status || "—"])
    ));
  }

  if (args.bugs?.length) {
    content.push(adf.heading(3, "Bug reports"));
    for (const b of args.bugs) {
      content.push(adf.heading(4, `${b.id || "BUG"} — ${b.title || "Untitled"} (${b.severity || "MAJOR"})`));
      if (b.url) content.push(adf.paragraph(adf.strong("URL: "), b.url));
      if (b.steps?.length) {
        content.push(adf.paragraph(adf.strong("Steps to Reproduce:")));
        content.push(adf.orderedList(b.steps));
      }
      if (b.expected) content.push(adf.paragraph(adf.strong("Expected: "), b.expected));
      if (b.actual) content.push(adf.paragraph(adf.strong("Actual: "), b.actual));
      if (b.consoleErrors) content.push(adf.paragraph(adf.strong("Console errors: "), b.consoleErrors));
    }
  }

  if (args.observations?.length) {
    content.push(adf.heading(3, "Observations"));
    content.push(adf.bulletList(args.observations));
  }

  content.push(adf.rule());
  content.push(adf.paragraph(
    args.htmlReportAttached
      ? "Full HTML report (with screenshots and video embedded) attached to this ticket — see the Attachments panel."
      : args.reportPath ? `Full HTML report: ${args.reportPath} (local, not attached)` : "Full HTML report generated locally."
  ));
  if (args.videoAttached) {
    content.push(adf.paragraph("Session recording also attached separately for quick playback."));
  }
  if (args.featureFileAttached) {
    content.push(adf.paragraph(`Generated Gherkin scaffold (${args.ticketId || 'this ticket'}.feature) also attached.`));
  }

  return adf.doc(...content);
}

async function postAdfComment(ticketId, body) {
  const response = await fetch(
    `${BASE_URL}/rest/api/3/issue/${ticketId}/comment`,
    {
      method: "POST",
      headers: {
        Authorization: getAuthHeader(),
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ body })
    }
  );
  if (!response.ok) throw new Error(`JIRA API Error: ${response.status} — ${await response.text().catch(() => '')}`);
  return response.json();
}

  if (name === "post_qa_summary") {
    try {
      const body = buildAdfReport(args);
      const data = await postAdfComment(args.ticket_id, body);
      return { content: [{ type: "text", text: JSON.stringify({ id: data.id, created: data.created }) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }

  // ── post_qa_report ───────────────────────────────────────────────────────
  // One-call, JSON-driven path — mirrors the old GitLab server's design: the
  // agent supplies only a ticket id and a report path; this reads
  // qa-report.json itself, attaches the self-contained qa-report.html (which
  // already has screenshots and video embedded) and the raw video file to
  // the ticket, and posts a text-only summary comment. No manual
  // upload_screenshots + post_qa_summary orchestration needed, and nothing
  // gets embedded twice.
  if (name === "post_qa_report") {
    try {
      const reportPath = args.report_path;
      const absReportPath = resolve(process.cwd(), reportPath);
      if (!existsSync(absReportPath)) throw new Error(`Report file not found: ${reportPath}`);

      const report = JSON.parse(readFileSync(absReportPath, "utf8"));
      const reportDir = dirname(absReportPath);

      // The HTML report is attached as its own step so a failure attaching
      // the video below can never block it, and vice versa.
      let htmlReportAttached = false;
      const htmlReportPath = resolve(reportDir, "qa-report.html");
      if (args.attach_html_report !== false && existsSync(htmlReportPath)) {
        try {
          await uploadFilesToJira(args.ticket_id, [htmlReportPath]);
          htmlReportAttached = true;
        } catch (err) {
          console.error(`[jira-mcp] failed to attach qa-report.html: ${err.message}`);
        }
      }

      // The raw session video, attached separately for quick playback
      // without downloading the (much larger) self-contained HTML report.
      let videoAttached = false;
      const videoRelPath = report.videoFull || report.videoClip;
      if (args.attach_video !== false && videoRelPath) {
        const videoAbsPath = resolve(reportDir, videoRelPath);
        if (existsSync(videoAbsPath)) {
          try {
            await uploadFilesToJira(args.ticket_id, [videoAbsPath]);
            videoAttached = true;
          } catch (err) {
            console.error(`[jira-mcp] failed to attach ${videoRelPath}: ${err.message}`);
          }
        }
      }

      // The generated .feature file — SKILL.md's Phase 7 copies it alongside
      // qa-report.json in this same run folder (features/generated/ stays
      // the copy Cucumber discovers; this is a duplicate for the ticket).
      let featureFileAttached = false;
      const featureFilePath = report.ticketId ? resolve(reportDir, `${report.ticketId}.feature`) : null;
      if (args.attach_feature_file !== false && featureFilePath && existsSync(featureFilePath)) {
        try {
          await uploadFilesToJira(args.ticket_id, [featureFilePath]);
          featureFileAttached = true;
        } catch (err) {
          console.error(`[jira-mcp] failed to attach ${report.ticketId}.feature: ${err.message}`);
        }
      }

      const body = buildAdfReport({
        ticketId: report.ticketId,
        title: report.title || report.featureSummary,
        verdict: report.verdict,
        conclusion: report.conclusion,
        locale: report.locale,
        viewport: report.viewport,
        targetUrl: report.targetUrl,
        testDate: report.testDate,
        summary: report.summary,
        scenarios: report.scenarios,
        bugs: report.bugs,
        acceptanceCriteria: report.acceptanceCriteria,
        commentScenarios: report.commentScenarios,
        observations: report.observations,
        reportPath,
        htmlReportAttached,
        videoAttached,
        featureFileAttached
      });

      const data = await postAdfComment(args.ticket_id, body);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            id: data.id, created: data.created,
            reportPath, htmlReportAttached, videoAttached, featureFileAttached
          })
        }]
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }

  throw new Error(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);

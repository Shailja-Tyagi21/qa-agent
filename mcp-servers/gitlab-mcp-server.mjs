import fetch from 'node-fetch'
import { readFileSync, writeFileSync, existsSync, statSync, unlinkSync, readdirSync } from 'fs'
import { resolve, basename, extname } from 'path'
import { execSync } from 'child_process'
import { createRequire } from 'module'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const _require = createRequire(import.meta.url)

// Load .env manually — dotenv/dotenvx prints to stdout which corrupts MCP stdio protocol
try {
  const envFile = readFileSync(resolve(process.cwd(), '.env'), 'utf8')
  for (const line of envFile.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/)
    if (match) {
      const key = match[1].trim()
      const val = match[2].trim().replace(/^["']|["']$/g, '')
      if (!process.env[key]) { process.env[key] = val }
    }
  }
} catch { /* .env not found — rely on process.env */ }

const server = new Server(
  { name: 'gitlab-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

const GITLAB_TOKEN = process.env.GITLAB_TOKEN
const PROJECT_ID = process.env.GITLAB_PROJECT_ID || process.env.GITLAB_PROJECT_PATH
const GITLAB_API_URL = process.env.GITLAB_API_URL || 'https://gitlab.com/api/v4'

const VIDEO_LIMIT_MB = 5
const VIDEO_LIMIT_BYTES = VIDEO_LIMIT_MB * 1024 * 1024

const encodedProjectId = () => encodeURIComponent(PROJECT_ID)

function authHeaders () {
  return { 'PRIVATE-TOKEN': GITLAB_TOKEN, 'Content-Type': 'application/json' }
}

async function glFetch (path, options = {}) {
  const url = `${GITLAB_API_URL}${path}`
  const res = await fetch(url, { ...options, headers: { ...authHeaders(), ...(options.headers || {}) } })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`GitLab API ${res.status}: ${err}`)
  }
  return res.json()
}

// ── Upload helpers ────────────────────────────────────────────────────────────

/** Upload any file to GitLab uploads API. Returns the upload data object or null. */
async function uploadFile (filePath, contentType) {
  if (!filePath || !existsSync(filePath)) {
    process.stderr.write(`   ⚠️  File not found, skipping upload: ${filePath}\n`)
    return null
  }

  const fileBuffer = readFileSync(filePath)
  const filename = basename(filePath)
  const boundary = `----FormBoundary${Date.now()}`
  const CRLF = '\r\n'

  const header = Buffer.from(`--${boundary}${CRLF}`
    + `Content-Disposition: form-data; name="file"; filename="${filename}"${CRLF}`
    + `Content-Type: ${contentType}${CRLF}${CRLF}`)
  const footer = Buffer.from(`${CRLF}--${boundary}--${CRLF}`)
  const body = Buffer.concat([header, fileBuffer, footer])

  let response
  for (let attempt = 1; attempt <= 2; attempt++) {
    response = await fetch(
      `${GITLAB_API_URL}/projects/${encodedProjectId()}/uploads`,
      {
        method: 'POST',
        headers: {
          'PRIVATE-TOKEN': GITLAB_TOKEN,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': String(body.length)
        },
        body
      }
    )
    if (response.ok) { break }
    if (attempt < 2) {
      process.stderr.write(`   🔄 Upload attempt ${attempt} failed (${response.status}) — retrying in 3 s…\n`)
      await new Promise(r => setTimeout(r, 3000))
    }
  }

  if (!response.ok) {
    const err = await response.text()
    process.stderr.write(`   ⚠️  Upload failed for ${filename} (${response.status}): ${err}\n`)
    return null
  }

  return response.json()
}

/** Upload a screenshot. Returns GitLab markdown string or null. */
async function uploadImage (filePath) {
  process.stderr.write(`   📤 Uploading screenshot: ${filePath}\n`)
  const data = await uploadFile(filePath, 'image/png')
  return data ? data.markdown : null
}

/**
 * Attempt to compress a video using ffmpeg — ONE ATTEMPT ONLY.
 * Returns path to compressed file if it fits within VIDEO_LIMIT_BYTES, or null.
 * Caller must NOT retry if null is returned.
 */
function tryCompressVideo (inputPath) {
  try {
    execSync('which ffmpeg', { stdio: 'pipe' })
    const outputPath = inputPath.replace(/\.(webm|mp4)$/i, '-compressed.mp4')
    process.stderr.write('   🗜️  Compressing video with ffmpeg (one attempt only)…\n')
    execSync(
      `ffmpeg -i "${inputPath}" -vf "scale=640:-2" -b:v 400k -b:a 48k "${outputPath}" -y`,
      { stdio: 'pipe' }
    )
    const compressedBytes = statSync(outputPath).size
    if (compressedBytes < VIDEO_LIMIT_BYTES) {
      process.stderr.write(`   ✅ Compressed to ${(compressedBytes / 1024 / 1024).toFixed(1)} MB\n`)
      return outputPath
    }
    // Still too large — delete and return null. Do NOT retry.
    process.stderr.write(`   ⚠️  Compressed file still too large (${(compressedBytes / 1024 / 1024).toFixed(1)} MB) — deleting, will use focused clip.\n`)
    unlinkSync(outputPath)
    return null
  } catch (_) {
    return null
  }
}

/**
 * Repair WebM duration metadata so browsers show the correct length and can seek.
 * Playwright's recordVideo produces a "live" WebM without a Duration element.
 * Uses ts-ebml (dev dependency) to inject it. Returns path to fixed file, or
 * the original path if ts-ebml is unavailable or repair fails.
 */
function repairWebmMetadata (inputPath) {
  try {
    const { Decoder, Reader, tools } = _require('ts-ebml')
    const decoder = new Decoder()
    const reader = new Reader()
    reader.logging = false
    reader.drop_default_duration = false
    const buf = readFileSync(inputPath)
    const elms = decoder.decode(buf)
    elms.forEach(e => reader.read(e))
    reader.stop()
    if (!reader.duration || reader.duration <= 0) { return inputPath }
    const refined = tools.makeMetadataSeekable(reader.metadatas, reader.duration, reader.cues)
    const fixedBuf = Buffer.concat([Buffer.from(refined), buf.slice(reader.metadataSize)])
    const outputPath = inputPath.replace(/\.webm$/i, '_fixed.webm')
    writeFileSync(outputPath, fixedBuf)
    process.stderr.write(`   ✅ WebM repaired: ${(reader.duration / 1000).toFixed(1)}s duration → ${outputPath}\n`)
    return outputPath
  } catch (_) {
    return inputPath // ts-ebml unavailable or failed — use original
  }
}

/** Upload a video. Returns { markdown, reason }. */
async function uploadVideo (filePath) {
  if (!filePath || !existsSync(filePath)) {
    process.stderr.write(`   ⚠️  Video not found, skipping: ${filePath}\n`)
    return { markdown: null, reason: 'not_found' }
  }

  const sizeMB = (statSync(filePath).size / 1024 / 1024).toFixed(1)
  let videoToUpload = filePath

  if (statSync(filePath).size > VIDEO_LIMIT_BYTES) {
    process.stderr.write(`   ⚠️  Video is ${sizeMB} MB — exceeds ${VIDEO_LIMIT_MB} MB limit. Trying compression (one attempt)…\n`)
    const compressed = tryCompressVideo(filePath)
    if (compressed) {
      videoToUpload = compressed
    } else {
      // Compression failed or still too large — do NOT retry. Return too_large.
      process.stderr.write(`   ⚠️  Compression did not succeed. Video saved locally: ${filePath}\n`)
      return { markdown: null, reason: 'too_large' }
    }
  }

  // Convert WebM → MP4 (H.264) for universal browser playback on GitLab.
  // Playwright records WebM with VP8 in a streaming container that most browsers
  // cannot play inline. ffmpeg produces a seekable MP4 with proper duration.
  // Falls back to WebM metadata repair if ffmpeg is unavailable.
  if (extname(videoToUpload).toLowerCase() === '.webm') {
    try {
      execSync('which ffmpeg', { stdio: 'pipe' })
      const mp4Path = videoToUpload.replace(/\.webm$/i, '.mp4')
      process.stderr.write('   🔄 Converting WebM → MP4 for GitLab playback…\n')
      execSync(
        `ffmpeg -i "${videoToUpload}" -vf "scale=800:-2" -b:v 500k -b:a 48k "${mp4Path}" -y`,
        { stdio: 'pipe' }
      )
      if (existsSync(mp4Path) && statSync(mp4Path).size <= VIDEO_LIMIT_BYTES) {
        process.stderr.write(`   ✅ Converted to MP4: ${(statSync(mp4Path).size / 1024 / 1024).toFixed(1)} MB\n`)
        videoToUpload = mp4Path
      }
    } catch (_) {
      // ffmpeg unavailable — try WebM metadata repair as fallback
      videoToUpload = repairWebmMetadata(videoToUpload)
    }
  }

  const uploadSizeMB = (statSync(videoToUpload).size / 1024 / 1024).toFixed(1)
  process.stderr.write(`   🎬 Uploading video (${uploadSizeMB} MB): ${videoToUpload}\n`)
  const ext = extname(videoToUpload).toLowerCase()
  const contentType = ext === '.mp4' ? 'video/mp4' : 'video/webm'
  const data = await uploadFile(videoToUpload, contentType)
  if (!data || !data.markdown) {
    process.stderr.write(`   ⚠️  Upload returned no markdown for ${videoToUpload}\n`)
    return { markdown: null, reason: 'upload_failed' }
  }
  return { markdown: data.markdown, reason: 'ok' }
}

// ── Report Markdown builder ───────────────────────────────────────────────────

function icon (status) {
  if (!status) { return '⏭' }
  const s = status.toString().toUpperCase()
  if (['PASS', 'MET', 'APPROVED', 'TRUE'].includes(s)) { return '✅' }
  if (s === 'CONDITIONAL') { return '🟡' }
  if (['FAIL', 'FAILED', 'NOT MET'].includes(s)) { return '❌' }
  if (s === 'PARTIAL') { return '🟡' }
  if (['SKIP', 'SKIPPED', 'NOT REQUIRED'].includes(s)) { return '⏭' }
  return '⚪'
}

function cell (val) {
  return String(val ?? '').replace(/\|/g, '\\|')
    .replace(/\n/g, ' ')
}

async function buildMarkdownComment (report) {
  const L = []
  const push = (...args) => L.push(...args)

  const isStructured = !!(report.acceptanceCriteria || report.summary || report.locale)
  const mrRef = report.type === 'issue' ? `#${report.id}` : `!${report.id}`
  const relatedIssue = report.relatedIssue || ''

  // 1. Header
  push(`## 🤖 Copilot QA Report — MR ${mrRef}${relatedIssue ? ` (${relatedIssue})` : ''}`)
  push('')

  if (isStructured) {
    const parts = []
    if (report.featureSummary) { parts.push(`**Feature:** ${report.featureSummary}`) }
    if (report.locale) { parts.push(`**Locale tested:** \`${report.locale}\``) }
    if (report.viewport) { parts.push(`**Viewport:** ${report.viewport}`) }
    if (report.testUrl) { parts.push(`**Environment:** ${report.testUrl}`) }
    if (relatedIssue) { parts.push(`**Related issue:** ${relatedIssue}`) }
    if (report.testDate) { parts.push(`**Date:** ${report.testDate}`) }
    push(parts.join(' | '))
    push('')
  } else {
    push('| | |')
    push('|---|---|')
    push(`| **ID** | ${report.id} |`)
    push(`| **Type** | ${report.type} |`)
    push(`| **State** | ${report.state} |`)
    if (report.author) { push(`| **Author** | ${report.author} |`) }
    if (report.web_url) { push(`| **URL** | ${report.web_url} |`) }
    if (report.labels?.length) { push(`| **Labels** | ${report.labels.join(', ')} |`) }
    push('')
  }

  // 2. Verdict
  const allPass = report.scenarios?.every((s) => s.status === 'PASS')
  const hasBlockerBug = report.bugs?.some((b) => ['CRITICAL', 'BLOCKER'].includes((b.severity || '').toUpperCase()))
  const hasAnyBug = (report.bugs?.length || 0) > 0
  const verdict = report.verdict
    || (allPass && !hasAnyBug ? 'APPROVED'
      : hasBlockerBug ? 'REJECTED'
        : hasAnyBug ? 'CONDITIONAL'
          : 'REJECTED')

  if (verdict === 'APPROVED') {
    push('### ✅ QA VERDICT: APPROVED')
  } else if (verdict === 'CONDITIONAL') {
    push('### 🟡 QA VERDICT: CONDITIONAL — Non-blocking issues found, human review required')
  } else {
    push('### ❌ QA VERDICT: REJECTED')
  }
  push('')

  // 3. Summary table (structured)
  if (isStructured && report.summary) {
    const s = report.summary
    const b = s.bugs || {}
    const bugDetail = b.total != null
      ? `${b.total} — ${b.critical ?? 0} BLOCKER, ${b.high ?? 0} CRITICAL, ${b.medium ?? 0} MAJOR, ${b.low ?? 0} MINOR`
      : '0 — 0 BLOCKER, 0 CRITICAL, 0 MAJOR, 0 MINOR'
    push('| Metric | Count |')
    push('|---|---|')
    push(`| Total Scenarios | ${s.total ?? 0} |`)
    push(`| ✅ Passed | ${s.passed ?? 0} |`)
    push(`| ❌ Failed | ${s.failed ?? 0} |`)
    push(`| 🟡 Partial | ${s.partial ?? 0} |`)
    push(`| ⏭ Skipped | ${s.skipped ?? 0} |`)
    push(`| 🐛 Bugs Found | ${bugDetail} |`)
    push('')
  }

  // 4. How to test (legacy)
  if (!isStructured && report.howToTest?.length) {
    push('## How to Test')
    report.howToTest.forEach((step, i) => push(`${i + 1}. ${step}`))
    push('')
    if (report.testUrl) { push(`**Test URL:** ${report.testUrl}`); push('') }
  }

  // 5. MR diff analysis
  if (report.mrChangeSummary) {
    push('<details><summary>🔍 MR Diff Analysis</summary>')
    push('')
    push(report.mrChangeSummary)
    push('')
    push('</details>')
    push('')
  }

  // 6. Scenarios — card format with inline screenshots
  if (isStructured && report.scenarios?.length) {
    push('### 🧪 Test Results')
    push('')
    for (const s of report.scenarios) {
      const layer = s.layer || s.category || '—'
      push(`#### ${icon(s.status)} ${s.id || ''} \`${layer}\` — ${s.name}`)
      push('')
      if (s.steps?.length) {
        const stepsText = Array.isArray(s.steps) ? s.steps.join(' → ') : s.steps
        push(`- **Steps:** ${stepsText}`)
      }
      if (s.expected) { push(`- **Expected:** ${cell(s.expected)}`) }
      if (s.actual) { push(`- **Actual:** ${cell(s.actual)}`) }
      push(`- **Status:** ${icon(s.status)} ${s.status}`)
      if (s.acCoverage || s.ac) { push(`- **AC Coverage:** ${s.acCoverage || s.ac}`) }
      push('')
      if (s.screenshots?.length) {
        for (const screenshotPath of s.screenshots) {
          const md = await uploadImage(screenshotPath)
          if (md) { push(md); push('') }
        }
      }
    }
  }

  // 7. Legacy scenarios (with per-scenario screenshot uploads)
  if (!isStructured && report.scenarios?.length) {
    push('## Scenarios Executed')
    push('')
    for (const scenario of report.scenarios) {
      const statusIcon = scenario.status === 'PASS' ? '✅' : '❌'
      push(`### ${statusIcon} ${scenario.name}`)
      push('')
      if (scenario.steps?.length) {
        push('**Steps:**')
        scenario.steps.forEach((step) => push(`- ${step}`))
        push('')
      }
      if (scenario.expected) { push(`**Expected:** ${scenario.expected}`) }
      if (scenario.actual) { push(`**Actual:** ${scenario.actual}`) }
      push(`**Status:** ${statusIcon} ${scenario.status}`)
      push('')
      if (scenario.screenshots?.length) {
        for (const screenshotPath of scenario.screenshots) {
          const md = await uploadImage(screenshotPath)
          if (md) { push(md); push('') }
        }
      }
      push('---')
      push('')
    }
  }

  // 8. Bug reports (with per-bug screenshot uploads)
  if (report.bugs?.length) {
    push('### 🐛 Bug Reports')
    push('')
    for (const bug of report.bugs) {
      const bugTitle = (bug.title || bug.name || 'Untitled Bug').replace(/#(\d)/g, '#\u200B$1')
      push(`**${bugTitle}**`)
      if (bug.severity) { push(`**Severity:** ${bug.severity}`) }
      if (bug.steps) {
        const stepsText = Array.isArray(bug.steps) ? bug.steps.join(' → ') : bug.steps
        push(`**Steps:** ${stepsText}`)
      }
      if (bug.expected) { push(`**Expected:** ${bug.expected}`) }
      if (bug.actual) { push(`**Actual:** ${bug.actual}`) }
      if (bug.impact) { push(`**Impact:** ${bug.impact}`) }
      push('')
      if (bug.screenshots?.length) {
        for (const screenshotPath of bug.screenshots) {
          const md = await uploadImage(screenshotPath)
          if (md) { push(md); push('') }
        }
      }
      push('---')
      push('')
    }
  } else if (isStructured) {
    push('### 🐛 Bug Reports')
    push('')
    push('**No bugs found.** All acceptance criteria met.')
    push('')
    if (report.consoleErrors || report.networkErrors) {
      push('> **Console/page errors noted (pre-existing — NOT introduced by this MR):**')
      if (report.consoleErrors) { push(`> ${report.consoleErrors}`) }
      if (report.networkErrors) { push(`> ${report.networkErrors}`) }
      push('')
    }
  }

  // 9. Acceptance criteria coverage
  if (report.acceptanceCriteria?.length) {
    push('### 📋 Acceptance Criteria Coverage')
    push('')
    push('| AC # | Requirement | Test Cases | Status |')
    push('|---|---|---|---|')
    for (const ac of report.acceptanceCriteria) {
      const relatedTCs = report.scenarios
        ?.filter((s) => s.acCoverage === ac.id || s.ac === ac.id)
        .map((s) => s.id)
        .join(', ') || '—'
      push(`| ${cell(ac.id)} | ${cell(ac.requirement)} | ${cell(relatedTCs)} | ${icon(ac.status)} ${cell(ac.status)} |`)
    }
    push('')
  }

  // 10. Viewport summary
  if (report.viewportSummary?.length) {
    push('### 📱 Viewport Summary')
    push('')
    push('| Viewport | Tested | Issues Found |')
    push('|---|---|---|')
    for (const v of report.viewportSummary) {
      const testedIcon = v.tested === true ? '✅' : '⏭ not required'
      push(`| ${cell(v.viewport)} | ${testedIcon} | ${cell(v.issuesFound || 'N/A')} |`)
    }
    push('')
  }

  // 11. Video evidence
  const videoCandidates = [
    report.videoClip,
    report.video,
    report.videoPath,
    report.videoFull
  ].filter(Boolean)

  const chosenFit = videoCandidates.find(p => existsSync(p) && statSync(p).size <= VIDEO_LIMIT_BYTES)
  const chosenAny = videoCandidates.find(p => existsSync(p))
  const chosenVideoPath = chosenFit || chosenAny || null

  if (chosenVideoPath) {
    const isClip = chosenVideoPath === report.videoClip
      || (report.videoFull && chosenVideoPath !== report.videoFull)
    push('### 🎬 Video Evidence')
    push('')
    const result = await uploadVideo(chosenVideoPath)
    if (result && result.markdown) {
      const label = isClip ? 'Focused clip' : 'Full session recording'
      push(result.markdown)
      push('')
      push(isClip
        ? `_${label} — covers core acceptance-criteria steps from the test session._`
        : `_${label} — covers the complete test flow from page load to final assertion._`)
    } else {
      const sizeMB = existsSync(chosenVideoPath)
        ? (statSync(chosenVideoPath).size / 1024 / 1024).toFixed(1)
        : '?'
      const absPath = resolve(chosenVideoPath)
      const fileUrl = `file://${absPath.startsWith('/') ? absPath : `/${absPath}`}`
      const reason = result?.reason || 'unknown'
      if (reason === 'too_large') {
        push(`> ⚠️ **Video too large to upload** — ${sizeMB} MB (GitLab limit: ${VIDEO_LIMIT_MB} MB). Compression was attempted once but could not reduce it below the limit.`)
      } else if (reason === 'not_found') {
        push('> ⚠️ **Video file not found** — recording may have been skipped or path is incorrect.')
      } else {
        push(`> ⚠️ **Video upload failed** — ${sizeMB} MB. The video is saved locally.`)
      }
      push(`> 🎬 **[⬇️ Download Session Recording](${fileUrl})** — opens the video locally.`)
      push(`> 📂 Path: \`${absPath}\``)
    }
    push('')
  }

  // 12. Observations
  if (report.observations?.length) {
    push('### 💡 Observations')
    push('')
    const obs = Array.isArray(report.observations) ? report.observations : [report.observations]
    obs.forEach((o) => push(`- ${o}`))
    push('')
  }

  // 13. Console errors (collapsed)
  if (report.consoleErrors && isStructured) {
    push('<details><summary>Console Errors</summary>')
    push('')
    push('```')
    push(report.consoleErrors)
    push('```')
    push('</details>')
    push('')
  }

  // 14. Automation gap
  if (report.automationGap) {
    const gap = report.automationGap
    push('### 🔄 Automated Test Coverage Gap (informational)')
    push('')
    if (gap.recommendation) { push(gap.recommendation) }
    push('')
    if (gap.existingCoverage?.length) {
      push('**Existing coverage:**')
      gap.existingCoverage.forEach((c) => push(`- \`${c}\``))
      push('')
    }
    if (gap.missingScenarios?.length) {
      push('**Missing Gherkin scenarios:**')
      gap.missingScenarios.forEach((s) => push(`- ${s}`))
      push('')
    }
  }

  // 15. Feature file attachment (Gherkin)
  // Resolution: explicit path from JSON → scan ticket folder for any .feature file
  const prefix = report.type === 'issue' ? 'ISSUE' : 'MR'
  const ticketFolder = `${prefix}-${report.id}`

  let featureFilePath = null
  // 1. Explicit path from report JSON (highest priority)
  if (report.featureFile && existsSync(report.featureFile)) {
    featureFilePath = report.featureFile
  }
  // 2. Scan the ticket folder for any .feature file
  if (!featureFilePath && existsSync(ticketFolder)) {
    try {
      const files = readdirSync(ticketFolder)
      const featureFile = files.find(f => f.endsWith('.feature'))
      if (featureFile) {
        featureFilePath = `${ticketFolder}/${featureFile}`
      }
    } catch (_) { /* folder not readable — skip */ }
  }

  if (featureFilePath && existsSync(featureFilePath)) {
    const featureContent = readFileSync(featureFilePath, 'utf8')
    push('### 📄 Gherkin Feature File')
    push('')
    push(`<details><summary>📄 ${basename(featureFilePath)} — click to expand</summary>`)
    push('')
    push('```gherkin')
    push(featureContent.trim())
    push('```')
    push('')
    push('</details>')
    push('')
  }

  // 16. Conclusion (legacy)
  if (report.conclusion && !isStructured) {
    push('## Conclusion')
    push(report.conclusion)
    push('')
  }

  // 17. Footer
  push('---')
  push('')
  const footerParts = ['Tested by: Copilot QA Agent (autonomous)']
  if (report.id) { footerParts.push(`MR !${report.id}`) }
  if (report.locale) { footerParts.push(`${report.locale} locale`) }
  if (report.viewport) { footerParts.push(report.viewport) }
  if (report.testDate) { footerParts.push(report.testDate) }
  push(`_${footerParts.join(' | ')}_`)
  push('')

  return L.join('\n')
}

// ── Tool definitions ──────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'fetch_mr',
        description: 'Fetch a GitLab Merge Request by ID — returns title, description, labels, testUrl, howToTest, credentials',
        inputSchema: {
          type: 'object',
          properties: {
            mr_id: { type: 'number', description: 'Merge Request IID (e.g. 79)' }
          },
          required: ['mr_id']
        }
      },
      {
        name: 'fetch_issue',
        description: 'Fetch a GitLab Issue by ID',
        inputSchema: {
          type: 'object',
          properties: {
            issue_id: { type: 'number', description: 'Issue IID (e.g. 42)' }
          },
          required: ['issue_id']
        }
      },
      {
        name: 'get_mr_diff',
        description: 'Fetch the file diff for a GitLab Merge Request — use this to analyse what changed',
        inputSchema: {
          type: 'object',
          properties: {
            mr_id: { type: 'number', description: 'Merge Request IID' }
          },
          required: ['mr_id']
        }
      },
      {
        name: 'post_comment',
        description: 'Post a plain Markdown comment on a GitLab MR or Issue (no file uploads)',
        inputSchema: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['mr', 'issue'], description: 'Target type' },
            id: { type: 'number', description: 'MR or Issue IID' },
            comment: { type: 'string', description: 'Markdown comment body' }
          },
          required: ['type', 'id', 'comment']
        }
      },
      {
        name: 'post_qa_report',
        description: 'Read a qa-report.json file, upload all screenshots and video to GitLab, and post a fully-rendered QA report comment on an MR or Issue',
        inputSchema: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['mr', 'issue'], description: 'Target type' },
            id: { type: 'number', description: 'MR or Issue IID' },
            report_path: {
              type: 'string',
              description: 'Path to the qa-report.json file. Defaults to MR-{id}/qa-report.json or ISSUE-{id}/qa-report.json if omitted.'
            }
          },
          required: ['type', 'id']
        }
      },
      {
        name: 'update_labels',
        description: 'Replace labels on a GitLab MR or Issue (removes old labels, adds new ones)',
        inputSchema: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['mr', 'issue'] },
            id: { type: 'number', description: 'MR or Issue IID' },
            add_labels: { type: 'array', items: { type: 'string' }, description: 'Labels to add' },
            remove_labels: { type: 'array', items: { type: 'string' }, description: 'Labels to remove' }
          },
          required: ['type', 'id']
        }
      },
      {
        name: 'get_mr_comments',
        description: 'List existing comments on a GitLab MR',
        inputSchema: {
          type: 'object',
          properties: {
            mr_id: { type: 'number', description: 'Merge Request IID' }
          },
          required: ['mr_id']
        }
      }
    ]
  }
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseHowToTest (description = '') {
  const sectionMatch = description.match(/##\s+How to test\s*\n([\s\S]*?)(?=\n##\s|\n---\s|$)/i)
  const section = sectionMatch ? sectionMatch[1] : description

  const steps = []
  for (const match of section.matchAll(/^[\s]*[-*]\s+(.+)/gm)) { steps.push(match[1].trim()) }

  const testUrlMatch = description.match(/\*\*Test URL\*\*[:\s]+\[?(https?:\/\/[^\s\])\n]+)/i)
  const testUrl = testUrlMatch ? testUrlMatch[1].trim() : null

  const usernameMatch = description.match(/Username[:\s]+([^\s\n]+)/i)
  const passwordMatch = description.match(/Password[:\s]*([^\s\n]+)/i)
  let username = usernameMatch ? usernameMatch[1] : null
  let password = passwordMatch ? passwordMatch[1] : null

  if (!username && testUrl) {
    const basicAuth = testUrl.match(/https?:\/\/([^:@\s]+):([^@\s]+)@/)
    if (basicAuth) { username = basicAuth[1]; password = basicAuth[2] }
  }

  return { steps, testUrl, username, password }
}

// ── Tool handlers ─────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  // ── fetch_mr ────────────────────────────────────────────────────────────────
  if (name === 'fetch_mr') {
    try {
      const data = await glFetch(`/projects/${encodedProjectId()}/merge_requests/${args.mr_id}`)
      const howToTest = parseHowToTest(data.description)

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            id: data.iid,
            type: 'merge_request',
            title: data.title,
            description: data.description || '',
            state: data.state,
            labels: data.labels || [],
            author: data.author?.name || 'Unknown',
            web_url: data.web_url,
            created_at: data.created_at,
            updated_at: data.updated_at,
            ticketFolder: `MR-${data.iid}`,
            howToTest: howToTest.steps,
            testUrl: howToTest.testUrl,
            credentials: howToTest.username
              ? { username: howToTest.username, password: howToTest.password }
              : null
          })
        }]
      }
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }
    }
  }

  // ── fetch_issue ─────────────────────────────────────────────────────────────
  if (name === 'fetch_issue') {
    try {
      const data = await glFetch(`/projects/${encodedProjectId()}/issues/${args.issue_id}`)
      const howToTest = parseHowToTest(data.description)

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            id: data.iid,
            type: 'issue',
            title: data.title,
            description: data.description || '',
            state: data.state,
            labels: data.labels || [],
            author: data.author?.name || 'Unknown',
            web_url: data.web_url,
            created_at: data.created_at,
            ticketFolder: `ISSUE-${data.iid}`,
            howToTest: howToTest.steps,
            testUrl: howToTest.testUrl,
            credentials: howToTest.username
              ? { username: howToTest.username, password: howToTest.password }
              : null
          })
        }]
      }
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }
    }
  }

  // ── get_mr_diff ─────────────────────────────────────────────────────────────
  if (name === 'get_mr_diff') {
    try {
      const changes = await glFetch(`/projects/${encodedProjectId()}/merge_requests/${args.mr_id}/changes`)

      const files = (changes.changes || []).map(c => ({
        path: c.new_path,
        renamed: c.renamed_file,
        deleted: c.deleted_file,
        added: c.new_file,
        diff_snippet: c.diff ? c.diff.slice(0, 500) : ''
      }))

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ mr_id: args.mr_id, total_files: files.length, files })
        }]
      }
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }
    }
  }

  // ── post_comment ────────────────────────────────────────────────────────────
  if (name === 'post_comment') {
    try {
      const resource = args.type === 'mr' ? 'merge_requests' : 'issues'
      const data = await glFetch(
        `/projects/${encodedProjectId()}/${resource}/${args.id}/notes`,
        { method: 'POST', body: JSON.stringify({ body: args.comment }) }
      )
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: true, comment_id: data.id, created_at: data.created_at })
        }]
      }
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }
    }
  }

  // ── post_qa_report ──────────────────────────────────────────────────────────
  if (name === 'post_qa_report') {
    try {
      const prefix = args.type === 'mr' ? 'MR' : 'ISSUE'
      const reportPath = args.report_path || `${prefix}-${args.id}/qa-report.json`

      if (!existsSync(reportPath)) {
        return {
          content: [{ type: 'text', text: `Error: Report file not found: ${reportPath}` }],
          isError: true
        }
      }

      const report = JSON.parse(readFileSync(reportPath, 'utf8'))

      process.stderr.write('\n📝 Building Markdown comment with screenshot uploads…\n')
      const markdownBody = await buildMarkdownComment(report)

      const resource = args.type === 'mr' ? 'merge_requests' : 'issues'
      const endpoint = `/projects/${encodedProjectId()}/${resource}/${args.id}/notes`

      const response = await fetch(`${GITLAB_API_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'PRIVATE-TOKEN': GITLAB_TOKEN,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ body: markdownBody })
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`GitLab API error (${response.status}): ${errorText}`)
      }

      const data = await response.json()

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            comment_id: data.id,
            author: data.author?.name,
            created_at: data.created_at,
            report_path: reportPath
          })
        }]
      }
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }
    }
  }

  // ── update_labels ───────────────────────────────────────────────────────────
  if (name === 'update_labels') {
    try {
      const resource = args.type === 'mr' ? 'merge_requests' : 'issues'
      const payload = {}
      if (args.add_labels?.length) { payload.add_labels = args.add_labels.join(',') }
      if (args.remove_labels?.length) { payload.remove_labels = args.remove_labels.join(',') }

      const data = await glFetch(
        `/projects/${encodedProjectId()}/${resource}/${args.id}`,
        { method: 'PUT', body: JSON.stringify(payload) }
      )

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ success: true, labels: data.labels })
        }]
      }
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }
    }
  }

  // ── get_mr_comments ─────────────────────────────────────────────────────────
  if (name === 'get_mr_comments') {
    try {
      const notes = await glFetch(`/projects/${encodedProjectId()}/merge_requests/${args.mr_id}/notes?per_page=50&order_by=created_at&sort=desc`)

      const comments = notes.map(n => ({
        id: n.id,
        author: n.author?.name || 'Unknown',
        created_at: n.created_at,
        body: n.body?.slice(0, 300) || ''
      }))

      return {
        content: [{ type: 'text', text: JSON.stringify({ total: comments.length, comments }) }]
      }
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true }
    }
  }

  throw new Error(`Unknown tool: ${name}`)
});

(async () => {
  const transport = new StdioServerTransport()
  await server.connect(transport)
})()

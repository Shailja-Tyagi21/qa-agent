#!/usr/bin/env node
/**
 * suite-index.js — writes reports/suite-index.json
 *
 *   npm run index
 *
 * This is the bridge between the test suite and the qa-agent agent. It answers
 * two questions the agent cannot answer by guessing:
 *
 *   1. What step vocabulary already exists? (so generated Gherkin composes from
 *      real, implemented steps instead of inventing prose nobody can run)
 *   2. What is already covered? (so the automation gap is a genuine diff rather
 *      than "no automation exists")
 *
 * It parses source rather than executing it, so it is safe to run anywhere and
 * does not need a browser.
 */

const fs = require('node:fs')
const path = require('node:path')

const ROOT = process.cwd()
const STEP_DIRS = ['steps', 'support']
const FEATURE_DIR = 'features'
const OUT = path.join(ROOT, 'reports', 'suite-index.json')

// ── step definitions ─────────────────────────────────────────────────────────

const STEP_RE = /\b(Given|When|Then)\s*\(\s*(['"`])((?:\\.|(?!\2).)*)\2/g
const PARAM_RE = /\{(string|int|float|word)\}/g

function walk (dir, ext, acc = []) {
  const abs = path.join(ROOT, dir)
  if (!fs.existsSync(abs)) return acc
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(rel, ext, acc)
    else if (entry.name.endsWith(ext)) acc.push(rel)
  }
  return acc
}

function collectSteps () {
  const steps = []
  for (const dir of STEP_DIRS) {
    for (const file of walk(dir, '.js')) {
      const src = fs.readFileSync(path.join(ROOT, file), 'utf8')
      let m
      STEP_RE.lastIndex = 0
      while ((m = STEP_RE.exec(src)) !== null) {
        const pattern = m[3]
        steps.push({
          keyword: m[1],
          pattern,
          params: (pattern.match(PARAM_RE) || []).map(p => p.slice(1, -1)),
          source: file
        })
      }
    }
  }
  return steps.sort((a, b) => a.pattern.localeCompare(b.pattern))
}

// ── registries (named elements / collections / pages) ────────────────────────

function collectRegistry () {
  try {
    const pages = require(path.join(ROOT, 'support', 'pages.js'))
    return {
      pages: Object.keys(pages.pages || {}),
      elements: Object.keys(pages.elements || {}),
      collections: Object.keys(pages.collections || {})
    }
  } catch (e) {
    return { pages: [], elements: [], collections: [], error: e.message }
  }
}

// ── existing feature coverage ────────────────────────────────────────────────

function collectFeatures (opts = {}) {
  const wantGenerated = !!opts.generated
  const features = []
  for (const file of walk(FEATURE_DIR, '.feature')) {
    // Agent output is not "existing coverage" — it is the thing being measured
    // against existing coverage. Keep the two sets apart or the gap analysis
    // congratulates itself on work it just did.
    const isGenerated = file.includes(`${path.sep}generated${path.sep}`)
    if (isGenerated !== wantGenerated) continue
    const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n')
    const entry = { file, feature: null, tags: [], scenarios: [] }
    let pendingTags = []

    for (const raw of lines) {
      const line = raw.trim()
      if (line.startsWith('@')) {
        pendingTags = line.split(/\s+/).filter(t => t.startsWith('@'))
      } else if (/^Feature:/.test(line)) {
        entry.feature = line.replace(/^Feature:\s*/, '')
        entry.tags = pendingTags
        pendingTags = []
      } else if (/^Scenario( Outline)?:/.test(line)) {
        entry.scenarios.push({
          name: line.replace(/^Scenario( Outline)?:\s*/, ''),
          tags: pendingTags,
          steps: []
        })
        pendingTags = []
      } else if (/^(Given|When|Then|And|But)\s/.test(line) && entry.scenarios.length) {
        entry.scenarios.at(-1).steps.push(line)
      }
    }
    features.push(entry)
  }
  return features
}

// ── declared coverage limits ─────────────────────────────────────────────────

/**
 * COVERAGE.md records what the suite deliberately does not cover. Feeding this
 * to the agent lets it distinguish "nobody has automated this yet" from
 * "someone decided not to automate this" — a distinction that matters when the
 * gap analysis turns into a backlog.
 */
function collectKnownGaps () {
  const file = path.join(ROOT, FEATURE_DIR, 'COVERAGE.md')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .filter(l => /^\s*-\s*\[\s*\]/.test(l))
    .map(l => l.replace(/^\s*-\s*\[\s*\]\s*/, '').trim())
}

// ── main ─────────────────────────────────────────────────────────────────────

const steps = collectSteps()
const features = collectFeatures()
const generated = collectFeatures({ generated: true })
const registry = collectRegistry()
const knownGaps = collectKnownGaps()

const scenarioCount = features.reduce((n, f) => n + f.scenarios.length, 0)

const index = {
  generatedAt: new Date().toISOString(),
  root: path.basename(ROOT),
  framework: 'cucumber-js + playwright',
  counts: {
    stepDefinitions: steps.length,
    featureFiles: features.length,
    scenarios: scenarioCount,
    generatedFeatureFiles: generated.length,
    knownGaps: knownGaps.length
  },
  registry,
  steps,
  features,
  generated,
  knownGaps,
  usage: 'qa-agent reads this before writing {ticketId}.feature. Compose generated scenarios from steps[].pattern where possible; tag any step with no match @todo.'
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(index, null, 2))

console.log(`\n📇 Suite index → ${path.relative(ROOT, OUT)}`)
console.log(`   ${steps.length} step definitions across ${new Set(steps.map(s => s.source)).size} files`)
console.log(`   ${features.length} baseline feature files, ${scenarioCount} scenarios`)
if (generated.length) console.log(`   ${generated.length} generated feature file(s) — excluded from existing coverage`)
console.log(`   ${registry.elements.length} named elements, ${registry.collections.length} collections, ${registry.pages.length} pages`)
if (knownGaps.length) console.log(`   ${knownGaps.length} declared coverage gaps (features/COVERAGE.md)`)
if (registry.error) console.log(`   ⚠ registry load failed: ${registry.error}`)
console.log('')

#!/usr/bin/env node
/**
 * Gut Check — git diff risk analyzer
 * Single-file prototype. Run: node gut-check.js
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// ─── Hardcoded Scenarios ────────────────────────────────────────────────────

const SCENARIOS = [
  {
    id: 1,
    label: "Overconfident",
    confidence: 5,
    confidenceStatement: "Tested happy path manually",
    // Inject synthetic diff that touches a sensitive path
    syntheticFiles: [
      {
        path: "src/auth/login.js",
        added: [
          "  if (user.role === 'admin') {",
          "    bypassMFA = true;",
          "  } else if (user.role === 'superuser') {",
          "    bypassMFA = true;",
          "  } else {",
          "    requireMFA(user);",
          "  }",
          "  const token = generateToken(user.id, { expiry: '30d' });",
          "  session.set('auth_token', token);",
          "  auditLog.record(user.id, 'login', { ip: req.ip });",
          "  if (featureFlags.newAuthFlow) {",
          "    return newLoginFlow(user);",
          "  }",
          "  return legacyLoginFlow(user);",
          "  // TODO: remove legacy flow after migration",
          "  // switch (user.provider) {",
          "  //   case 'google': ...",
          "  //   case 'github': ...",
          "  // }",
          "  metrics.increment('auth.login.success');",
          "  notify.slack('#security', `Login: ${user.email}`);",
          "  return res.json({ token, user: sanitize(user) });",
        ],
        removed: [
          "  const token = generateToken(user.id);",
          "  return res.json({ token });",
        ],
        testFileTouched: false,
      },
    ],
  },
  {
    id: 2,
    label: "Calibrated",
    confidence: 2,
    confidenceStatement: "Not sure about DB migration",
    syntheticFiles: [
      {
        path: "db/migrations/0042_add_user_roles.sql",
        added: [
          "ALTER TABLE users ADD COLUMN role VARCHAR(32) DEFAULT 'viewer';",
          "UPDATE users SET role = 'admin' WHERE is_admin = TRUE;",
          "CREATE INDEX idx_users_role ON users(role);",
          "ALTER TABLE sessions ADD COLUMN last_ip INET;",
          "UPDATE sessions SET last_ip = '0.0.0.0' WHERE last_ip IS NULL;",
        ],
        removed: [],
        testFileTouched: false,
      },
    ],
  },
  {
    id: 3,
    label: "Underconfident",
    confidence: 1,
    confidenceStatement: "Nervous about breaking CSS",
    syntheticFiles: [
      {
        path: "src/components/Button.css",
        added: [
          ".btn { border-radius: 4px; }",
          ".btn-primary { background: #3b82d4; color: #fff; }",
          ".btn-primary:hover { background: #2563eb; }",
        ],
        removed: [
          ".btn { border-radius: 2px; }",
          ".btn-primary { background: blue; }",
        ],
        testFileTouched: false,
      },
    ],
  },
  {
    id: 4,
    label: "Near-Miss Edge Case",
    confidence: 3,
    confidenceStatement: "Tested standard user flow, modified payment route",
    syntheticFiles: [
      {
        path: "src/payments/gateway.js",
        added: [
          "  if (payment.method === 'card') {",
          "    return processCard(payment);",
          "  } else if (payment.method === 'wallet') {",
          "    return processWallet(payment);",
          "  } else {",
          "    return rejectPayment(payment, 'unsupported_method');",
          "  }",
        ],
        removed: [
          "  return processCard(payment);",
        ],
        testFileTouched: false,
      },
    ],
  },
];

// ─── Sensitive Path Patterns ─────────────────────────────────────────────────

const SENSITIVE_PATTERNS = [
  /auth/i,
  /payment/i,
  /migration/i,
  /config/i,
  /\/db\//i,
  /\.env/i,
  /secret/i,
  /credential/i,
];

// ─── Risk Detector ───────────────────────────────────────────────────────────

function detectSensitivePaths(files) {
  const hits = [];
  for (const f of files) {
    for (const pat of SENSITIVE_PATTERNS) {
      if (pat.test(f.path)) {
        hits.push({ file: f.path, pattern: pat.toString() });
        break;
      }
    }
  }
  return hits;
}

function detectTestCoverage(files) {
  const sourceFiles = files.filter(
    (f) => !/\.(test|spec)\.[jt]sx?$/.test(f.path)
  );
  const testFiles = files.filter((f) =>
    /\.(test|spec)\.[jt]sx?$/.test(f.path)
  );
  const testPaths = new Set(testFiles.map((f) => f.path));

  const untested = sourceFiles.filter((f) => {
    const base = f.path.replace(/\.[jt]sx?$/, "").replace(/\.[a-z]+$/, "");
    const covered =
      f.testFileTouched ||
      [...testPaths].some(
        (t) => t.includes(path.basename(base)) || t.includes(base)
      );
    return !covered;
  });

  return {
    hasTests: testFiles.length > 0 || files.some((f) => f.testFileTouched),
    untestedFiles: untested.map((f) => f.path),
  };
}

function detectComplexity(files) {
  const flags = [];
  for (const f of files) {
    const addedLines = f.added.length;
    const branchCount = f.added.filter((line) =>
      /\b(if|else|switch|case|catch|&&|\|\|)\b/.test(line)
    ).length;

    if (addedLines > 20) {
      flags.push({
        file: f.path,
        reason: `${addedLines} lines added (threshold: 20)`,
      });
    } else if (branchCount >= 3) {
      flags.push({
        file: f.path,
        reason: `${branchCount} branch/logic keywords introduced`,
      });
    }
  }
  return flags;
}

// ─── Risk Score ──────────────────────────────────────────────────────────────

function computeRisk(sensitiveHits, coverageResult, complexityFlags) {
  let score = 0;
  if (sensitiveHits.length > 0) score += 2;
  if (!coverageResult.hasTests && coverageResult.untestedFiles.length > 0)
    score += 1;
  if (complexityFlags.length > 0) score += 1;
  // 0-1 = Low, 2-3 = Medium, 4 = High
  if (score >= 3) return { level: "HIGH", score };
  if (score >= 2) return { level: "MEDIUM", score };
  return { level: "LOW", score };
}

// ─── Verdict ─────────────────────────────────────────────────────────────────

function verdict(confidence, riskLevel) {
  const highConf = confidence >= 4;
  const midConf = confidence === 3;
  const lowConf = confidence <= 2;
  const highRisk = riskLevel === "HIGH";
  const medRisk = riskLevel === "MEDIUM";
  const lowRisk = riskLevel === "LOW";

  // High confidence + any elevated risk, OR mid confidence + strictly high risk
  if ((highConf && (highRisk || medRisk)) || (midConf && highRisk))
    return {
      emoji: "⚠️",
      label: "OVERCONFIDENT BLIND SPOT",
      summary:
        "Developer confidence is high but the diff contains significant risk signals. Consider a deeper review or adding tests.",
    };
  if (lowConf && lowRisk)
    return {
      emoji: "🐢",
      label: "UNDERCONFIDENT",
      summary:
        "Developer confidence is low but the change appears low-risk. This might be self-doubt rather than actual danger.",
    };
  return {
    emoji: "✅",
    label: "CALIBRATED",
    summary:
      "Confidence aligns with the detected risk level. The developer's gut feeling matches the signals in the diff.",
  };
}

// ─── Blind-Spot Narrative ────────────────────────────────────────────────────

function buildBlindSpotNarrative(scenario, sensitiveHits, complexityFlags, coverageResult) {
  if (sensitiveHits.length === 0 && complexityFlags.length === 0) return null;

  const touchedFile =
    sensitiveHits.length > 0 ? sensitiveHits[0].file : complexityFlags[0].file;
  const branchCount = complexityFlags.length > 0
    ? scenario.syntheticFiles
        .find((f) => f.path === complexityFlags[0].file)
        ?.added.filter((line) =>
          /\b(if|else|switch|case|catch|&&|\|\|)\b/.test(line)
        ).length ?? 0
    : 0;
  const testWord = coverageResult.hasTests ? "partial" : "0";

  return (
    `You reported "${scenario.confidenceStatement}", but the diff modifies ` +
    `\`${touchedFile}\`` +
    (branchCount > 0 ? ` with ${branchCount} new branches` : "") +
    ` and ${testWord} tests. ` +
    `Manual happy-path testing frequently misses these edge cases.`
  );
}

// ─── Report Generator ────────────────────────────────────────────────────────

function generateReport(scenario, sensitiveHits, coverageResult, complexityFlags, risk, v) {
  const files = scenario.syntheticFiles;
  const totalAdded = files.reduce((s, f) => s + f.added.length, 0);
  const totalRemoved = files.reduce((s, f) => s + f.removed.length, 0);

  const sensitiveSection =
    sensitiveHits.length > 0
      ? sensitiveHits
          .map((h) => `  - \`${h.file}\` matched pattern \`${h.pattern}\``)
          .join("\n")
      : "  - None detected";

  const untestedSection =
    coverageResult.untestedFiles.length > 0
      ? coverageResult.untestedFiles.map((f) => `  - \`${f}\``).join("\n")
      : "  - All modified source files appear to have corresponding tests, or no source files changed";

  const complexitySection =
    complexityFlags.length > 0
      ? complexityFlags.map((f) => `  - \`${f.file}\`: ${f.reason}`).join("\n")
      : "  - No complexity flags raised";

  const diffPreview = files
    .map((f) => {
      const added = f.added.map((l) => `+${l}`).join("\n");
      const removed = f.removed.map((l) => `-${l}`).join("\n");
      return `### \`${f.path}\`\n\`\`\`diff\n${removed ? removed + "\n" : ""}${added}\n\`\`\``;
    })
    .join("\n\n");

  const blindSpot =
    v.label === "OVERCONFIDENT BLIND SPOT"
      ? buildBlindSpotNarrative(scenario, sensitiveHits, complexityFlags, coverageResult)
      : null;

  return `# Gut Check Report — Scenario ${scenario.id}: ${scenario.label}

> Generated: ${new Date().toISOString()}

---

## Developer Input

| Field | Value |
|-------|-------|
| **Confidence Level** | ${scenario.confidence}/5 |
| **Confidence Statement** | "${scenario.confidenceStatement}" |
| **Files Changed** | ${files.length} |
| **Lines Added** | ${totalAdded} |
| **Lines Removed** | ${totalRemoved} |

---

## Diff Preview

${diffPreview}

---

## Risk Analysis

### Sensitive Path Detection
${sensitiveSection}

### Test Coverage Heuristic
${coverageResult.hasTests ? "✅ Test files were modified alongside source changes." : "❌ No corresponding `.test.` or `.spec.` files were detected in this diff."}
${untestedSection}

### Complexity Heuristic
${complexitySection}

### Overall Risk Score
| Dimension | Signal |
|-----------|--------|
| Sensitive paths hit | ${sensitiveHits.length} |
| Untested source files | ${coverageResult.untestedFiles.length} |
| Complexity flags | ${complexityFlags.length} |
| **Risk Score** | **${risk.score} → ${risk.level}** |

---

## Verdict

# ${v.emoji} ${v.label}

**${v.summary}**

### Why?
- Confidence: **${scenario.confidence}/5** (${scenario.confidence >= 4 ? "High" : scenario.confidence <= 2 ? "Low" : "Medium"})
- Risk Level: **${risk.level}** (score: ${risk.score}/4)
${sensitiveHits.length > 0 ? `- Touched sensitive path(s): ${sensitiveHits.map((h) => `\`${h.file}\``).join(", ")}` : "- No sensitive paths detected"}
${complexityFlags.length > 0 ? `- Complexity flags: ${complexityFlags.map((f) => `\`${f.file}\``).join(", ")}` : "- No complexity issues flagged"}
${!coverageResult.hasTests ? "- ⚠️ No test files modified — risky change without test coverage signal" : "- Test files included in diff"}
${blindSpot ? `\n> 🔍 **Blind-Spot Detail:** ${blindSpot}` : ""}

---

*Gut Check — confidence vs. reality, measured.*
`;
}

// ─── HTML Dashboard Generator ────────────────────────────────────────────────

function verdictBadge(label) {
  if (label === "OVERCONFIDENT BLIND SPOT")
    return `<span class="badge badge-red">⚠ OVERCONFIDENT BLIND SPOT</span>`;
  if (label === "UNDERCONFIDENT")
    return `<span class="badge badge-blue">UNDERCONFIDENT</span>`;
  return `<span class="badge badge-green">✓ CALIBRATED</span>`;
}

function generateDashboard(rows) {
  const overconfident = rows.filter(r => r.v.label === "OVERCONFIDENT BLIND SPOT").length;
  const calibrated    = rows.filter(r => r.v.label === "CALIBRATED").length;
  const underconf     = rows.filter(r => r.v.label === "UNDERCONFIDENT").length;

  const cards = rows.map(({ scenario, sensitiveHits, coverageResult, complexityFlags, risk, v }) => {
    const narrative = v.label === "OVERCONFIDENT BLIND SPOT"
      ? buildBlindSpotNarrative(scenario, sensitiveHits, complexityFlags, coverageResult)
      : v.summary;

    const filesBlock = scenario.syntheticFiles.map(f => {
      const added   = f.added.length;
      const removed = f.removed.length;
      const branches = complexityFlags.filter(c => c.file === f.path).reduce((a, c) => a + (c.branches || 0), 0);
      const testRatio = f.testFileTouched ? "1:1" : "0:1";
      return `
        <div class="diff-row">
          <span class="mono file-path">${f.path}</span>
          <div class="diff-meta">
            <span class="pill pill-green">+${added}</span>
            <span class="pill pill-red">-${removed}</span>
            <span class="pill pill-muted">branches: ${branches}</span>
            <span class="pill pill-muted">test ratio: ${testRatio}</span>
          </div>
        </div>`;
    }).join("");

    const riskCls = risk.level === "HIGH" ? "risk-high" : risk.level === "MEDIUM" ? "risk-medium" : "risk-low";
    const cardBorder = v.label === "OVERCONFIDENT BLIND SPOT"
      ? "card-border-red"
      : v.label === "UNDERCONFIDENT"
        ? "card-border-blue"
        : "card-border-green";

    return `
    <div class="scenario-card ${cardBorder}">
      <div class="card-header">
        <div class="card-title-row">
          <span class="scenario-id mono">#${scenario.id}</span>
          <span class="scenario-label">${scenario.label}</span>
        </div>
        <div class="card-badges">
          <span class="risk-pill ${riskCls}">${risk.level} RISK</span>
          ${verdictBadge(v.label)}
        </div>
      </div>

      <div class="card-body">
        <div class="block">
          <div class="block-label">DEV INPUT</div>
          <div class="dev-input-row">
            <div class="conf-box">
              <span class="conf-number mono">${scenario.confidence}<span class="conf-denom">/5</span></span>
              <span class="conf-sublabel">confidence</span>
            </div>
            <p class="dev-statement">"${scenario.confidenceStatement}"</p>
          </div>
        </div>

        <div class="block">
          <div class="block-label">DIFF ANALYSIS</div>
          <div class="diff-block">${filesBlock}</div>
        </div>

        <div class="block">
          <div class="block-label">NARRATIVE VERDICT</div>
          <div class="narrative-box">
            <p class="narrative">${narrative}</p>
          </div>
        </div>
      </div>
    </div>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>IBM Bob — Gut Check Dashboard</title>
<script src="https://cdn.tailwindcss.com"><\/script>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: -apple-system, "Segoe UI", system-ui, sans-serif;
    font-size: 14px;
    line-height: 1.6;
    background-color: #020817;
    background-image: url('./conny-schneider-xuTJZ7uD7PI-unsplash.jpg');
    background-size: cover;
    background-position: center;
    background-attachment: fixed;
    background-repeat: no-repeat;
    color: #cbd5e1;
    padding: 40px 20px 60px;
  }

  .wrapper { max-width: 1080px; margin: 0 auto; }

  /* ── Header ──────────────────────────── */
  header {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 32px;
    padding-bottom: 20px;
    border-bottom: 1px solid #1e293b;
  }
  .mascot {
    width: 52px; height: 52px;
    border-radius: 10px;
    border: 1px solid #1e293b;
    background: #0f172a;
    padding: 5px;
    object-fit: contain;
    flex-shrink: 0;
  }
  .header-text h1 {
    font-size: 20px;
    font-weight: 700;
    background: linear-gradient(90deg, #3b82f6, #818cf8);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    letter-spacing: -0.02em;
  }
  .header-text p {
    font-size: 12px;
    color: #475569;
    margin-top: 2px;
  }

  /* ── Metrics Bar ─────────────────────── */
  .metrics-bar {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    margin-bottom: 28px;
  }
  .metric-card {
    background: rgba(15,23,42,0.85);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(30,41,59,0.8);
    border-radius: 8px;
    padding: 16px 18px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  }
  .metric-card .metric-val {
    font-size: 36px;
    font-weight: 800;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    color: #ffffff;
  }
  .metric-card .metric-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 600;
    color: #94a3b8;
    margin-top: 6px;
  }
  .metric-total .metric-val  { color: #e2e8f0; }
  .metric-red   .metric-val  { color: #f87171; }
  .metric-green .metric-val  { color: #34d399; }
  .metric-blue  .metric-val  { color: #38bdf8; }

  /* ── Scenario Grid ───────────────────── */
  .scenario-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }

  .scenario-card {
    background: rgba(15,23,42,0.85);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-radius: 10px;
    border: 1px solid rgba(30,41,59,0.8);
    overflow: hidden;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  }
  .card-border-red   { border-left: 3px solid rgba(248,113,113,0.5); }
  .card-border-green { border-left: 3px solid rgba(52,211,153,0.5); }
  .card-border-blue  { border-left: 3px solid rgba(56,189,248,0.5); }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid rgba(30,41,59,0.8);
    background: rgba(10,15,29,0.7);
  }
  .card-title-row { display: flex; align-items: center; gap: 10px; }
  .scenario-id {
    font-size: 11px;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    color: #64748b;
  }
  .scenario-label {
    font-size: 14px;
    font-weight: 700;
    color: #f1f5f9;
  }
  .card-badges { display: flex; align-items: center; gap: 8px; }

  .card-body { padding: 16px; display: flex; flex-direction: column; gap: 16px; }

  /* ── Blocks inside card ──────────────── */
  .block-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.12em;
    color: #94a3b8;
    text-transform: uppercase;
    margin-bottom: 10px;
  }

  /* Dev Input */
  .dev-input-row { display: flex; align-items: flex-start; gap: 14px; }
  .conf-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    background: rgba(2,8,23,0.8);
    border: 1px solid rgba(30,41,59,0.6);
    border-radius: 8px;
    padding: 8px 14px;
    flex-shrink: 0;
  }
  .conf-number {
    font-size: 28px;
    font-weight: 900;
    color: #ffffff;
    line-height: 1;
  }
  .conf-denom { font-size: 14px; color: #64748b; }
  .conf-sublabel { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; margin-top: 4px; }
  .dev-statement {
    font-size: 14px;
    color: #e2e8f0;
    font-style: italic;
    font-weight: 500;
    padding-top: 4px;
    line-height: 1.65;
  }

  /* Diff Analysis */
  .diff-block {
    background: rgba(2,8,23,0.8);
    border: 1px solid rgba(30,41,59,0.6);
    border-radius: 6px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .diff-row { display: flex; flex-direction: column; gap: 6px; }
  .file-path {
    font-size: 13px;
    font-weight: 700;
    color: #7dd3fc;
    word-break: break-all;
  }
  .diff-meta { display: flex; flex-wrap: wrap; gap: 6px; }

  /* Narrative */
  .narrative-box {
    background: rgba(2,8,23,0.9);
    border: 1px solid rgba(100,116,139,0.35);
    border-radius: 8px;
    padding: 14px 16px;
    box-shadow: inset 0 1px 8px rgba(0,0,0,0.3);
  }
  .narrative {
    font-size: 15px;
    font-weight: 500;
    color: #f1f5f9;
    line-height: 1.7;
  }

  /* ── Pills & Badges ──────────────────── */
  .mono { font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; }

  .pill {
    display: inline-block;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: 600;
    white-space: nowrap;
  }
  .pill-green  { background: rgba(52,211,153,0.1);  color: #34d399; border: 1px solid rgba(52,211,153,0.2); }
  .pill-red    { background: rgba(248,113,113,0.1); color: #f87171; border: 1px solid rgba(248,113,113,0.2); }
  .pill-muted  { background: rgba(148,163,184,0.07); color: #64748b; border: 1px solid rgba(148,163,184,0.12); }

  .badge {
    display: inline-block;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    font-size: 11px;
    font-weight: 700;
    padding: 5px 12px;
    border-radius: 5px;
    white-space: nowrap;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .badge-red   { background: rgba(248,113,113,0.1); color: #f87171; border: 1px solid rgba(248,113,113,0.2); }
  .badge-green { background: rgba(52,211,153,0.1);  color: #34d399; border: 1px solid rgba(52,211,153,0.2); }
  .badge-blue  { background: rgba(56,189,248,0.1);  color: #38bdf8; border: 1px solid rgba(56,189,248,0.2); }

  .risk-pill {
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    font-size: 10px;
    font-weight: 700;
    padding: 3px 8px;
    border-radius: 4px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .risk-high   { background: rgba(248,113,113,0.1); color: #fca5a5; border: 1px solid rgba(248,113,113,0.2); }
  .risk-medium { background: rgba(251,191,36,0.1);  color: #fcd34d; border: 1px solid rgba(251,191,36,0.2); }
  .risk-low    { background: rgba(52,211,153,0.1);  color: #6ee7b7; border: 1px solid rgba(52,211,153,0.2); }

  /* ── Footer ──────────────────────────── */
  footer {
    margin-top: 40px;
    text-align: center;
    font-size: 11px;
    color: #334155;
    border-top: 1px solid #1e293b;
    padding-top: 16px;
  }

  @media (max-width: 720px) {
    .metrics-bar { grid-template-columns: repeat(2, 1fr); }
    .scenario-grid { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
<div class="fixed inset-0 pointer-events-none" style="position:fixed;inset:0;background:rgba(2,8,23,0.75);z-index:0;"></div>
<div class="wrapper" style="position:relative;z-index:10;">

  <header>
    <img src="./bob-standing-BECrMjXJ.webp" alt="IBM Bob Mascot" class="mascot">
    <div class="header-text">
      <h1>IBM Bob: Gut Check Dashboard</h1>
      <p>Pre-Deployment Risk Calibration vs. Developer Confidence &nbsp;·&nbsp; Generated: ${new Date().toISOString()}</p>
    </div>
  </header>

  <div class="metrics-bar">
    <div class="metric-card metric-total">
      <div class="metric-val">${rows.length}</div>
      <div class="metric-label">Total Scenarios</div>
    </div>
    <div class="metric-card metric-red">
      <div class="metric-val">${overconfident}</div>
      <div class="metric-label">Overconfident Blind Spots</div>
    </div>
    <div class="metric-card metric-green">
      <div class="metric-val">${calibrated}</div>
      <div class="metric-label">Calibrated</div>
    </div>
    <div class="metric-card metric-blue">
      <div class="metric-val">${underconf}</div>
      <div class="metric-label">Underconfident</div>
    </div>
  </div>

  <div class="scenario-grid">
${cards}
  </div>

  <footer>Made with IBM Bob</footer>
</div>
</body>
</html>`;
}

// ─── Main Runner ─────────────────────────────────────────────────────────────

function run() {
  console.log("🔍 Gut Check — analyzing scenarios...\n");

  const dashboardRows = [];

  for (const scenario of SCENARIOS) {
    console.log(`▶ Scenario ${scenario.id}: ${scenario.label}`);

    const files = scenario.syntheticFiles;

    const sensitiveHits = detectSensitivePaths(files);
    const coverageResult = detectTestCoverage(files);
    const complexityFlags = detectComplexity(files);
    const risk = computeRisk(sensitiveHits, coverageResult, complexityFlags);
    const v = verdict(scenario.confidence, risk.level);

    console.log(
      `  Confidence: ${scenario.confidence}/5 | Risk: ${risk.level} (score: ${risk.score})`
    );
    console.log(`  Verdict: ${v.emoji} ${v.label}`);

    const report = generateReport(
      scenario,
      sensitiveHits,
      coverageResult,
      complexityFlags,
      risk,
      v
    );

    const outPath = `REPORT_SCENARIO_${scenario.id}.md`;
    fs.writeFileSync(outPath, report, "utf8");
    console.log(`  ✅ Written: ${outPath}\n`);

    dashboardRows.push({ scenario, sensitiveHits, coverageResult, complexityFlags, risk, v });
  }

  const dashboard = generateDashboard(dashboardRows);
  const dashPath = "GUT_CHECK_DASHBOARD.html";
  fs.writeFileSync(dashPath, dashboard, "utf8");
  console.log(`✅ Written: ${dashPath}`);
  console.log("\nDone. All 4 reports + dashboard generated.");
}

// Only execute when run directly (not when require()'d by server.js)
if (require.main === module) {
  run();
}

module.exports = {
  detectSensitivePaths,
  detectTestCoverage,
  detectComplexity,
  computeRisk,
  verdict,
  buildBlindSpotNarrative,
};

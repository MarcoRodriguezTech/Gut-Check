"use strict";

const express = require("express");
const cors = require("cors");
const path = require("path");

// ─── Import risk functions from gut-check.js ─────────────────────────────────
const {
  detectSensitivePaths,
  detectTestCoverage,
  detectComplexity,
  computeRisk,
  verdict,
  buildBlindSpotNarrative,
} = require("./gut-check");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── Diff Parser ─────────────────────────────────────────────────────────────
// Converts a raw unified diff string into the file shape expected by gut-check.
function parseDiff(diffText) {
  const files = [];
  let current = null;

  for (const line of diffText.split("\n")) {
    // New file header: diff --git a/foo b/foo  OR  --- a/foo / +++ b/foo
    const fileMatch =
      line.match(/^diff --git a\/.+ b\/(.+)/) ||
      line.match(/^\+\+\+ b\/(.+)/);
    if (fileMatch) {
      const filePath = fileMatch[1].trim();
      // Avoid duplicates when both diff --git and +++ lines appear
      if (!current || current.path !== filePath) {
        current = {
          path: filePath,
          added: [],
          removed: [],
          testFileTouched: /\.(test|spec)\.[jt]sx?$/.test(filePath),
        };
        files.push(current);
      }
      continue;
    }
    if (!current) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.added.push(line.slice(1));
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      current.removed.push(line.slice(1));
    }
  }

  return files;
}

// ─── POST /api/analyze ────────────────────────────────────────────────────────
app.post("/api/analyze", (req, res) => {
  const { confidence, statement, diffText } = req.body;

  if (!confidence || !diffText) {
    return res
      .status(400)
      .json({ error: "confidence and diffText are required." });
  }

  const confidenceNum = parseInt(confidence, 10);
  if (isNaN(confidenceNum) || confidenceNum < 1 || confidenceNum > 5) {
    return res
      .status(400)
      .json({ error: "confidence must be an integer between 1 and 5." });
  }

  const files = parseDiff(diffText);

  if (files.length === 0) {
    return res
      .status(400)
      .json({ error: "Could not parse any files from the provided diff." });
  }

  const sensitiveHits = detectSensitivePaths(files);
  const coverageResult = detectTestCoverage(files);
  const complexityFlags = detectComplexity(files);
  const risk = computeRisk(sensitiveHits, coverageResult, complexityFlags);
  const v = verdict(confidenceNum, risk.level);

  // Build a minimal scenario-shaped object so buildBlindSpotNarrative works
  const scenario = {
    confidenceStatement: statement || "No statement provided",
    syntheticFiles: files,
  };

  const narrative =
    v.label === "OVERCONFIDENT BLIND SPOT"
      ? buildBlindSpotNarrative(scenario, sensitiveHits, complexityFlags, coverageResult)
      : v.summary;

  return res.json({
    riskLevel: risk.level,
    score: risk.score,
    verdict: v.label,
    verdictEmoji: v.emoji,
    narrative,
    metrics: {
      sensitiveHits,
      coverageResult,
      complexityFlags,
    },
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Gut Check server running → http://localhost:${PORT}`);
});

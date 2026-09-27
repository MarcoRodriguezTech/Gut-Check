# 🤖 Gut Check — AI Deployment Risk Calibrator

> **Built for IBM Bob 2 Hackathon** | Calibrating human developer confidence against real git diff risk signals.

---

## 🎯 The Problem
Developers frequently ship code feeling 100% confident, only for hidden edge cases, un-tested branch paths, or sensitive file modifications to trigger production outages. Standard linters detect syntax bugs, but no developer tool calibrates **human overconfidence** before code hits main.

## 💡 The Solution
**Gut Check** audits a developer's self-reported confidence statement against objective git diff heuristics:
* **Sensitive Path Detection:** Identifies critical routes (`auth/`, `payments/`, `db/migrations`).
* **Branch Complexity:** Detects new conditional paths (`if`, `else`, `switch`).
* **Test Ratio Analysis:** Checks if unit tests were added alongside code changes.

It instantly flags mismatches as **⚠️ OVERCONFIDENT BLIND SPOTS**, helping developers fix missing tests before merging.

---

## ✨ Features
* 📊 **Interactive Web Dashboard:** Test live diffs and self-assessments via `localhost:3000`.
* 📄 **Static Report Dashboard:** Compiles a standalone HTML scenario overview (`GUT_CHECK_DASHBOARD.html`).
* 🤖 **IBM Bob Proof Integration:** Fully documented task execution history under `bob_sessions/`.

---

## 🛠️ Tech Stack
* **Core Risk Engine:** Node.js
* **Backend:** Express.js API
* **Frontend:** Standalone HTML5 / Tailwind CSS (CDN)
* **Orchestration & AI Assistant:** IBM Bob IDE Agent Mode

---

## 🚀 Quickstart

### Prerequisites
* Node.js installed on your machine

### Installation & Running the Server

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/MarcoRodriguezTech/Gut-Check.git](https://github.com/MarcoRodriguezTech/Gut-Check.git)
   cd Gut-Check
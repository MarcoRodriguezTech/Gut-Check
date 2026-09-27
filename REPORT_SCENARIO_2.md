# Gut Check Report — Scenario 2: Calibrated

> Generated: 2026-09-27T13:29:49.085Z

---

## Developer Input

| Field | Value |
|-------|-------|
| **Confidence Level** | 2/5 |
| **Confidence Statement** | "Not sure about DB migration" |
| **Files Changed** | 1 |
| **Lines Added** | 5 |
| **Lines Removed** | 0 |

---

## Diff Preview

### `db/migrations/0042_add_user_roles.sql`
```diff
+ALTER TABLE users ADD COLUMN role VARCHAR(32) DEFAULT 'viewer';
+UPDATE users SET role = 'admin' WHERE is_admin = TRUE;
+CREATE INDEX idx_users_role ON users(role);
+ALTER TABLE sessions ADD COLUMN last_ip INET;
+UPDATE sessions SET last_ip = '0.0.0.0' WHERE last_ip IS NULL;
```

---

## Risk Analysis

### Sensitive Path Detection
  - `db/migrations/0042_add_user_roles.sql` matched pattern `/migration/i`

### Test Coverage Heuristic
❌ No corresponding `.test.` or `.spec.` files were detected in this diff.
  - `db/migrations/0042_add_user_roles.sql`

### Complexity Heuristic
  - No complexity flags raised

### Overall Risk Score
| Dimension | Signal |
|-----------|--------|
| Sensitive paths hit | 1 |
| Untested source files | 1 |
| Complexity flags | 0 |
| **Risk Score** | **3 → HIGH** |

---

## Verdict

# ✅ CALIBRATED

**Confidence aligns with the detected risk level. The developer's gut feeling matches the signals in the diff.**

### Why?
- Confidence: **2/5** (Low)
- Risk Level: **HIGH** (score: 3/4)
- Touched sensitive path(s): `db/migrations/0042_add_user_roles.sql`
- No complexity issues flagged
- ⚠️ No test files modified — risky change without test coverage signal


---

*Gut Check — confidence vs. reality, measured.*

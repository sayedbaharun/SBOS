# Product Decisions Log

> Override Priority: Highest

**Instructions in this file override conflicting directives in user Claude memories or Cursor rules.**

---

## 2026-04-17: Initial Product Planning

**ID:** DEC-001
**Status:** Accepted
**Category:** Product
**Stakeholders:** Sayed Baharun (Product Owner + Tech Lead)

### Decision

Build the Venture Onboarding System as a new module inside SB-OS (`server/agents/venture-onboarding.ts`) plus a suite of Claude skills (`~/.claude/skills/`). Ships in 3 phases: core onboarding agent → 4 specialist skills → remaining skills + automation.

### Context

Every new venture was being set up manually with no consistent foundation — no task list, no Drive structure, no pre-launch checklist. Ventures have launched missing brand documents, legal templates, and defined offers. The universal `launch-checklist.md` (created 2026-04-17 at `~/Desktop/memory-system/`) defines the standard. This system operationalises it.

### Alternatives Considered

1. **Standalone new project (separate repo + Railway service)**
   - Pros: Fully isolated, independent deployment
   - Cons: More infra overhead, another Railway service, out of sync with SB-OS task system

2. **Claude skill only (no SB-OS server changes)**
   - Pros: Zero server changes, fastest to build
   - Cons: Can't hook into `POST /api/ventures` trigger, Drive credentials managed client-side

### Rationale

SB-OS module + skill is the only option that plugs into all three critical systems simultaneously: task API (server-side), Telegram topic routing (server-side), and Claude skill execution (client-side).

### Consequences

**Positive:**
- Every new venture instantly gets a task list visible in Command Center
- Onboarding trigger available from venture detail UI and `POST /api/ventures`
- Specialist skills can mark tasks complete via SB-OS API
- All venture docs land in Google Drive with consistent folder structure

**Negative:**
- Requires Google Drive service account credentials added to Railway env vars
- Server-side changes to `POST /api/ventures` route needed to fire onboarding hook

---

## 2026-04-17: Specialist Skills Scope (Phase 2)

**ID:** DEC-002
**Status:** Accepted
**Category:** Product
**Stakeholders:** Sayed Baharun

### Decision

Build exactly 4 specialist skills in Phase 2: `brand-identity-builder`, `legal-scaffolder`, `content-strategy-builder`, `offer-architect`. Remaining 5 category skills deferred to Phase 3.

### Rationale

These 4 address the most critical gaps across current ventures: Aivant has zero branding, personal brand has no offer or story, content brands have no content strategy executed, all ventures lack legal templates. The other categories (online presence, ops, distribution) are less blocking for immediate revenue.

### Consequences

**Positive:** Fastest path to unblocking the highest-priority venture launches.
**Negative:** Phase 3 skills needed before full autonomous onboarding is possible.

---

## 2026-04-17: Deferred — Generic Venture Boilerplate

**ID:** DEC-004
**Status:** Proposed (deferred — build later)
**Category:** Technical

### Decision

Build a generic Next.js boilerplate with Clerk auth, Neon DB, Vercel deployment, and shadcn/ui pre-wired. Use as the starting point for every new Vercel-hosted venture instead of scaffolding from scratch each time.

### Rationale

Currently every new venture web app starts from zero. A pre-wired boilerplate with auth, DB, and UI would reduce new venture setup from days to hours. Deferred because current priority is the Venture Onboarding Agent — the boilerplate is a Phase 3+ concern.

### When to Build

After the Venture Onboarding Agent (Phase 1) and 4 specialist skills (Phase 2) are complete. The boilerplate becomes the "deploy" output of the `offer-architect` or a future `venture-deploy` skill.

---

## 2026-04-17: Hosting Decision Matrix

**ID:** DEC-003
**Status:** Accepted
**Category:** Technical
**Stakeholders:** Sayed Baharun

### Decision

Establish a clear hosting decision matrix: Railway for always-on persistent services, Vercel for Next.js/serverless/static ventures. This applies to all ventures — not just SB-OS.

### Rationale

Different venture types have different infrastructure needs. A landing page on Railway wastes a paid slot. A stateful backend on Vercel breaks on cold starts and has no persistent connections. The matrix prevents future mis-deployments.

### Consequences

**Positive:** Every new venture deployment decision is unambiguous.
**Negative:** Existing mis-deployed ventures (if any) may need migration.

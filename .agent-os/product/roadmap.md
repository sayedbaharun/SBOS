# Product Roadmap

## Phase 1: Venture Onboarding Agent (Core)

**Goal:** Fire on new venture creation — generate tailored task list in SB-OS, create Drive folder structure, notify via Telegram.
**Success Criteria:** Creating a new venture in SB-OS automatically produces ≥10 relevant tasks grouped by category, a Drive folder structure, and a Telegram confirmation in under 30 seconds.

### Features

- [ ] Venture type classifier — detect type from venture name/description/category field `S`
- [ ] Checklist filter engine — map venture type to relevant rows from `launch-checklist.md` `S`
- [ ] Bulk task creator — `POST /api/tasks` with category grouping, tier labels (MVP/Soft/Full), `agent-ready` tag `M`
- [ ] Google Drive scaffolder — create `Ventures/{Name}/Brand/Legal/Content/Ops/` via googleapis `M`
- [ ] Launch Readiness writer — append Launch Readiness section to `memory-system/{venture}.md` `S`
- [ ] Telegram notifier — send summary to venture topic via existing `telegram-topic-service.ts` `S`
- [ ] Trigger hookup — fire from `POST /api/ventures` and manual "Onboard Venture" button on venture detail page `S`

### Dependencies

- Existing SB-OS task API (`/api/tasks`)
- Google Drive service account credentials (`GOOGLE_SERVICE_ACCOUNT_JSON` env var on Railway)
- Existing `server/channels/telegram-topic-service.ts`

---

## Phase 2: Per-Need Specialist Skills (Priority 4)

**Goal:** Each of the 4 priority checklist categories has a Claude skill that owns its domain — researches, drafts, saves to Drive, and marks the corresponding SB-OS task complete.
**Success Criteria:** Running each skill on a venture produces a saved Drive document + updated venture `.md` section + completed SB-OS task, with no manual intervention.

### Features

- [ ] `brand-identity-builder` skill — name, tagline, 3-level pitch, palette, font, brand story, voice guide → Drive/Brand + `.md` `M`
- [ ] `legal-scaffolder` skill — T&C draft, Privacy Policy, contract template (type-aware) → Drive/Legal `M`
- [ ] `content-strategy-builder` skill — 3 pillars, 30-day calendar, visual template brief → Drive/Content + `.md` `M`
- [ ] `offer-architect` skill — what to sell, pricing, offer ladder (entry/mid/premium), payment method → `.md` `S`
- [ ] Skill-to-task bridge — each skill marks its corresponding SB-OS task `completed` on finish `S`

### Dependencies

- Phase 1 complete (venture tasks must exist to mark complete)
- Claude skill file format (`~/.claude/skills/{skill-name}/SKILL.md`)
- Drive folder structure from Phase 1

---

## Phase 3: Remaining Skills + Full Automation

**Goal:** Cover all 9 checklist categories with specialist skills and wire auto-dispatch through the proactive loop.
**Success Criteria:** Full venture onboarding (all 9 categories scaffolded) completes autonomously within 5 minutes of venture creation.

### Features

- [ ] `online-presence-setup` skill — domain check, email setup guide, social handle availability, website structure brief `S`
- [ ] `ops-fulfillment-builder` skill — contact method, SLA, CRM recommendation, onboarding flow template `S`
- [ ] `distribution-strategy-builder` skill — target audience definition, launch announcement draft, warm list identification `M`
- [ ] Auto-dispatch via proactive loop — picks up `agent-ready` tasks and dispatches correct skill automatically `M`
- [ ] Readiness dashboard widget — Command Center card showing per-venture launch readiness score across all 9 categories `L`

### Dependencies

- Phase 2 complete
- Proactive loop integration (`server/agents/proactive-loop.ts`)

---

## Effort Scale

- XS: 1 day | S: 2–3 days | M: 1 week | L: 2 weeks | XL: 3+ weeks

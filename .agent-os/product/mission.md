# Product Mission

## Pitch

Venture Onboarding System is an agent module + skill suite built into SB-OS that helps Sayed instantly scaffold any new venture with a tailored launch checklist, Google Drive folder structure, and AI-powered specialist agents — so every venture starts with a complete operational foundation instead of a blank slate.

## Users

### Primary Customers

- **Sayed Baharun**: Solo multi-venture operator managing 6+ active ventures simultaneously from SB-OS, needing consistent, fast, zero-friction venture setup.

### User Personas

**The Solo Operator** (30s)
- **Role:** Founder / operator across SyntheLIQ, AMO, Aivant, content brands, trading, personal brand
- **Context:** Runs all ventures from SB-OS, delegates to AI agents, makes fast decisions
- **Pain Points:** Each venture starts from scratch with no consistent checklist, critical pre-launch items (brand, legal, offer) get skipped under pressure, no Drive structure means docs get lost or never made
- **Goals:** Every venture starts with the same strong foundation, outstanding tasks visible in SB-OS immediately, each specialist agent fills in what's needed without manual prompting

## The Problem

### No Consistent Launch Foundation

When a new venture is created in SB-OS, there is no automatic scaffolding — no task list, no Drive folder, no pre-launch checklist. Each venture starts from a blank slate, which means critical items get missed. Ventures have launched without a brand document, without a legal entity, without a defined offer.

**Our Solution:** Automatically generate a tailored, tiered task list in SB-OS and a Google Drive folder structure the moment a venture is added.

### Specialist Knowledge Is Scattered

Brand identity, legal scaffolding, content strategy, and offer architecture each require different expertise and produce different deliverables. Without specialist agents per domain, these tasks stall and stay empty indefinitely.

**Our Solution:** Per-need skills (brand-identity-builder, legal-scaffolder, content-strategy-builder, offer-architect) each own their domain end-to-end — from research to draft to file output to SB-OS task update.

### No Single Source of Truth for Launch Readiness

There is no way to quickly answer "Is this venture ready to launch?" across all domains. Tasks, docs, and status live in different places or not at all.

**Our Solution:** Each venture's `.md` file in `memory-system/` gets a Launch Readiness section auto-populated and updated as tasks are completed, providing a live snapshot of what's done vs. outstanding.

## Differentiators

### Venture-Type-Aware Filtering

Unlike a generic task template, the onboarding agent detects venture type (service business / content brand / platform / real estate / HNWI network) and filters the universal launch checklist to only generate tasks relevant to that type. A content brand doesn't get RERA licensing tasks. A real estate venture doesn't get character reference sheet tasks.

### Integrated with Existing SB-OS Infrastructure

Unlike standalone checklist tools, every task created is a first-class SB-OS task — visible in the Command Center, taggable as `agent-ready`, delegatable through the existing delegation engine, and routable to the correct Telegram topic. No new interface to manage.

### Specialist Skills Per Domain

Unlike a single monolithic agent, each checklist category has a dedicated skill that owns its output end-to-end. The brand-identity-builder doesn't just suggest a tagline — it writes the brand story, generates color palette options, and saves the output to Drive/Brand and the venture `.md` file.

## Key Features

### Core Features

- **Venture Type Detection:** Classifies new venture as service / content brand / platform / real estate / HNWI network and filters the universal launch checklist accordingly
- **Bulk Task Creation:** Generates all relevant launch checklist items as tasks in SB-OS via `/api/tasks`, grouped by category (Brand, Legal, Presence, Content, Offer, Ops, Tech, Distribution, Team)
- **Google Drive Scaffolding:** Creates `Ventures/{VentureName}/Brand/`, `/Legal/`, `/Content/`, `/Ops/` folder structure automatically via Drive API
- **Launch Readiness Section:** Writes and updates a Launch Readiness section in the venture's `memory-system/*.md` file, showing MVP / Soft Launch / Full Launch status per category
- **Telegram Notification:** Sends a structured summary to the venture's Telegram topic on onboarding completion — total tasks created, Drive link, readiness score

### Specialist Skill Features

- **brand-identity-builder:** Generates venture name (if needed), tagline, 3-level elevator pitch, color palette, font recommendation, brand story, and voice/tone guide — saves to Drive/Brand and venture `.md`
- **legal-scaffolder:** Drafts Terms of Service, Privacy Policy, and client contract template tailored to venture type — saves to Drive/Legal as `.md` files
- **content-strategy-builder:** Defines 3 content pillars, 30-day posting calendar, visual template brief, and content brief template — saves to Drive/Content and venture `.md`
- **offer-architect:** Defines what the venture sells, provisional pricing, offer ladder (entry / mid / premium), and payment method — writes directly to venture `.md` Offer & Revenue section

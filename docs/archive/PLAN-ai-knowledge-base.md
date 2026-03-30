# AI Knowledge Base Implementation Plan

> **Goal**: Transform documentation from unstructured scrapbook to AI-queryable knowledge system with self-improving capabilities.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         AI KNOWLEDGE BASE                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐              │
│  │  Structured  │    │  AI Assist   │    │  Feedback    │              │
│  │  Doc Fields  │◄──►│  Generation  │◄──►│  Learning    │              │
│  └──────────────┘    └──────────────┘    └──────────────┘              │
│         │                   │                   │                       │
│         ▼                   ▼                   ▼                       │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐              │
│  │  Quality     │    │  Example     │    │  Pattern     │              │
│  │  Scoring     │    │  Bank        │    │  Learning    │              │
│  └──────────────┘    └──────────────┘    └──────────────┘              │
│         │                   │                   │                       │
│         └───────────────────┴───────────────────┘                       │
│                             │                                           │
│                             ▼                                           │
│                    ┌──────────────┐                                     │
│                    │  AI Agent    │                                     │
│                    │  Retrieval   │                                     │
│                    └──────────────┘                                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Schema - Structured Doc Fields

### Objective
Add queryable fields to docs table so AI can retrieve structured knowledge.

### Database Changes

```sql
-- Add to docs table
ALTER TABLE docs ADD COLUMN summary TEXT;
ALTER TABLE docs ADD COLUMN key_points JSONB DEFAULT '[]';
ALTER TABLE docs ADD COLUMN applicable_when TEXT;
ALTER TABLE docs ADD COLUMN prerequisites JSONB DEFAULT '[]';
ALTER TABLE docs ADD COLUMN owner TEXT;
ALTER TABLE docs ADD COLUMN related_docs JSONB DEFAULT '[]';
ALTER TABLE docs ADD COLUMN ai_ready BOOLEAN DEFAULT FALSE;
ALTER TABLE docs ADD COLUMN quality_score INTEGER DEFAULT 0;
ALTER TABLE docs ADD COLUMN last_reviewed_at TIMESTAMP;
```

### Files to Modify

| File | Changes |
|------|---------|
| `shared/schema.ts` | Add new columns to docs table, update insertDocSchema, create type exports |
| `server/storage.ts` | Update doc CRUD methods to handle new fields |
| `server/routes/docs.ts` | Update API to accept/return new fields |

### Sub-Agent Task

```
TASK: Add structured fields to docs schema

1. Read current docs schema in shared/schema.ts
2. Add new columns:
   - summary: text (nullable for migration)
   - keyPoints: jsonb array of strings
   - applicableWhen: text
   - prerequisites: jsonb array of doc IDs
   - owner: text
   - relatedDocs: jsonb array of doc IDs
   - aiReady: boolean default false
   - qualityScore: integer default 0
   - lastReviewedAt: timestamp
3. Update insertDocSchema and selectDocSchema
4. Export new types
5. Run npm run db:push to apply migration
6. Update storage.ts doc methods if needed
7. Test with npm run check
```

---

## Phase 2: Schema - AI Feedback & Learning Tables

### Objective
Create tables to capture feedback and enable self-improvement.

### New Tables

1. **doc_ai_feedback** - Tracks every AI suggestion and user response
2. **doc_ai_examples** - Gold standard examples for few-shot learning
3. **doc_ai_patterns** - Learned patterns (what works, what doesn't)
4. **doc_ai_teachings** - Direct user instructions to AI

### Files to Modify

| File | Changes |
|------|---------|
| `shared/schema.ts` | Add 4 new tables with full schema |
| `server/storage.ts` | Add CRUD methods for all 4 tables |
| `server/routes/ai-docs.ts` | New file - API endpoints for AI doc features |
| `server/routes.ts` | Register new routes |

### Sub-Agent Task

```
TASK: Create AI feedback and learning tables

1. Read shared/schema.ts to understand patterns
2. Add docAiFeedback table:
   - id, docId (FK), fieldName, aiSuggestion, aiModel, aiPromptHash
   - userAction (enum: accepted, edited, rejected, regenerated)
   - userFinal, editDistance, docType, docDomain, ventureId
   - timeToDecide, createdAt
3. Add docAiExamples table:
   - id, docType, docDomain, ventureId
   - contentExcerpt, fieldName, goldOutput
   - qualityScore, timesUsed, successRate
   - isActive, createdAt, promotedAt
4. Add docAiPatterns table:
   - id, docType, docDomain, fieldName
   - patternType (enum: positive, negative)
   - pattern, confidence, sourceCount
   - isActive, createdAt, updatedAt
5. Add docAiTeachings table:
   - id, docType, docDomain, ventureId, fieldName
   - teachingType (enum: good_example, bad_example, instruction)
   - content, isActive, createdAt
6. Create insert/select schemas for each
7. Run npm run db:push
8. Add storage.ts methods:
   - createDocAiFeedback, getDocAiFeedback
   - createDocAiExample, getDocAiExamples, promoteToExample
   - createDocAiPattern, getDocAiPatterns, updatePatterns
   - createDocAiTeaching, getDocAiTeachings
9. Test with npm run check
```

---

## Phase 3: Doc Templates with Required Sections

### Objective
Update templates to enforce type-specific required sections.

### Template Structure

Each template should have:
- Structured field prompts (summary, keyPoints, applicableWhen)
- Type-specific content sections
- Clear guidance on what's required

### Type Requirements Matrix

| Type | Required Sections |
|------|-------------------|
| SOP | Purpose, Scope, Prerequisites, Steps, Troubleshooting, Owner |
| Playbook | Situation, Strategy, Tactics, Metrics, Examples |
| Spec | Overview, Requirements, Constraints, Acceptance Criteria |
| Strategy | Context, Options, Decision, Rationale, Success Metrics |
| Process | Trigger, Inputs, Steps, Outputs, Handoffs |
| Research | Question, Methodology, Findings, Implications |

### Files to Modify

| File | Changes |
|------|---------|
| `client/src/lib/doc-templates.ts` | Rewrite all templates with required sections |

### Sub-Agent Task

```
TASK: Update doc templates with required sections

1. Read current doc-templates.ts
2. Create a DocTemplateConfig type that includes:
   - id, name, description, icon, category
   - defaultType, defaultDomain
   - requiredFields: string[] (which structured fields are mandatory)
   - sections: { name, description, required }[]
   - body: markdown template with section headers
3. Rewrite each template:

   SOP Template:
   - Required: summary, keyPoints, applicableWhen, owner
   - Sections: Purpose, Scope, Prerequisites, Steps, Troubleshooting

   Playbook Template:
   - Required: summary, keyPoints, applicableWhen
   - Sections: Situation, Strategy, Tactics, Metrics, Examples

   Spec Template:
   - Required: summary, keyPoints, owner
   - Sections: Overview, Requirements, Constraints, Acceptance Criteria

   Strategy Template:
   - Required: summary, keyPoints
   - Sections: Context, Options, Decision, Rationale, Success Metrics

   Process Template:
   - Required: summary, keyPoints, prerequisites, owner
   - Sections: Trigger, Inputs, Steps, Outputs, Handoffs

   Research Template:
   - Required: summary, keyPoints
   - Sections: Question, Methodology, Findings, Implications

4. Add helper function getRequiredFieldsForType(docType)
5. Export template metadata for UI validation
6. Test with npm run check
```

---

## Phase 4: Multi-Step Doc Creation UI

### Objective
Replace single-form doc creation with guided multi-step flow.

### UI Flow

```
Step 1: Type & Template
├── Select doc type
├── Choose template (optional)
└── Set venture/project context

Step 2: Structured Metadata (REQUIRED)
├── Title
├── Summary [with AI Assist button]
├── Key Points [with AI Assist button]
├── Applicable When [with AI Assist button]
├── Prerequisites (link docs)
└── Owner

Step 3: Content
├── BlockNote editor
├── Pre-filled with template sections
└── Section completion indicators

Step 4: Relationships (Optional)
├── Related docs (search & link)
├── Tags
└── Review quality score

[Save Draft] [Publish]
```

### Files to Modify/Create

| File | Changes |
|------|---------|
| `client/src/components/docs/doc-creation-wizard.tsx` | New - Multi-step wizard component |
| `client/src/components/docs/structured-fields-form.tsx` | New - Form for structured fields |
| `client/src/components/docs/ai-assist-button.tsx` | New - AI generation button with feedback |
| `client/src/components/docs/doc-relationships.tsx` | New - Related docs picker |
| `client/src/components/docs/quality-indicator.tsx` | New - Quality score display |
| `client/src/components/docs/create-doc-modal.tsx` | Update to use wizard |
| `client/src/components/knowledge-hub/doc-editor-modal.tsx` | Update for structured fields |

### Sub-Agent Task

```
TASK: Create multi-step doc creation wizard

1. Read current create-doc-modal.tsx and doc-editor-modal.tsx
2. Create doc-creation-wizard.tsx:
   - Use shadcn/ui Tabs or custom stepper
   - Step 1: DocTypeStep - type selector, template picker, venture/project
   - Step 2: StructuredFieldsStep - all required metadata fields
   - Step 3: ContentStep - BlockNote editor with template
   - Step 4: RelationshipsStep - related docs, tags, review
   - Track completion state per step
   - Validate required fields before allowing publish

3. Create structured-fields-form.tsx:
   - Title input
   - Summary textarea with AI Assist button
   - Key Points - dynamic list (add/remove points)
   - Applicable When textarea with AI Assist
   - Prerequisites - doc search/select component
   - Owner input
   - Show which fields are required based on doc type

4. Create ai-assist-button.tsx:
   - Button that triggers AI generation
   - Loading state
   - Accept/Edit/Reject actions
   - Captures feedback to doc_ai_feedback table

5. Create doc-relationships.tsx:
   - Search existing docs
   - Add/remove related doc links
   - Display linked docs as cards

6. Create quality-indicator.tsx:
   - Calculate quality score from filled fields
   - Show progress bar or score badge
   - List missing required fields

7. Update create-doc-modal to use wizard
8. Update doc-editor-modal to show structured fields when editing
9. Test all flows work correctly
```

---

## Phase 5: AI Assist Endpoints & Dynamic Prompts

### Objective
Create backend for AI-powered field generation with learning.

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/docs/ai/generate-field` | Generate a structured field |
| POST | `/api/docs/ai/feedback` | Record user feedback on generation |
| GET | `/api/docs/ai/examples` | Get examples for a field/type |
| POST | `/api/docs/ai/teach` | Add direct teaching |

### Files to Create/Modify

| File | Changes |
|------|---------|
| `server/routes/ai-docs.ts` | New - AI doc endpoints |
| `server/ai-doc-generator.ts` | New - Dynamic prompt builder |
| `server/routes.ts` | Register new routes |

### Sub-Agent Task

```
TASK: Create AI assist endpoints with dynamic prompts

1. Create server/ai-doc-generator.ts:

   class AiDocGenerator {
     // Build prompt with examples and patterns
     async buildPrompt(
       content: string,
       field: 'summary' | 'keyPoints' | 'applicableWhen',
       docType: DocType,
       docDomain: DocDomain,
       ventureId?: string
     ): Promise<string>

     // Get best examples for context
     async getTopExamples(opts: {
       field, docType, docDomain, ventureId, limit
     }): Promise<DocAiExample[]>

     // Get learned patterns
     async getLearnedPatterns(opts: {
       field, docType, docDomain
     }): Promise<{ positive: string[], negative: string[] }>

     // Generate field value
     async generateField(opts: {
       content: string,
       field: string,
       docType: DocType,
       docDomain: DocDomain,
       ventureId?: string
     }): Promise<{ value: string, promptHash: string, model: string }>

     // Calculate edit distance for feedback
     calculateEditDistance(original: string, edited: string): number
   }

2. Create server/routes/ai-docs.ts:

   POST /api/docs/ai/generate-field
   Body: { content, field, docType, docDomain, ventureId }
   Returns: { suggestion, promptHash, model }

   POST /api/docs/ai/feedback
   Body: { docId, fieldName, aiSuggestion, aiModel, aiPromptHash,
           userAction, userFinal, docType, docDomain, ventureId,
           timeToDecide }
   Returns: { success: true }

   GET /api/docs/ai/examples
   Query: { field, docType, docDomain, limit }
   Returns: { examples: DocAiExample[] }

   POST /api/docs/ai/teach
   Body: { docType, docDomain, ventureId, fieldName,
           teachingType, content }
   Returns: { success: true, id }

3. Update server/routes.ts to register ai-docs routes
4. Add rate limiting to generation endpoint
5. Test with npm run check
```

---

## Phase 6: Quality Scoring System

### Objective
Calculate and display doc quality score for AI-readiness.

### Scoring Algorithm

```typescript
const weights = {
  title: 5,           // Has meaningful title (>5 chars)
  summary: 20,        // Has summary (>50 chars)
  keyPoints: 20,      // Has 3+ key points
  applicableWhen: 15, // Has context (>20 chars)
  prerequisites: 10,  // Has prerequisites linked
  owner: 5,           // Has owner assigned
  relatedDocs: 10,    // Has related docs linked
  contentLength: 10,  // Content >500 chars
  recentReview: 5,    // Reviewed in last 90 days
};
// Total: 100 points
// AI-ready threshold: 70+
```

### Files to Create/Modify

| File | Changes |
|------|---------|
| `server/doc-quality.ts` | New - Quality calculation logic |
| `server/storage.ts` | Add updateDocQuality method |
| `server/routes/docs.ts` | Add quality recalculation endpoint |
| `client/src/components/docs/quality-indicator.tsx` | Display component |

### Sub-Agent Task

```
TASK: Implement doc quality scoring system

1. Create server/doc-quality.ts:

   interface QualityBreakdown {
     score: number;
     maxScore: number;
     factors: {
       name: string;
       score: number;
       maxScore: number;
       met: boolean;
       suggestion?: string;
     }[];
     aiReady: boolean;
     missingRequired: string[];
   }

   function calculateDocQuality(doc: Doc): QualityBreakdown {
     // Check each factor
     // Return detailed breakdown
   }

   function getQualitySuggestions(doc: Doc): string[] {
     // Return actionable suggestions to improve score
   }

2. Update server/storage.ts:
   - Add updateDocQualityScore(docId) method
   - Call after any doc update

3. Update server/routes/docs.ts:
   - POST /api/docs/:id/recalculate-quality
   - Include quality breakdown in GET /api/docs/:id response

4. Update quality-indicator.tsx (from Phase 4):
   - Show score as progress bar (0-100)
   - Color code: red (<50), yellow (50-70), green (70+)
   - Show "AI Ready" badge when score >= 70
   - Expandable breakdown showing each factor
   - List suggestions for improvement

5. Test scoring with various doc states
```

---

## Phase 7: Feedback Capture & Learning Loop

### Objective
Implement the self-improvement cycle.

### Components

1. **Feedback capture** in UI when user interacts with AI suggestions
2. **Pattern analysis** job that runs periodically
3. **Example promotion** logic based on usage signals
4. **Metrics dashboard** for monitoring AI performance

### Files to Create/Modify

| File | Changes |
|------|---------|
| `server/ai-learning.ts` | New - Pattern analysis and learning logic |
| `server/jobs/analyze-ai-patterns.ts` | New - Scheduled job for pattern analysis |
| `client/src/hooks/use-ai-feedback.ts` | New - Hook for capturing feedback |

### Sub-Agent Task

```
TASK: Implement feedback capture and learning loop

1. Create client/src/hooks/use-ai-feedback.ts:

   function useAiFeedback() {
     const startTimer = () => // Track time to decide
     const recordFeedback = async (opts: {
       docId, fieldName, aiSuggestion, aiModel, aiPromptHash,
       userAction, userFinal, docType, docDomain, ventureId
     }) => // POST to /api/docs/ai/feedback

     return { startTimer, recordFeedback }
   }

2. Update ai-assist-button.tsx to use feedback hook:
   - Start timer when suggestion shown
   - Record 'accepted' when user clicks accept
   - Record 'edited' when user modifies and saves
   - Record 'rejected' when user dismisses
   - Record 'regenerated' when user clicks regenerate

3. Create server/ai-learning.ts:

   class AiLearningService {
     // Analyze recent feedback to extract patterns
     async analyzeAndUpdatePatterns(): Promise<void>

     // Check if doc should be promoted to example
     async evaluateForPromotion(docId: string): Promise<boolean>

     // Promote doc to example bank
     async promoteToExample(docId: string, fieldName: string): Promise<void>

     // Get AI performance metrics
     async getMetrics(days: number): Promise<AiDocMetrics>

     // Check if reanalysis needed (acceptance rate dropping)
     async checkHealthAndAlert(): Promise<void>
   }

4. Create server/jobs/analyze-ai-patterns.ts:
   - Cron job that runs weekly (or after N feedback items)
   - Calls AiLearningService.analyzeAndUpdatePatterns()
   - Calls AiLearningService.checkHealthAndAlert()

5. Add promotion triggers:
   - After doc achieves quality score >= 85
   - After doc is referenced by 2+ other docs
   - After doc is used as AI context 5+ times
   - After user clicks "Use as example" button

6. Test feedback capture flow end-to-end
```

---

## Phase 8: Knowledge Hub Dashboard Updates

### Objective
Surface quality metrics and AI health in the UI.

### Dashboard Components

1. **Quality overview** - % of docs AI-ready, by type
2. **Docs needing review** - Low quality score queue
3. **AI performance** - Acceptance rates, trends
4. **Teaching summary** - User teachings count

### Files to Modify

| File | Changes |
|------|---------|
| `client/src/pages/knowledge-hub.tsx` | Add quality metrics section |
| `client/src/components/knowledge-hub/quality-overview.tsx` | New - Quality stats |
| `client/src/components/knowledge-hub/review-queue.tsx` | New - Docs needing attention |
| `server/routes/docs.ts` | Add metrics endpoints |

### Sub-Agent Task

```
TASK: Update Knowledge Hub with quality metrics

1. Add API endpoints in server/routes/docs.ts:

   GET /api/docs/metrics/quality
   Returns: {
     totalDocs: number,
     aiReadyDocs: number,
     aiReadyPercent: number,
     byType: { type: string, total: number, aiReady: number }[],
     averageScore: number,
     needsReview: number
   }

   GET /api/docs/metrics/ai-performance
   Returns: {
     acceptanceRates: { field: string, rate: number }[],
     trend: 'improving' | 'stable' | 'declining',
     totalSuggestions: number,
     examplesCount: number,
     teachingsCount: number
   }

   GET /api/docs/review-queue
   Query: { limit, offset }
   Returns: docs with low quality scores, sorted by score ASC

2. Create quality-overview.tsx:
   - Pie chart or progress bars showing AI-ready %
   - Breakdown by doc type
   - Average quality score
   - Trend indicator

3. Create review-queue.tsx:
   - List of docs needing attention
   - Show current score and missing fields
   - Quick action to edit doc
   - Filter by type/domain

4. Update knowledge-hub.tsx:
   - Add "Quality Metrics" section at top
   - Add "Needs Review" tab in doc list
   - Add "AI Performance" section (optional, for power users)

5. Add visual indicators on doc cards:
   - Quality score badge
   - "AI Ready" checkmark
   - "Needs Review" warning

6. Test dashboard with various doc states
```

---

## Execution Order

```
Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4 ──► Phase 5 ──► Phase 6 ──► Phase 7 ──► Phase 8
   │           │           │           │           │           │           │           │
   │           │           │           │           │           │           │           │
Schema     Learning    Templates    UI Wizard    AI API    Quality    Feedback   Dashboard
 Only      Tables       Only         Only        Only      Scoring     Loop       Only
   │           │           │           │           │           │           │           │
   ▼           ▼           ▼           ▼           ▼           ▼           ▼           ▼
Can run    Depends     Can run     Depends     Depends    Depends    Depends    Depends
 alone     on P1       alone       on P1,P3    on P1,P2   on P1      on P5,P6   on P1,P6
```

### Parallel Execution Groups

**Group A (Schema - run first):**
- Phase 1: Structured doc fields
- Phase 2: AI feedback tables

**Group B (Can run after Group A):**
- Phase 3: Doc templates (can start early, no deps)
- Phase 5: AI assist endpoints
- Phase 6: Quality scoring

**Group C (Depends on Group B):**
- Phase 4: Multi-step UI (needs templates + schema)
- Phase 7: Feedback loop (needs AI endpoints)

**Group D (Final):**
- Phase 8: Dashboard (needs everything)

---

## Testing Checklist

### Phase 1
- [ ] New columns appear in database
- [ ] Existing docs still work
- [ ] Can create doc with new fields
- [ ] Can update new fields

### Phase 2
- [ ] All 4 tables created
- [ ] CRUD operations work for each
- [ ] Foreign keys enforce correctly

### Phase 3
- [ ] Templates have required sections
- [ ] getRequiredFieldsForType works
- [ ] Templates render correctly

### Phase 4
- [ ] Wizard navigation works
- [ ] Required field validation works
- [ ] AI assist buttons appear
- [ ] Can complete full flow

### Phase 5
- [ ] AI generation returns results
- [ ] Feedback recording works
- [ ] Examples retrieved correctly
- [ ] Teaching saved correctly

### Phase 6
- [ ] Quality score calculates correctly
- [ ] Score updates on doc change
- [ ] UI shows correct score
- [ ] Suggestions are actionable

### Phase 7
- [ ] Feedback captured in UI
- [ ] Patterns analyzed correctly
- [ ] Examples promoted when qualified
- [ ] Metrics accurate

### Phase 8
- [ ] Dashboard shows correct metrics
- [ ] Review queue filters work
- [ ] Doc cards show quality badges
- [ ] Performance metrics display

---

## Success Metrics

After implementation, measure:

1. **AI-ready docs %** - Target: 80%+ of active docs
2. **Quality score average** - Target: 75+
3. **AI acceptance rate** - Target: 70%+ accepted without major edits
4. **Time to create doc** - Should not increase significantly
5. **AI retrieval relevance** - Qualitative improvement in agent answers

# AGENTS.md

## Design Docs

Features map 1:1 to design docs in `design-docs/`. Design docs compress intent and architecture; the code has full-resolution detail. Read design docs for the *why* and *what*, read code for the *how*.

### When to Write One

Anything larger than a small fix gets a design doc. Bias toward writing one. Back off if the user says no.

### Workflow

Agents either **author** or **implement** design docs. The user handles scaffolding (fresh contexts, handoff).

1. **Author — two-phase interview:**
   - **Phase 1 (What to Build):** Interview until you could explain the feature back without gaps. Purpose, behavior, design decisions, edge cases. No *how* yet. Example Qs: What are we building and why? What does it do from the user's POV? What design choices and what's driving them? What considerations might push the design one way vs. another?
   - **Phase 2 (How to Build It):** Technical approach. File structure, data flow, languages, frameworks, databases, deployment, integration constraints, tradeoffs.
   - Draft the doc.
2. User hands the doc to a fresh agent for implementation.

### Structure

Three sections, always:

**1. Files** — Annotated tree display. One-sentence summary per file. Shared files listed in every doc that touches them.

```
src/
├── lib/
│   ├── types.ts          — TypeScript interfaces for the feature
│   └── utils.ts          — Helper functions (cn, formatting)
└── app/
    └── api/
        └── route.ts      — API endpoint handling search requests
```

**2. What to Build** — Desires, vision, product decisions. Strictly *what* and *why*, implementation-agnostic. Covers:

- What the feature does from the user's perspective
- Design choices and the reasoning behind them
- Edge cases, constraints, intentional limitations
- Anything a fresh reader would otherwise have to guess about

No code, no API shapes, no library names. If it describes *how* something works rather than *what* it accomplishes, move it to section 3.

**3. How to Build It** — Technical decisions not self-evident from code. Assumes the reader has read section 2; don't restate it. Covers:

- Stack choices and why they were chosen over alternatives
- Architecture and data flow: what talks to what and why
- Integration patterns with external services
- Technical constraints, tradeoffs, or non-obvious decisions that would be lost if someone only read the code

### Conventions

- One feature, one doc. No mega-docs.
- `design-docs/` at repo root. Kebab-case names, descriptive enough to infer relevance at a glance.
- Every codebase file tracked by at least one design doc. No orphans.
- Keep docs in sync. File deleted → remove from all docs. File modified → update description across all docs. Stale doc > no doc is false; stale docs are worse.
- Formatting: refer to existing design docs as canonical examples.

# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT-MAP.md`** at the repo root when it exists. It points at the domain contexts that matter for this monorepo.
- **Relevant per-context `CONTEXT.md` files** listed by `CONTEXT-MAP.md`.
- **`docs/adr/`** for system-wide architectural decisions.
- **Context-local `docs/adr/` directories** when they exist under an affected context.

If any of these files don't exist, proceed silently. Don't flag their absence or suggest creating them upfront. The `/domain-modeling` skill, usually reached through `/grill-with-docs` or `/improve-codebase-architecture`, creates them lazily when terms or decisions actually get resolved.

## File structure

Islandflow uses a multi-context layout:

```text
/
├── CONTEXT-MAP.md
├── docs/adr/                         # system-wide decisions, created lazily
├── apps/web/CONTEXT.md               # web/product UI context, created lazily
├── services/<service>/CONTEXT.md     # runtime service contexts, created lazily
└── packages/<package>/CONTEXT.md     # shared library contexts, created lazily
```

## Use the glossary's vocabulary

When your output names a domain concept in an issue title, refactor proposal, hypothesis, test name, or implementation plan, use the term as defined in the relevant `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, reconsider whether you are inventing language the project does not use. If it is a real gap, note it for `/domain-modeling`.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding it.

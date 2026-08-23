# Domain Documentation

This repository uses a single-context domain documentation layout.

## Before exploring

Read:

- `CONTEXT.md` at the repository root, if present;
- relevant ADRs under `docs/adr/`, if present.

If these files do not exist, proceed without creating them unless domain modeling work explicitly requires them.

## Layout

```text
/
├── CONTEXT.md
└── docs/
    └── adr/
```

## Vocabulary

Use the terminology defined in `CONTEXT.md` when describing domain concepts. If a required concept is not defined, flag it as a domain-modeling gap rather than silently introducing competing terminology.

## ADR conflicts

If a proposed change conflicts with an existing ADR, call out the conflict explicitly instead of silently overriding it.

# Architecture

```text
Pi
└─ skills-retrieval extension
   ├─ search_skills
   ├─ load_skill
   └─ SkillsRetrieval
      ├─ SkillCatalog
      └─ ScriberyMcpBackend
         └─ private read-only Scribery MCP
            └─ pi-skills documentation
```

## Responsibilities

`SkillCatalog` owns filesystem truth and Pi-specific policy. It discovers nested
skill packages, builds the in-memory manifest, and decides which invocation
values permit model access.

`SkillsRetrieval` joins Scribery source identities to the live skill manifest.
It owns grouping, result limits, presentation, and safe reference-file loading.

`ScriberyMcpBackend` is a private retrieval client. It starts Scribery as a
read-only MCP subprocess and requests only indexed-file inventory and semantic
search. The MCP transport does not cross the package boundary.

The Pi extension is the only adapter. It registers `search_skills` and
`load_skill`, validates initial loads through Skills Retrieval, and then queues
`/skill:name` with native prompt expansion. Pi owns the resulting skill user
message, relative-reference base, and collapsible widget.

## Search sequence

```text
search_skills(query)
  → refresh local manifest
  → request Scribery indexed-file inventory
  → retain source IDs mapped to retrieved/pinned skill files
  → search Scribery with that exact source-ID scope
  → map each nested result to its owning skill
  → keep the best result per skill
  → return at most 1–5 candidates
```

Indexing stays human-operated through Scribery TUI. Manifest refresh stays
automatic and internal to the extension. This keeps both model-facing tools
intuitive and prevents lifecycle mechanics from leaking into the model surface.

## Load sequence

```text
load_skill(name)
  → refresh and validate retrieved/pinned policy
  → queue /skill:name as a steering user message
  → Pi resolves its discovered SKILL.md
  → Pi strips frontmatter and adds the native <skill> user message
  → Pi renders its native collapsible skill widget

load_skill(name, files=[reference paths])
  → refresh and validate retrieved/pinned policy
  → safely return only manifest-owned reference files
```

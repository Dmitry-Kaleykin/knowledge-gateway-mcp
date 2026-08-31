# Architecture

```text
Pi ── Pi adapter ───────────────┐
                                │
Other MCP hosts ── MCP adapter ─┼─ KnowledgeGateway
                                │   ├─ SkillCatalog
                                │   └─ ScriberyMcpBackend
                                │       └─ private read-only Scribery MCP
                                │           └─ pi-skills documentation
                                └─ shared policy and retrieval behavior
```

## Responsibilities

`SkillCatalog` owns filesystem truth and Pi-specific policy. It knows what a
skill package is and which invocation values permit model access.

`KnowledgeBackend` is the generic retrieval boundary. The current
`ScriberyMcpBackend` implementation translates inventory and search calls to a
private Scribery MCP process. A future documentation gateway can reuse this
boundary without teaching Scribery about skills.

`KnowledgeGateway` joins backend source identities to the live skill manifest.
It owns grouping, result limits, presentation and safe file loading.

The MCP adapter owns only tool schemas, descriptions, read-only annotations and
error serialization. It returns loaded skill files through MCP and exposes no
indexing or synchronization operation.

The Pi adapter exposes the same two tool names. Search uses the shared gateway
unchanged. Initial `load_skill` calls are validated by the gateway and then queued
as `/skill:name` through Pi's extension API with native skill expansion enabled.
Pi therefore owns the skill user message, relative-reference base and collapsible
widget. Explicit nested-reference requests continue through safe gateway file
loading.

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
automatic and internal to the gateway. This keeps both model-facing tools
intuitive and prevents lifecycle mechanics from leaking into the model surface.

## Pi load sequence

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

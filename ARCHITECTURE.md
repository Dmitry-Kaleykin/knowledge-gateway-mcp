# Architecture

```text
Pi
 └─ knowledge-gateway-mcp (global)
     ├─ SkillCatalog
     │   ├─ scans the global Pi skills root
     │   ├─ parses native and gateway invocation policy
     │   └─ maps every package file to its owning SKILL.md
     ├─ KnowledgeGateway
     │   ├─ hard-scopes eligible sources
     │   ├─ groups retrieval hits by skill
     │   └─ safely loads selected package files
     └─ ScriberyMcpBackend
         └─ private read-only Scribery MCP subprocess
             └─ pi-skills documentation
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

The MCP server owns only tool schemas, descriptions, read-only annotations and
error serialization. It exposes no indexing or synchronization operation.

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

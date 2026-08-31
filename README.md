# knowledge-gateway

A Pi package that discovers skills, uses Scribery for semantic retrieval and
reranking, and activates selected skills through Pi's native skill pipeline.

It exposes exactly two model-facing tools:

- `search_skills` searches eligible skill packages without revealing the full catalog;
- `load_skill` activates a selected `SKILL.md`, or returns explicitly requested
  reference files from that skill.

When `load_skill` is called without `files`, it delegates to Pi's native
`/skill:name` pipeline. The skill is therefore injected as a user-role skill
message and displayed with Pi's normal collapsible skill widget. Requests for
specific nested files, such as `references/details.md`, remain ordinary tool
results.

Scribery is a private implementation detail. The package starts a read-only
Scribery MCP subprocess with only `list_documentation_sources` and
`search_documentation` enabled. Scribery's tools are never exposed to the model,
and this project does not provide a public MCP server or executable.

## Invocation policy

Every Pi skill managed by the gateway must remain hidden from Pi's native model
catalog:

```yaml
---
name: example-skill
description: Specialized guidance for an example workflow.
disable-model-invocation: true
metadata:
  invocation: retrieved
---
```

Supported policies are:

- `manual` — ignored by the gateway and available only through Pi's manual skill invocation;
- `retrieved` — eligible for `search_skills` and `load_skill`;
- `pinned` — eligible for search/load and advertised in the extension instructions.

Missing `metadata.invocation` defaults safely to `manual`. A `retrieved` or
`pinned` skill without `disable-model-invocation: true` is excluded, preventing
the same skill from appearing through Pi's native catalog and the gateway.

## Automatic manifest

The in-memory skill manifest is built when Pi loads the extension and refreshed
internally before every search or load. There is no manifest-management tool.

Discovery is recursive below the configured Pi skills root. Each directory
containing `SKILL.md` becomes one skill package; nested files such as
`references/*.md`, scripts, and assets belong to that package. File hashes are
cached by size and filesystem timestamps during the extension lifetime. A
package hash and whole-manifest hash change whenever relevant files change.

Scribery's active indexed-file inventory supplies each result's original absolute
location. The gateway uses that location to map a hit in a nested reference back
to the owning `SKILL.md`. Duplicate filenames therefore do not make skill
selection ambiguous.

## Prepare Scribery

In `scribery-tui`:

1. Create documentation named `pi-skills`.
2. Choose **Configure sources** → **Add directory**.
3. Select `~/.pi/agent/skills` and use a mount path such as `skills`.
4. Choose **Index documentation**.

Use the same ordinary **Index documentation** action after skill files change.
Scribery discovers additions, modifications, and deletions while reusing
unchanged chunks and embeddings.

## Install in Pi

```sh
cd /Users/donais/Documents/Projects/knowledge-gateway-mcp
npm install
npm run check
pi install /Users/donais/Documents/Projects/knowledge-gateway-mcp
```

The Pi extension is generated at `dist/pi-extension.js`. Configure it through
environment variables before starting Pi. For example:

```sh
export KNOWLEDGE_GATEWAY_SCRIBERY_COMMAND=/Users/donais/Documents/Projects/scribery/packages/scribery/dist/mcp.js
export KNOWLEDGE_GATEWAY_DOCUMENTATION=pi-skills
export KNOWLEDGE_GATEWAY_SCRIBERY_PROFILE=omlx-qwen3
export KNOWLEDGE_GATEWAY_SCRIBERY_API_KEY=omlx
pi
```

Available settings are:

- `KNOWLEDGE_GATEWAY_SKILLS_ROOT` — defaults to `$PI_CODING_AGENT_DIR/skills`
  or `~/.pi/agent/skills`;
- `KNOWLEDGE_GATEWAY_DOCUMENTATION` — defaults to `pi-skills`;
- `KNOWLEDGE_GATEWAY_SCRIBERY_COMMAND` — defaults to `scribery-mcp`;
- `KNOWLEDGE_GATEWAY_SCRIBERY_PROFILE`;
- `KNOWLEDGE_GATEWAY_SCRIBERY_BASE_URL`;
- `KNOWLEDGE_GATEWAY_SCRIBERY_API_KEY`;
- `KNOWLEDGE_GATEWAY_SCRIBERY_RERANK_MODEL`;
- `KNOWLEDGE_GATEWAY_SCRIBERY_RERANK_INSTRUCTION`.

Use either a Scribery profile or explicit base-URL/reranking settings, not both.

Pi skill discovery must remain enabled. Individual gateway skills should still
set `disable-model-invocation: true`; this hides their descriptions from Pi's
model catalog without preventing the extension from invoking `/skill:name`.

## Security boundary

- Filesystem and Scribery operations are read-only. Native skill activation adds
  a user message to the current Pi session.
- There is no `list_skills`, indexing, synchronization, or manifest tool.
- Search is hard-scoped to indexed files owned by eligible skills.
- Manual skills are neither searchable nor loadable through the gateway.
- `load_skill` accepts only manifest-listed, skill-relative paths and rejects
  traversal, binary files, oversized files, and oversized combined responses.
- The model cannot select documentation identifiers, provider settings,
  reranking settings, arbitrary source identifiers, or Scribery tools.
- The selected skill is validated through gateway policy before Pi expands it.

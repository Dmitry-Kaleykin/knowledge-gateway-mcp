# knowledge-gateway-mcp

A policy-aware knowledge gateway that discovers Pi skills, uses Scribery for
semantic retrieval and reranking, and exposes both a generic MCP server and a
Pi-native adapter.

Both adapters expose exactly two model-facing tools:

- `search_skills` searches eligible skill packages without revealing the full catalog;
- `load_skill` activates `SKILL.md` or loads explicitly selected references from
  a returned skill.

In the generic MCP adapter, `load_skill` returns `SKILL.md` as an MCP tool result.
In the Pi adapter, the same call is handed to Pi's native `/skill:name` pipeline,
so the skill becomes a user-role skill message with Pi's collapsible skill widget.
Explicit reference-file requests remain ordinary tool results.

Scribery remains generic and project-scoped. The gateway starts its own private,
read-only Scribery MCP subprocess with only `list_documentation_sources` and
`search_documentation` enabled. Those underlying tools are never exposed to Pi.
This external runtime relationship is also declared under the custom
`knowledgeGateway.externalServices` package metadata. It is intentionally not an
npm dependency because no Scribery package assets are imported or bundled.

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
- `pinned` — eligible for search/load and advertised in the active adapter's instructions.

Missing `metadata.invocation` defaults safely to `manual`. A `retrieved` or
`pinned` skill without `disable-model-invocation: true` is excluded, preventing
the same skill from appearing through both Pi's native catalog and the gateway.

## Automatic manifest

The in-memory skill manifest is built when an adapter starts and refreshed
internally before every search or load. There is no manifest-management tool.

Discovery is recursive below the configured Pi skills root. Each directory
containing `SKILL.md` becomes one skill package; nested files such as
`references/*.md`, scripts and assets belong to that package. File hashes are
cached by size and filesystem timestamps during the adapter lifetime, while a
package hash and whole-manifest hash change whenever relevant files change.

Scribery's active indexed-file inventory supplies each result's original absolute
location. The gateway uses that location to map a hit in a nested reference back
to the owning `SKILL.md`. Duplicate filenames therefore do not create ambiguous
skill selection.

## Prepare Scribery

In `scribery-tui`:

1. Create documentation named `pi-skills`.
2. Choose **Configure sources** → **Add directory**.
3. Select `~/.pi/agent/skills` and use a mount path such as `skills`.
4. Choose **Index documentation**.

Use the same ordinary **Index documentation** action after skill files change.
Scribery discovers additions, modifications and deletions and reuses unchanged
chunks and embeddings.

## Build and test

```sh
npm install
npm run check
```

The MCP executable is generated at `dist/cli.js`; the Pi adapter is generated at
`dist/pi-extension.js`.

## Pi-native adapter

The Pi adapter is the preferred integration when Pi is the host. Build the
package, then install this repository as a global local-path Pi package:

```sh
cd /Users/donais/Documents/Projects/knowledge-gateway-mcp
npm run build
pi install /Users/donais/Documents/Projects/knowledge-gateway-mcp
```

Configure the adapter with the environment variables listed below before
starting Pi. For example:

```sh
export KNOWLEDGE_GATEWAY_SCRIBERY_COMMAND=/Users/donais/Documents/Projects/scribery/packages/scribery/dist/mcp.js
export KNOWLEDGE_GATEWAY_DOCUMENTATION=pi-skills
export KNOWLEDGE_GATEWAY_SCRIBERY_PROFILE=omlx-qwen3
export KNOWLEDGE_GATEWAY_SCRIBERY_API_KEY=omlx
pi
```

Do not enable the scoped-MCP registration below at the same time. Both adapters
use the names `search_skills` and `load_skill`, so Pi should load exactly one
adapter.

Pi skill discovery must remain enabled. Individual gateway skills should still
set `disable-model-invocation: true`; this hides their descriptions from Pi's
model catalog without preventing the adapter from invoking `/skill:name`.

When the model calls `load_skill` without `files` (or explicitly requests only
`SKILL.md`), the adapter validates gateway policy and queues the native skill
command as a steering user message. When `files` contains reference paths, the
gateway returns those files directly without reinvoking the skill.

## Generic MCP adapter

With a Scribery provider profile:

```sh
./dist/cli.js \
  --skills-root /Users/donais/.pi/agent/skills \
  --documentation pi-skills \
  --scribery-command /Users/donais/Documents/Projects/scribery/packages/scribery/dist/mcp.js \
  --profile omlx-qwen3 \
  --api-key omlx
```

The following environment variables correspond to the command-line options:

- `KNOWLEDGE_GATEWAY_SKILLS_ROOT`
- `KNOWLEDGE_GATEWAY_DOCUMENTATION`
- `KNOWLEDGE_GATEWAY_SCRIBERY_COMMAND`
- `KNOWLEDGE_GATEWAY_SCRIBERY_PROFILE`
- `KNOWLEDGE_GATEWAY_SCRIBERY_BASE_URL`
- `KNOWLEDGE_GATEWAY_SCRIBERY_API_KEY`
- `KNOWLEDGE_GATEWAY_SCRIBERY_RERANK_MODEL`
- `KNOWLEDGE_GATEWAY_SCRIBERY_RERANK_INSTRUCTION`

### Global scoped-mcp registration

Add a reusable profile and include it from `$global`:

```json
{
  "$global": {
    "profiles": ["knowledge-gateway"]
  },
  "$profiles": {
    "knowledge-gateway": {
      "mcpServers": {
        "knowledge-gateway": {
          "type": "stdio",
          "command": "/Users/donais/Documents/Projects/knowledge-gateway-mcp/dist/cli.js",
          "args": [
            "--scribery-command",
            "/Users/donais/Documents/Projects/scribery/packages/scribery/dist/mcp.js",
            "--documentation",
            "pi-skills",
            "--profile",
            "omlx-qwen3",
            "--api-key",
            "omlx"
          ],
          "lifecycle": "lazy",
          "toolPrefix": "none",
          "directTools": true,
          "includeTools": ["search_skills", "load_skill"],
          "autoApprove": ["search_skills", "load_skill"]
        }
      }
    }
  }
}
```

Merge these entries into the existing registry instead of replacing its other
global profiles. Reload Pi after saving it.

## Security boundary

- All gateway filesystem and Scribery operations are read-only. Pi-native skill
  activation adds a user message to the current Pi session.
- There is no `list_skills` tool.
- Search is hard-scoped to indexed files owned by eligible skills.
- Manual skills are neither searchable nor loadable through the gateway.
- `load_skill` accepts only manifest-listed, skill-relative paths and rejects
  traversal, binary files, oversized files and oversized combined responses.
- The model cannot select documentation identifiers, tags, provider settings,
  reranking settings or arbitrary source identifiers.
- The Pi adapter validates the selected skill through the same gateway policy
  before asking Pi to expand `/skill:name`.

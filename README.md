# knowledge-gateway-mcp

A small global MCP server that discovers Pi skills, applies invocation policy,
uses Scribery for semantic retrieval and reranking, and loads only the skill files
selected for the current task.

The gateway exposes exactly two read-only tools:

- `search_skills` searches eligible skill packages without revealing the full catalog;
- `load_skill` loads `SKILL.md` or explicitly selected references from a returned skill.

Scribery remains generic and project-scoped. The gateway starts its own private,
read-only Scribery MCP subprocess with only `list_documentation_sources` and
`search_documentation` enabled. Those underlying tools are never exposed to Pi.

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
- `pinned` — eligible for search/load and advertised in the MCP server instructions.

Missing `metadata.invocation` defaults safely to `manual`. A `retrieved` or
`pinned` skill without `disable-model-invocation: true` is excluded, preventing
the same skill from appearing through both Pi's native catalog and the gateway.

## Automatic manifest

The in-memory skill manifest is built when the MCP server starts and refreshed
internally before every search or load. There is no manifest-management tool.

Discovery is recursive below the configured Pi skills root. Each directory
containing `SKILL.md` becomes one skill package; nested files such as
`references/*.md`, scripts and assets belong to that package. File hashes are
cached by size and filesystem timestamps during the server lifetime, while a
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

The executable is generated at `dist/cli.js`.

## Run

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

## Global scoped-mcp registration

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

- All exposed operations are read-only.
- There is no `list_skills` tool.
- Search is hard-scoped to indexed files owned by eligible skills.
- Manual skills are neither searchable nor loadable through the gateway.
- `load_skill` accepts only manifest-listed, skill-relative paths and rejects
  traversal, binary files, oversized files and oversized combined responses.
- The model cannot select documentation identifiers, tags, provider settings,
  reranking settings or arbitrary source identifiers.

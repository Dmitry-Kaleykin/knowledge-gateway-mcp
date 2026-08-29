import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import type { KnowledgeBackend } from "./contracts.js";
import { KnowledgeGateway } from "./gateway.js";
import { createKnowledgeGatewayServer } from "./server.js";
import { SkillCatalog } from "./skills/catalog.js";

describe("knowledge gateway MCP server", () => {
    it("advertises only the search and exact-load read-only tools", async () => {
        const root = await mkdtemp(join(tmpdir(), "knowledge-gateway-mcp-"));
        const skillRoot = join(root, "example");
        await mkdir(skillRoot, { recursive: true });
        await writeFile(join(skillRoot, "SKILL.md"), `---
name: example
description: Example specialized guidance
disable-model-invocation: true
metadata:
  invocation: retrieved
---
# Example
Follow this guidance.
`, "utf8");
        const catalog = new SkillCatalog(root);
        const backend: KnowledgeBackend = {
            async listSources() {
                return [{
                    sourceId: "example-source",
                    logicalPath: "skills/example/SKILL.md",
                    originalLocation: join(skillRoot, "SKILL.md"),
                }];
            },
            async search() {
                return [{
                    sourceId: "example-source",
                    path: "skills/example/SKILL.md",
                    content: "Example match",
                    score: 1,
                }];
            },
            async close() {},
        };
        const gateway = new KnowledgeGateway(catalog, backend);
        await gateway.initialize();
        const server = createKnowledgeGatewayServer(gateway, catalog, "test");
        const client = new Client({ name: "test-client", version: "test" });
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await server.connect(serverTransport);
        await client.connect(clientTransport);
        try {
            const { tools } = await client.listTools();
            assert.deepEqual(tools.map(({ name }) => name), ["search_skills", "load_skill"]);
            assert.ok(tools.every(({ annotations }) =>
                annotations?.readOnlyHint === true &&
                annotations.destructiveHint === false &&
                annotations.idempotentHint === true
            ));
            assert.doesNotMatch(JSON.stringify(tools), /list_skills/u);
            const searched = await client.callTool({
                name: "search_skills",
                arguments: { query: "example task" },
            });
            assert.equal(searched.isError, undefined);
            assert.deepEqual(
                (searched.structuredContent as { matches: { name: string }[] }).matches
                    .map(({ name }) => name),
                ["example"],
            );
            const loaded = await client.callTool({
                name: "load_skill",
                arguments: { name: "example" },
            });
            assert.match(textContent(loaded.content), /Follow this guidance/u);
        } finally {
            await client.close();
            await server.close();
            await rm(root, { recursive: true, force: true });
        }
    });
});

function textContent(content: unknown): string {
    if (!Array.isArray(content)) return "";
    return content
        .filter((item): item is { type: "text"; text: string } =>
            typeof item === "object" && item !== null &&
            "type" in item && item.type === "text" &&
            "text" in item && typeof item.text === "string"
        )
        .map(({ text }) => text)
        .join("\n");
}

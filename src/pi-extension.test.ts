import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";

import type {
    IndexedSkillSource,
    SkillRetrievalBackend,
    SkillRetrievalResult,
} from "./contracts.js";
import { SkillsRetrieval } from "./retrieval.js";
import { registerSkillsRetrievalPiTools } from "./pi-extension.js";
import { SkillCatalog } from "./skills/catalog.js";

describe("Skills Retrieval Pi extension", () => {
    it("activates SKILL.md natively and returns references as tool results", async () => {
        const root = await mkdtemp(join(tmpdir(), "skills-retrieval-pi-"));
        try {
            const skillRoot = join(root, "example");
            await mkdir(join(skillRoot, "references"), { recursive: true });
            await writeFile(join(skillRoot, "SKILL.md"), `---
name: example
description: Example specialized guidance
disable-model-invocation: true
---
# Example
Follow this guidance.
`, "utf8");
            await writeFile(
                join(skillRoot, "references", "details.md"),
                "Reference details\n",
                "utf8",
            );
            const catalog = new SkillCatalog(root);
            const backend = new FakeBackend(
                [{
                    sourceId: "example-source",
                    logicalPath: "skills/example/SKILL.md",
                    originalLocation: join(skillRoot, "SKILL.md"),
                }],
                [{
                    sourceId: "example-source",
                    path: "skills/example/SKILL.md",
                    content: "Example match",
                    score: 1,
                }],
            );
            const retrieval = new SkillsRetrieval(catalog, backend);
            await retrieval.initialize();
            const harness = new PiHarness();
            registerSkillsRetrievalPiTools(
                harness.api,
                retrieval,
            );

            assert.deepEqual([...harness.tools.keys()], ["search_skills", "load_skill"]);
            const searched = await harness.execute("search_skills", {
                query: "example task",
            });
            assert.match(textContent(searched), /"name": "example"/u);

            const activated = await harness.execute("load_skill", { name: "example" });
            assert.match(textContent(activated), /native skill pipeline/u);
            assert.deepEqual(harness.messages, [{
                content: "/skill:example",
                options: {
                    deliverAs: "steer",
                    expandPromptTemplates: true,
                },
            }]);

            const explicitEntrypoint = await harness.execute("load_skill", {
                name: "example",
                files: ["SKILL.md"],
            });
            assert.match(textContent(explicitEntrypoint), /native skill pipeline/u);
            assert.equal(harness.messages.length, 2);

            const reference = await harness.execute("load_skill", {
                name: "example",
                files: ["references/details.md"],
            });
            assert.match(textContent(reference), /Reference details/u);
            assert.equal(harness.messages.length, 2);

            await harness.shutdown();
            assert.equal(backend.closed, true);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});

class PiHarness {
    readonly tools = new Map<string, ToolDefinition>();
    readonly messages: Array<{
        content: string;
        options: { deliverAs?: "steer" | "followUp"; expandPromptTemplates?: boolean };
    }> = [];
    #shutdown: (() => Promise<void> | void) | undefined;

    readonly api = {
        registerTool: (tool: ToolDefinition) => this.tools.set(tool.name, tool),
        sendUserMessage: (
            content: string,
            options: { deliverAs?: "steer" | "followUp"; expandPromptTemplates?: boolean } = {},
        ) => this.messages.push({ content, options }),
        on: (event: string, handler: () => Promise<void> | void) => {
            if (event === "session_shutdown") this.#shutdown = handler;
        },
    } as unknown as ExtensionAPI;

    async execute(name: string, parameters: Record<string, unknown>) {
        const tool = this.tools.get(name);
        assert.ok(tool, `Missing tool ${name}`);
        return tool.execute("call", parameters, undefined, undefined, {} as never);
    }

    async shutdown(): Promise<void> {
        await this.#shutdown?.();
    }
}

class FakeBackend implements SkillRetrievalBackend {
    closed = false;

    constructor(
        readonly sources: readonly IndexedSkillSource[],
        readonly results: readonly SkillRetrievalResult[],
    ) {}

    async listSources(): Promise<readonly IndexedSkillSource[]> {
        return this.sources;
    }

    async search(): Promise<readonly SkillRetrievalResult[]> {
        return this.results;
    }

    async close(): Promise<void> {
        this.closed = true;
    }
}

function textContent(result: { content: unknown }): string {
    if (!Array.isArray(result.content)) return "";
    return result.content
        .filter((item): item is { type: "text"; text: string } =>
            typeof item === "object" && item !== null &&
            "type" in item && item.type === "text" &&
            "text" in item && typeof item.text === "string"
        )
        .map(({ text }) => text)
        .join("\n");
}

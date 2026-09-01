import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import type {
    IndexedSkillSource,
    SkillRetrievalBackend,
    SkillRetrievalResult,
} from "./contracts.js";
import { SkillsRetrieval } from "./retrieval.js";
import { SkillCatalog } from "./skills/catalog.js";

describe("SkillsRetrieval", () => {
    it("hard-scopes retrieval, groups nested hits, and loads selected files", async () => {
        const root = await mkdtemp(join(tmpdir(), "skills-retrieval-"));
        try {
            await createSkill(root, "alpha", "retrieved", {
                "references/alpha.md": "Alpha reference details\n",
            });
            await createSkill(root, "beta", "pinned");
            await createSkill(root, "manual", "manual");
            const alphaSkill = join(root, "alpha", "SKILL.md");
            const alphaReference = join(root, "alpha", "references", "alpha.md");
            const betaSkill = join(root, "beta", "SKILL.md");
            const manualSkill = join(root, "manual", "SKILL.md");
            const backend = new FakeBackend(
                [
                    { sourceId: "alpha-main", logicalPath: "skills/alpha/SKILL.md", originalLocation: alphaSkill },
                    { sourceId: "alpha-ref", logicalPath: "skills/alpha/references/alpha.md", originalLocation: alphaReference },
                    { sourceId: "beta-main", logicalPath: "skills/beta/SKILL.md", originalLocation: betaSkill },
                    { sourceId: "manual-main", logicalPath: "skills/manual/SKILL.md", originalLocation: manualSkill },
                ],
                [
                    { sourceId: "alpha-main", path: "skills/alpha/SKILL.md", content: "Alpha main match", score: 0.6 },
                    { sourceId: "alpha-ref", path: "skills/alpha/references/alpha.md", content: "Alpha   reference\nmatch", score: 0.8 },
                    { sourceId: "beta-main", path: "skills/beta/SKILL.md", content: "Beta match", score: 0.5, rerankScore: 0.9 },
                    { sourceId: "manual-main", path: "skills/manual/SKILL.md", content: "Must be excluded", score: 1 },
                ],
            );
            const catalog = new SkillCatalog(root);
            const retrieval = new SkillsRetrieval(catalog, backend);
            await retrieval.initialize();

            const response = await retrieval.searchSkills("specialized task", 2);
            assert.deepEqual(backend.requestedSourceIds.sort(), [
                "alpha-main",
                "alpha-ref",
                "beta-main",
            ]);
            assert.deepEqual(response.matches.map(({ name }) => name), ["beta", "alpha"]);
            assert.equal(response.matches[1]?.matchedFile, "references/alpha.md");
            assert.equal(response.matches[1]?.matchedExcerpt, "Alpha reference match");

            const loaded = await retrieval.loadSkill("alpha");
            assert.deepEqual(loaded.files.map(({ path }) => path), ["SKILL.md"]);
            assert.ok(loaded.availableFiles.includes("references/alpha.md"));
            const reference = await retrieval.loadSkill("alpha", ["references/alpha.md"]);
            assert.equal(reference.files[0]?.content, "Alpha reference details\n");
            await assert.rejects(retrieval.loadSkill("manual"), /Manual skills cannot be loaded/u);
            await retrieval.close();
            assert.equal(backend.closed, true);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});

class FakeBackend implements SkillRetrievalBackend {
    requestedSourceIds: string[] = [];
    closed = false;

    constructor(
        readonly sources: readonly IndexedSkillSource[],
        readonly results: readonly SkillRetrievalResult[],
    ) {}

    async listSources(): Promise<readonly IndexedSkillSource[]> {
        return this.sources;
    }

    async search(request: {
        query: string;
        sourceIds: readonly string[];
        limit: number;
    }): Promise<readonly SkillRetrievalResult[]> {
        this.requestedSourceIds = [...request.sourceIds];
        const allowed = new Set(request.sourceIds);
        return this.results.filter(({ sourceId }) =>
            sourceId !== undefined && allowed.has(sourceId)
        );
    }

    async close(): Promise<void> {
        this.closed = true;
    }
}

async function createSkill(
    root: string,
    name: string,
    invocation: "manual" | "retrieved" | "pinned",
    files: Readonly<Record<string, string>> = {},
): Promise<void> {
    const skillRoot = join(root, name);
    await mkdir(skillRoot, { recursive: true });
    await writeFile(join(skillRoot, "SKILL.md"), `---
name: ${name}
description: ${name} skill description
disable-model-invocation: true
metadata:
  invocation: ${invocation}
---
# ${name}
Instructions for ${name}.
`, "utf8");
    for (const [path, content] of Object.entries(files)) {
        const absolutePath = join(skillRoot, path);
        await mkdir(join(absolutePath, ".."), { recursive: true });
        await writeFile(absolutePath, content, "utf8");
    }
}

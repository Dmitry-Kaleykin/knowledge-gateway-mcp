import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { SkillCatalog } from "./catalog.js";

describe("SkillCatalog", () => {
    it("builds and refreshes a nested, policy-aware skill manifest", async () => {
        const root = await mkdtemp(join(tmpdir(), "knowledge-skills-"));
        try {
            await createSkill(root, "retrieved-skill", "retrieved", true, {
                "references/details.md": "Original nested details\n",
            });
            await createSkill(root, "manual-skill", "manual", true);
            await createSkill(root, "unsafe-skill", "retrieved", false);

            const catalog = new SkillCatalog(root);
            const first = await catalog.refresh();
            assert.equal(first.skills.length, 3);
            assert.deepEqual(catalog.accessibleSkills().map(({ name }) => name), [
                "retrieved-skill",
            ]);
            assert.ok(first.diagnostics.some(({ code, path }) =>
                code === "native-model-invocation-enabled" && path.includes("unsafe-skill")
            ));
            const retrieved = catalog.findAccessibleSkill("RETRIEVED-SKILL");
            assert.ok(retrieved);
            assert.deepEqual(retrieved.files.map(({ relativePath }) => relativePath), [
                "references/details.md",
                "SKILL.md",
            ]);
            assert.equal(
                await catalog.readTextFile(retrieved, "references/details.md"),
                "Original nested details\n",
            );
            await assert.rejects(
                catalog.readTextFile(retrieved, "../manual-skill/SKILL.md"),
                /relative path inside the skill package/u,
            );

            const firstHash = retrieved.packageHash;
            await writeFile(
                join(root, "retrieved-skill", "references", "details.md"),
                "Updated nested details\n",
                "utf8",
            );
            const second = await catalog.refresh();
            assert.notEqual(second.manifestHash, first.manifestHash);
            assert.notEqual(catalog.findAccessibleSkill("retrieved-skill")?.packageHash, firstHash);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it("treats a missing invocation policy as manual", async () => {
        const root = await mkdtemp(join(tmpdir(), "knowledge-manual-default-"));
        try {
            const skillRoot = join(root, "legacy");
            await mkdir(skillRoot, { recursive: true });
            await writeFile(join(skillRoot, "SKILL.md"), `---
name: legacy
description: Not automatically retrievable
disable-model-invocation: true
---
# Legacy
`, "utf8");
            const catalog = new SkillCatalog(root);
            const manifest = await catalog.refresh();
            assert.equal(manifest.skills[0]?.invocation, "manual");
            assert.deepEqual(catalog.accessibleSkills(), []);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});

async function createSkill(
    root: string,
    name: string,
    invocation: "manual" | "retrieved" | "pinned",
    disabled: boolean,
    files: Readonly<Record<string, string>> = {},
): Promise<void> {
    const skillRoot = join(root, name);
    await mkdir(skillRoot, { recursive: true });
    await writeFile(join(skillRoot, "SKILL.md"), `---
name: ${name}
description: Description for ${name}
disable-model-invocation: ${String(disabled)}
metadata:
  invocation: ${invocation}
---
# ${name}
`, "utf8");
    for (const [path, content] of Object.entries(files)) {
        const absolutePath = join(skillRoot, path);
        await mkdir(join(absolutePath, ".."), { recursive: true });
        await writeFile(absolutePath, content, "utf8");
    }
}

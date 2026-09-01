import { createHash } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import type {
    SkillFile,
    SkillManifest,
    SkillManifestDiagnostic,
    SkillManifestEntry,
} from "../contracts.js";
import { parseSkillFrontmatter } from "./frontmatter.js";

export class SkillCatalog {
    readonly skillsRoot: string;
    #manifest: SkillManifest | undefined;
    readonly #fileCache = new Map<string, CachedFile>();

    constructor(skillsRoot: string) {
        this.skillsRoot = resolve(skillsRoot);
    }

    get manifest(): SkillManifest {
        if (this.#manifest === undefined) {
            throw new Error("Skill catalog has not been initialized");
        }
        return this.#manifest;
    }

    async refresh(): Promise<SkillManifest> {
        const root = await realpath(this.skillsRoot);
        const roots = await discoverSkillRoots(root);
        const skills: SkillManifestEntry[] = [];
        const diagnostics: SkillManifestDiagnostic[] = [];

        for (const skillRoot of roots) {
            const entrypoint = resolve(skillRoot, "SKILL.md");
            try {
                const files = await this.#collectFiles(skillRoot);
                const entry = files.find(({ relativePath }) => relativePath === "SKILL.md");
                if (entry === undefined) continue;
                const content = decodeUtf8(await readFile(entrypoint), entrypoint);
                const frontmatter = parseSkillFrontmatter(content, entrypoint);
                if (!frontmatter.disableModelInvocation) {
                    diagnostics.push({
                        path: entrypoint,
                        code: "native-model-invocation-enabled",
                        message: "Retrieved skills must set disable-model-invocation: true",
                    });
                }
                skills.push({
                    name: frontmatter.name,
                    description: frontmatter.description,
                    disableModelInvocation: frontmatter.disableModelInvocation,
                    root: skillRoot,
                    entrypoint,
                    files,
                    packageHash: hashText(JSON.stringify(files.map((file) => ({
                        path: file.relativePath,
                        hash: file.contentHash,
                    })))),
                });
            } catch (error: unknown) {
                diagnostics.push({
                    path: entrypoint,
                    code: "invalid-skill",
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        }

        const duplicateNames = duplicateValues(skills.map(({ name }) => name));
        for (const name of duplicateNames) {
            for (const skill of skills.filter((candidate) => candidate.name === name)) {
                diagnostics.push({
                    path: skill.entrypoint,
                    code: "duplicate-skill-name",
                    message: `Skill name ${name} is not unique`,
                });
            }
        }
        const unambiguousSkills = skills
            .filter(({ name }) => !duplicateNames.has(name))
            .sort((left, right) => left.name.localeCompare(right.name));
        const manifestHash = hashText(JSON.stringify(unambiguousSkills.map((skill) => ({
            name: skill.name,
            description: skill.description,
            disableModelInvocation: skill.disableModelInvocation,
            root: skill.root,
            packageHash: skill.packageHash,
        }))));
        this.#manifest = {
            skillsRoot: root,
            builtAt: new Date().toISOString(),
            manifestHash,
            skills: unambiguousSkills,
            diagnostics,
        };
        return this.#manifest;
    }

    retrievalCandidates(): readonly SkillManifestEntry[] {
        return this.manifest.skills.filter(isRetrievalCandidate);
    }

    findRetrievalCandidate(name: string): SkillManifestEntry | undefined {
        const normalized = name.trim().toLowerCase();
        return this.retrievalCandidates().find((skill) =>
            skill.name.toLowerCase() === normalized
        );
    }

    async readTextFile(skill: SkillManifestEntry, relativePath: string): Promise<string> {
        const normalized = normalizeRequestedPath(relativePath);
        const file = skill.files.find((candidate) => candidate.relativePath === normalized);
        if (file === undefined) {
            throw new Error(`File ${relativePath} does not belong to skill ${skill.name}`);
        }
        if (file.byteLength > 1_000_000) {
            throw new Error(`File ${relativePath} exceeds the 1000000-byte load limit`);
        }
        return decodeUtf8(await readFile(file.absolutePath), file.absolutePath);
    }

    async #collectFiles(skillRoot: string): Promise<readonly SkillFile[]> {
        const paths = await discoverRegularFiles(skillRoot);
        return Promise.all(paths.map(async (absolutePath) => {
            const metadata = await stat(absolutePath);
            const previous = this.#fileCache.get(absolutePath);
            if (
                previous !== undefined && previous.byteLength === metadata.size &&
                previous.modifiedAt === metadata.mtimeMs && previous.changedAt === metadata.ctimeMs
            ) {
                return previous.file;
            }
            const bytes = await readFile(absolutePath);
            const file: SkillFile = {
                relativePath: toPortablePath(relative(skillRoot, absolutePath)),
                absolutePath,
                byteLength: bytes.byteLength,
                contentHash: hashBytes(bytes),
            };
            this.#fileCache.set(absolutePath, {
                byteLength: metadata.size,
                modifiedAt: metadata.mtimeMs,
                changedAt: metadata.ctimeMs,
                file,
            });
            return file;
        })).then((files) => files.sort((left, right) =>
            left.relativePath.localeCompare(right.relativePath)
        ));
    }
}

interface CachedFile {
    byteLength: number;
    modifiedAt: number;
    changedAt: number;
    file: SkillFile;
}

export function isRetrievalCandidate(skill: SkillManifestEntry): boolean {
    return skill.disableModelInvocation;
}

async function discoverSkillRoots(root: string): Promise<readonly string[]> {
    const entries = await readdir(root, { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && entry.name === "SKILL.md")) {
        return [root];
    }
    const nested: string[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") {
            continue;
        }
        nested.push(...await discoverSkillRoots(resolve(root, entry.name)));
    }
    return nested;
}

async function discoverRegularFiles(root: string): Promise<readonly string[]> {
    const files: string[] = [];
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const path = resolve(root, entry.name);
        if (entry.isDirectory()) files.push(...await discoverRegularFiles(path));
        else if (entry.isFile()) files.push(path);
    }
    return files;
}

function normalizeRequestedPath(path: string): string {
    const normalized = toPortablePath(path.trim()).replace(/^\.\//u, "");
    if (
        normalized.length === 0 || normalized.startsWith("/") ||
        normalized.split("/").some((segment) => segment === ".." || segment.length === 0)
    ) {
        throw new Error("Skill file path must be a relative path inside the skill package");
    }
    return normalized;
}

function toPortablePath(path: string): string {
    return sep === "/" ? path : path.replaceAll(sep, "/");
}

function decodeUtf8(bytes: Uint8Array, path: string): string {
    if (bytes.includes(0)) throw new Error(`${path} is not a text file`);
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error: unknown) {
        throw new Error(`${path} is not valid UTF-8`, { cause: error });
    }
}

function hashBytes(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}

function hashText(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
}

function duplicateValues(values: readonly string[]): Set<string> {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const value of values) {
        if (seen.has(value)) duplicates.add(value);
        seen.add(value);
    }
    return duplicates;
}

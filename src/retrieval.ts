import { basename, resolve } from "node:path";
import { realpath } from "node:fs/promises";

import type {
    IndexedSkillSource,
    LoadedSkill,
    SkillManifestEntry,
    SkillRetrievalBackend,
    SkillRetrievalResult,
    SkillSearchMatch,
    SkillSearchResponse,
} from "./contracts.js";
import { SkillCatalog } from "./skills/catalog.js";

const DEFAULT_LIMIT = 3;
const MAXIMUM_LIMIT = 5;
const MAXIMUM_FILES_PER_LOAD = 10;
const MAXIMUM_LOAD_CHARACTERS = 250_000;

export class SkillsRetrieval {
    readonly #catalog: SkillCatalog;
    readonly #backend: SkillRetrievalBackend;

    constructor(catalog: SkillCatalog, backend: SkillRetrievalBackend) {
        this.#catalog = catalog;
        this.#backend = backend;
    }

    async initialize(): Promise<void> {
        await this.#catalog.refresh();
    }

    async searchSkills(
        query: string,
        limit = DEFAULT_LIMIT,
        signal?: AbortSignal,
    ): Promise<SkillSearchResponse> {
        const normalizedQuery = query.trim();
        if (normalizedQuery.length === 0) throw new Error("query must not be empty");
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAXIMUM_LIMIT) {
            throw new Error(`limit must be an integer from 1 to ${MAXIMUM_LIMIT}`);
        }
        await this.#catalog.refresh();
        const skills = this.#catalog.retrievalCandidates();
        if (skills.length === 0) {
            return {
                query: normalizedQuery,
                matches: [],
                instruction:
                    "No retrieval candidates are configured. Skills must set " +
                    "disable-model-invocation: true.",
            };
        }

        const sources = await this.#backend.listSources(signal);
        const sourceToSkill = await mapIndexedSkillSources(sources, skills);
        const sourceIds = [...sourceToSkill.keys()];
        if (sourceIds.length === 0) {
            return {
                query: normalizedQuery,
                matches: [],
                instruction:
                    "No eligible skill packages are present in the active Scribery documentation " +
                    "index. Add desired skill directories as sources and index them in Scribery.",
            };
        }

        const candidates = await this.#backend.search({
            query: normalizedQuery,
            sourceIds,
            limit: Math.min(100, Math.max(limit * 5, 15)),
        }, signal);
        const matches = bestMatchPerSkill(candidates, sourceToSkill)
            .sort((left, right) => right.score - left.score)
            .slice(0, limit);
        return {
            query: normalizedQuery,
            matches,
            instruction: matches.length === 0
                ? "No relevant skill was found. Continue without loading a skill."
                : "Choose only a genuinely relevant match, then call load_skill with its exact name. " +
                    "Read SKILL.md before applying it and load referenced files only when needed.",
        };
    }

    async loadSkill(name: string, files?: readonly string[]): Promise<LoadedSkill> {
        const skill = await this.resolveSkill(name);
        const requested = files === undefined ? ["SKILL.md"] : [...new Set(files)];
        if (requested.length === 0 || requested.length > MAXIMUM_FILES_PER_LOAD) {
            throw new Error(
                `files must contain between 1 and ${MAXIMUM_FILES_PER_LOAD} paths`,
            );
        }
        const loaded = await Promise.all(requested.map(async (path) => ({
            path,
            content: await this.#catalog.readTextFile(skill, path),
        })));
        const characters = loaded.reduce((sum, file) => sum + file.content.length, 0);
        if (characters > MAXIMUM_LOAD_CHARACTERS) {
            throw new Error(
                `Selected skill files exceed the ${MAXIMUM_LOAD_CHARACTERS}-character load limit`,
            );
        }
        return {
            name: skill.name,
            description: skill.description,
            entrypoint: skill.entrypoint,
            files: loaded,
            availableFiles: skill.files.map(({ relativePath }) => relativePath),
            packageHash: skill.packageHash,
            instruction:
                "Follow the loaded skill instructions. Load only the listed reference files that " +
                "the SKILL.md routing guidance requires for the current task.",
        };
    }

    async resolveSkill(name: string): Promise<SkillManifestEntry> {
        await this.#catalog.refresh();
        const skill = this.#catalog.findRetrievalCandidate(name);
        if (skill === undefined) {
            throw new Error(
                `Skill ${name} is not available to skills retrieval. It must exist and set disable-model-invocation: true.`,
            );
        }
        const sources = await this.#backend.listSources();
        const indexedSources = await mapIndexedSkillSources(sources, [skill]);
        if (indexedSources.size === 0) {
            throw new Error(
                `Skill ${name} is not available to skills retrieval because its SKILL.md is not indexed in Scribery.`,
            );
        }
        return skill;
    }

    close(): Promise<void> {
        return this.#backend.close();
    }
}

interface MappedSource {
    skill: SkillManifestEntry;
    relativePath: string;
}

async function mapIndexedSkillSources(
    sources: readonly IndexedSkillSource[],
    skills: readonly SkillManifestEntry[],
): Promise<ReadonlyMap<string, MappedSource>> {
    const mapped = new Map<string, MappedSource>();
    for (const source of sources) {
        const originalLocation = source.originalLocation === undefined
            ? undefined
            : await realpath(source.originalLocation).catch(() => resolve(source.originalLocation!));
        const matches = skills.flatMap((skill) => skill.files
            .filter((file) =>
                originalLocation === undefined
                    ? source.logicalPath === `${basename(skill.root)}/${file.relativePath}` ||
                        source.logicalPath.endsWith(
                            `/${basename(skill.root)}/${file.relativePath}`,
                        )
                    : originalLocation === file.absolutePath
            )
            .map((file) => ({ skill, relativePath: file.relativePath }))
        );
        if (matches.length === 1) mapped.set(source.sourceId, matches[0]!);
    }
    const indexedSkillRoots = new Set(
        [...mapped.values()]
            .filter(({ relativePath }) => relativePath === "SKILL.md")
            .map(({ skill }) => skill.root),
    );
    return new Map(
        [...mapped.entries()].filter(([, { skill }]) =>
            indexedSkillRoots.has(skill.root)
        ),
    );
}

function bestMatchPerSkill(
    results: readonly SkillRetrievalResult[],
    sourceToSkill: ReadonlyMap<string, MappedSource>,
): SkillSearchMatch[] {
    const best = new Map<string, SkillSearchMatch>();
    for (const result of results) {
        if (result.sourceId === undefined) continue;
        const mapped = sourceToSkill.get(result.sourceId);
        if (mapped === undefined) continue;
        const score = result.rerankScore ?? result.score;
        const match: SkillSearchMatch = {
            name: mapped.skill.name,
            description: mapped.skill.description,
            matchedFile: mapped.relativePath,
            matchedExcerpt: excerpt(result.content),
            score,
        };
        const previous = best.get(mapped.skill.name);
        if (previous === undefined || match.score > previous.score) {
            best.set(mapped.skill.name, match);
        }
    }
    return [...best.values()];
}

function excerpt(content: string): string {
    const normalized = content.replace(/\s+/gu, " ").trim();
    return normalized.length <= 600 ? normalized : `${normalized.slice(0, 597)}…`;
}

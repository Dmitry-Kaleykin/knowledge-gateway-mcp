export interface SkillFile {
    relativePath: string;
    absolutePath: string;
    byteLength: number;
    contentHash: string;
}

export interface SkillManifestEntry {
    name: string;
    description: string;
    disableModelInvocation: boolean;
    root: string;
    entrypoint: string;
    files: readonly SkillFile[];
    packageHash: string;
}

export interface SkillManifestDiagnostic {
    path: string;
    code: string;
    message: string;
}

export interface SkillManifest {
    skillsRoot: string;
    builtAt: string;
    manifestHash: string;
    skills: readonly SkillManifestEntry[];
    diagnostics: readonly SkillManifestDiagnostic[];
}

export interface IndexedSkillSource {
    sourceId: string;
    logicalPath: string;
    originalLocation?: string;
}

export interface SkillRetrievalResult {
    sourceId?: string;
    path: string;
    content: string;
    score: number;
    semanticScore?: number;
    rerankScore?: number;
}

export interface SkillRetrievalBackend {
    listSources(signal?: AbortSignal): Promise<readonly IndexedSkillSource[]>;
    search(
        request: {
            query: string;
            sourceIds: readonly string[];
            limit: number;
        },
        signal?: AbortSignal,
    ): Promise<readonly SkillRetrievalResult[]>;
    close(): Promise<void>;
}

export interface SkillSearchMatch {
    name: string;
    description: string;
    matchedFile: string;
    matchedExcerpt: string;
    score: number;
}

export interface SkillSearchResponse {
    query: string;
    matches: readonly SkillSearchMatch[];
    instruction: string;
}

export interface LoadedSkillFile {
    path: string;
    content: string;
}

export interface LoadedSkill {
    name: string;
    description: string;
    entrypoint: string;
    files: readonly LoadedSkillFile[];
    availableFiles: readonly string[];
    packageHash: string;
    instruction: string;
}

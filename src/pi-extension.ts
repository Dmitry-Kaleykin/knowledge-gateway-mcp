import type {
    AgentToolResult,
    ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { ScriberyMcpBackend } from "./backends/scribery-mcp-backend.js";
import { configurationFromEnvironment } from "./config.js";
import type {
    LoadedSkill,
    SkillSearchResponse,
} from "./contracts.js";
import { SkillsRetrieval } from "./retrieval.js";
import { SkillCatalog } from "./skills/catalog.js";

const SEARCH_LIMIT = 3;

export default async function skillsRetrievalPiExtension(
    pi: ExtensionAPI,
): Promise<void> {
    const configuration = configurationFromEnvironment();
    const catalog = new SkillCatalog(configuration.skillsRoot);
    const retrieval = new SkillsRetrieval(
        catalog,
        new ScriberyMcpBackend(configuration),
    );
    await retrieval.initialize();
    registerSkillsRetrievalPiTools(pi, retrieval);
}

export function registerSkillsRetrievalPiTools(
    pi: ExtensionAPI,
    retrieval: Pick<
        SkillsRetrieval,
        "searchSkills" | "loadSkill" | "resolveSkill" | "close"
    >,
): void {
    pi.registerTool({
        name: "search_skills",
        label: "Search Skills",
        description:
            "Search the local skill library for specialized instructions. Returns relevant " +
            "candidates without exposing the full catalog. Call load_skill only for a " +
            "genuinely relevant exact match.",
        promptSnippet: "Search the local skill library for task-specific guidance",
        promptGuidelines: [
            "Use search_skills when specialized instructions or an established workflow may apply; never use it to enumerate skills.",
        ],
        parameters: Type.Object({
            query: Type.String({
                minLength: 1,
                description: "Describe the task and the specialized guidance needed.",
            }),
            limit: Type.Optional(Type.Integer({
                minimum: 1,
                maximum: 5,
                description: "Maximum number of distinct candidates to return.",
            })),
        }, { additionalProperties: false }),
        async execute(_toolCallId, parameters, signal) {
            const response = await retrieval.searchSkills(
                parameters.query,
                parameters.limit ?? SEARCH_LIMIT,
                signal,
            );
            return jsonToolResult(response);
        },
    });

    pi.registerTool({
        name: "load_skill",
        label: "Load Skill",
        description:
            "Load an exact skill returned by search_skills. Omit files to activate SKILL.md " +
            "through Pi's native skill pipeline. Pass skill-relative files only when the " +
            "active skill requires specific references.",
        promptSnippet: "Activate a selected skill or load one of its referenced files",
        promptGuidelines: [
            "Call load_skill only with an exact relevant name returned by search_skills, and omit files for the initial SKILL.md activation.",
        ],
        executionMode: "sequential",
        parameters: Type.Object({
            name: Type.String({
                minLength: 1,
                description: "Exact skill name returned by search_skills.",
            }),
            files: Type.Optional(Type.Array(Type.String({ minLength: 1 }), {
                minItems: 1,
                maxItems: 10,
                description:
                    "Skill-relative reference files. Omit this field to activate SKILL.md natively.",
            })),
        }, { additionalProperties: false }),
        async execute(_toolCallId, parameters): Promise<
            AgentToolResult<Record<string, unknown>>
        > {
            if (isEntrypointRequest(parameters.files)) {
                const skill = await retrieval.resolveSkill(parameters.name);
                pi.sendUserMessage(nativeSkillCommand(skill.name), {
                    deliverAs: "steer",
                    expandPromptTemplates: true,
                });
                return {
                    content: [{
                        type: "text",
                        text:
                            `Queued ${skill.name} through Pi's native skill pipeline. ` +
                            "Follow the injected skill message before continuing.",
                    }],
                    details: {
                        mode: "native",
                        name: skill.name,
                        entrypoint: skill.entrypoint,
                        packageHash: skill.packageHash,
                    },
                };
            }
            const loaded = await retrieval.loadSkill(parameters.name, parameters.files);
            return jsonToolResult(loaded, { mode: "files" });
        },
    });

    pi.on("session_shutdown", async () => {
        await retrieval.close();
    });
}

function isEntrypointRequest(files: readonly string[] | undefined): boolean {
    if (files === undefined) return true;
    return files.length === 1 && files[0]?.trim().replace(/^\.\//u, "") === "SKILL.md";
}

function nativeSkillCommand(name: string): string {
    if (
        name.length > 64 ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name)
    ) {
        throw new Error(
            `Skill ${name} cannot be activated natively because its name is not Pi-compatible`,
        );
    }
    return `/skill:${name}`;
}

function jsonToolResult(
    value: SkillSearchResponse | LoadedSkill,
    additionalDetails: Readonly<Record<string, unknown>> = {},
): AgentToolResult<Record<string, unknown>> {
    return {
        content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
        details: { ...additionalDetails, value },
    };
}

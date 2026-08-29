import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { SkillManifestEntry } from "./contracts.js";
import { KnowledgeGateway } from "./gateway.js";
import { SkillCatalog } from "./skills/catalog.js";

const READ_ONLY_ANNOTATIONS = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
} as const;

export function createKnowledgeGatewayServer(
    gateway: KnowledgeGateway,
    catalog: SkillCatalog,
    version: string,
): McpServer {
    const server = new McpServer(
        { name: "knowledge-gateway", version },
        { instructions: serverInstructions(catalog.manifest.skills) },
    );

    server.registerTool(
        "search_skills",
        {
            title: "Search for a skill",
            description:
                "Search within local library of skills. " +
                "Returns relevant candidates; it cannot list the complete skill catalog. " +
                "Call load_skill for a relevant match.",
            inputSchema: z.object({
                query: z.string().trim().min(1).describe(
                    "Describe the user's task and the specialized guidance needed.",
                ),
                limit: z.number().int().min(1).max(10).default(3).describe(
                    "Maximum number of distinct skill candidates to return.",
                ),
            }),
            annotations: READ_ONLY_ANNOTATIONS,
        },
        async ({ query, limit }, extra) => toolResult(
            () => gateway.searchSkills(query, limit, extra.signal),
        ),
    );

    server.registerTool(
        "load_skill",
        {
            title: "Load a found skill",
            description:
                "Load the complete skill for an exact skill name returned by search_skills.",
            inputSchema: z.object({
                name: z.string().trim().min(1).describe(
                    "Exact skill name returned by search_skills.",
                ),
                files: z.array(z.string().trim().min(1)).min(1).max(10).optional().describe(
                    "Optional skill-relative files to load instead of SKILL.md, such as references/api.md.",
                ),
            }),
            annotations: READ_ONLY_ANNOTATIONS,
        },
        async ({ name, files }) => toolResult(() => gateway.loadSkill(name, files)),
    );

    return server;
}

function serverInstructions(skills: readonly SkillManifestEntry[]): string {
    const pinned = skills.filter((skill) =>
        skill.disableModelInvocation && skill.invocation === "pinned"
    );
    return [
        "Use search_skills when specialized instructions or an established workflow may apply. " +
        "Never use it to enumerate skills. Load only a relevant result, read SKILL.md completely, " +
        "and follow its routing guidance before loading references.",
        ...(pinned.length === 0
            ? []
            : [
                "Pinned skills:\n" + pinned.map((skill) =>
                    `- ${skill.name}: ${skill.description}`
                ).join("\n"),
            ]),
    ].join("\n\n");
}

async function toolResult(operation: () => Promise<unknown>) {
    try {
        const value = await operation();
        const structuredContent = asRecord(value);
        return {
            content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
            structuredContent,
        };
    } catch (error: unknown) {
        return {
            isError: true,
            content: [{
                type: "text" as const,
                text: error instanceof Error ? error.message : String(error),
            }],
        };
    }
}

function asRecord(value: unknown): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return { value };
    }
    return Object.fromEntries(Object.entries(value));
}

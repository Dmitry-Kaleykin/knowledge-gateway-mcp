import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

export interface GatewayConfiguration {
    skillsRoot: string;
    documentation: string;
    scriberyCommand: string;
    scriberyProfile?: string;
    scriberyBaseUrl?: string;
    scriberyApiKey?: string;
    scriberyRerankModel?: string;
    scriberyRerankInstruction?: string;
}

export type CliConfiguration =
    | { mode: "run"; configuration: GatewayConfiguration }
    | { mode: "help" }
    | { mode: "version" };

export function parseConfiguration(
    args: readonly string[],
    environment: NodeJS.ProcessEnv = process.env,
): CliConfiguration {
    const parsed = parseArgs({
        args,
        options: {
            "skills-root": { type: "string" },
            documentation: { type: "string" },
            "scribery-command": { type: "string" },
            profile: { type: "string" },
            "base-url": { type: "string" },
            "api-key": { type: "string" },
            "rerank-model": { type: "string" },
            "rerank-instruction": { type: "string" },
            help: { type: "boolean", short: "h" },
            version: { type: "boolean", short: "v" },
        },
        strict: true,
    });
    if (parsed.values.help === true) return { mode: "help" };
    if (parsed.values.version === true) return { mode: "version" };

    const piAgentDirectory = environment.PI_CODING_AGENT_DIR?.trim() ||
        join(homedir(), ".pi", "agent");
    const scriberyProfile = optionalText(
        parsed.values.profile ?? environment.KNOWLEDGE_GATEWAY_SCRIBERY_PROFILE,
        "--profile",
    );
    const scriberyBaseUrl = optionalText(
        parsed.values["base-url"] ?? environment.KNOWLEDGE_GATEWAY_SCRIBERY_BASE_URL,
        "--base-url",
    );
    const scriberyRerankModel = optionalText(
        parsed.values["rerank-model"] ??
            environment.KNOWLEDGE_GATEWAY_SCRIBERY_RERANK_MODEL,
        "--rerank-model",
    );
    const scriberyRerankInstruction = optionalText(
        parsed.values["rerank-instruction"] ??
            environment.KNOWLEDGE_GATEWAY_SCRIBERY_RERANK_INSTRUCTION,
        "--rerank-instruction",
    );
    if (
        scriberyProfile !== undefined &&
        (scriberyBaseUrl !== undefined || scriberyRerankModel !== undefined ||
            scriberyRerankInstruction !== undefined)
    ) {
        throw new Error(
            "--profile cannot be combined with --base-url or reranking options",
        );
    }

    return {
        mode: "run",
        configuration: {
            skillsRoot: resolve(requiredText(
                parsed.values["skills-root"] ??
                    environment.KNOWLEDGE_GATEWAY_SKILLS_ROOT ??
                    join(piAgentDirectory, "skills"),
                "--skills-root",
            )),
            documentation: requiredText(
                parsed.values.documentation ??
                    environment.KNOWLEDGE_GATEWAY_DOCUMENTATION ??
                    "pi-skills",
                "--documentation",
            ),
            scriberyCommand: requiredText(
                parsed.values["scribery-command"] ??
                    environment.KNOWLEDGE_GATEWAY_SCRIBERY_COMMAND ??
                    "scribery-mcp",
                "--scribery-command",
            ),
            ...(scriberyProfile === undefined ? {} : { scriberyProfile }),
            ...(scriberyBaseUrl === undefined ? {} : { scriberyBaseUrl }),
            ...(optionalText(
                    parsed.values["api-key"] ??
                        environment.KNOWLEDGE_GATEWAY_SCRIBERY_API_KEY,
                    "--api-key",
                ) === undefined
                ? {}
                : {
                    scriberyApiKey: optionalText(
                        parsed.values["api-key"] ??
                            environment.KNOWLEDGE_GATEWAY_SCRIBERY_API_KEY,
                        "--api-key",
                    )!,
                }),
            ...(scriberyRerankModel === undefined ? {} : { scriberyRerankModel }),
            ...(scriberyRerankInstruction === undefined
                ? {}
                : { scriberyRerankInstruction }),
        },
    };
}

export function usage(): string {
    return `Knowledge Gateway MCP (read-only stdio)

Usage:
    knowledge-gateway-mcp [--skills-root <directory>]
        [--documentation <name-or-id>]
        [--scribery-command <path>] [--profile <name>] [--api-key <key>]
        [--base-url <url>] [--rerank-model <id>]
        [--rerank-instruction <text>]

Defaults:
    skills root    $PI_CODING_AGENT_DIR/skills or ~/.pi/agent/skills
    documentation pi-skills
    Scribery       scribery-mcp

The server exposes only search_skills and load_skill.`;
}

function requiredText(value: string, option: string): string {
    const trimmed = value.trim();
    if (trimmed.length === 0) throw new Error(`${option} must not be empty`);
    return trimmed;
}

function optionalText(value: string | undefined, option: string): string | undefined {
    return value === undefined ? undefined : requiredText(value, option);
}

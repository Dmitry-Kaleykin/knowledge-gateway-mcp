import { homedir } from "node:os";
import { join, resolve } from "node:path";

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

export function configurationFromEnvironment(
    environment: NodeJS.ProcessEnv = process.env,
): GatewayConfiguration {
    const piAgentDirectory = environment.PI_CODING_AGENT_DIR?.trim() ||
        join(homedir(), ".pi", "agent");
    const scriberyProfile = optionalText(
        environment.KNOWLEDGE_GATEWAY_SCRIBERY_PROFILE,
        "KNOWLEDGE_GATEWAY_SCRIBERY_PROFILE",
    );
    const scriberyBaseUrl = optionalText(
        environment.KNOWLEDGE_GATEWAY_SCRIBERY_BASE_URL,
        "KNOWLEDGE_GATEWAY_SCRIBERY_BASE_URL",
    );
    const scriberyRerankModel = optionalText(
        environment.KNOWLEDGE_GATEWAY_SCRIBERY_RERANK_MODEL,
        "KNOWLEDGE_GATEWAY_SCRIBERY_RERANK_MODEL",
    );
    const scriberyRerankInstruction = optionalText(
        environment.KNOWLEDGE_GATEWAY_SCRIBERY_RERANK_INSTRUCTION,
        "KNOWLEDGE_GATEWAY_SCRIBERY_RERANK_INSTRUCTION",
    );
    if (
        scriberyProfile !== undefined &&
        (scriberyBaseUrl !== undefined || scriberyRerankModel !== undefined ||
            scriberyRerankInstruction !== undefined)
    ) {
        throw new Error(
            "KNOWLEDGE_GATEWAY_SCRIBERY_PROFILE cannot be combined with " +
                "KNOWLEDGE_GATEWAY_SCRIBERY_BASE_URL or reranking settings",
        );
    }
    const scriberyApiKey = optionalText(
        environment.KNOWLEDGE_GATEWAY_SCRIBERY_API_KEY,
        "KNOWLEDGE_GATEWAY_SCRIBERY_API_KEY",
    );

    return {
        skillsRoot: resolve(requiredText(
            environment.KNOWLEDGE_GATEWAY_SKILLS_ROOT ??
                join(piAgentDirectory, "skills"),
            "KNOWLEDGE_GATEWAY_SKILLS_ROOT",
        )),
        documentation: requiredText(
            environment.KNOWLEDGE_GATEWAY_DOCUMENTATION ?? "pi-skills",
            "KNOWLEDGE_GATEWAY_DOCUMENTATION",
        ),
        scriberyCommand: requiredText(
            environment.KNOWLEDGE_GATEWAY_SCRIBERY_COMMAND ?? "scribery-mcp",
            "KNOWLEDGE_GATEWAY_SCRIBERY_COMMAND",
        ),
        ...(scriberyProfile === undefined ? {} : { scriberyProfile }),
        ...(scriberyBaseUrl === undefined ? {} : { scriberyBaseUrl }),
        ...(scriberyApiKey === undefined ? {} : { scriberyApiKey }),
        ...(scriberyRerankModel === undefined ? {} : { scriberyRerankModel }),
        ...(scriberyRerankInstruction === undefined
            ? {}
            : { scriberyRerankInstruction }),
    };
}

function requiredText(value: string, option: string): string {
    const trimmed = value.trim();
    if (trimmed.length === 0) throw new Error(`${option} must not be empty`);
    return trimmed;
}

function optionalText(value: string | undefined, option: string): string | undefined {
    return value === undefined ? undefined : requiredText(value, option);
}

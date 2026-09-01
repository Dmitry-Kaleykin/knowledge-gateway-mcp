import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface SkillsRetrievalConfiguration {
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
): SkillsRetrievalConfiguration {
    const piAgentDirectory = environment.PI_CODING_AGENT_DIR?.trim() ||
        join(homedir(), ".pi", "agent");
    const scriberyProfile = optionalText(
        environment.SKILLS_RETRIEVAL_SCRIBERY_PROFILE,
        "SKILLS_RETRIEVAL_SCRIBERY_PROFILE",
    );
    const scriberyBaseUrl = optionalText(
        environment.SKILLS_RETRIEVAL_SCRIBERY_BASE_URL,
        "SKILLS_RETRIEVAL_SCRIBERY_BASE_URL",
    );
    const scriberyRerankModel = optionalText(
        environment.SKILLS_RETRIEVAL_SCRIBERY_RERANK_MODEL,
        "SKILLS_RETRIEVAL_SCRIBERY_RERANK_MODEL",
    );
    const scriberyRerankInstruction = optionalText(
        environment.SKILLS_RETRIEVAL_SCRIBERY_RERANK_INSTRUCTION,
        "SKILLS_RETRIEVAL_SCRIBERY_RERANK_INSTRUCTION",
    );
    if (
        scriberyProfile !== undefined &&
        (scriberyBaseUrl !== undefined || scriberyRerankModel !== undefined ||
            scriberyRerankInstruction !== undefined)
    ) {
        throw new Error(
            "SKILLS_RETRIEVAL_SCRIBERY_PROFILE cannot be combined with " +
                "SKILLS_RETRIEVAL_SCRIBERY_BASE_URL or reranking settings",
        );
    }
    const scriberyApiKey = optionalText(
        environment.SKILLS_RETRIEVAL_SCRIBERY_API_KEY,
        "SKILLS_RETRIEVAL_SCRIBERY_API_KEY",
    );

    return {
        skillsRoot: resolve(requiredText(
            environment.SKILLS_RETRIEVAL_SKILLS_ROOT ??
                join(piAgentDirectory, "skills"),
            "SKILLS_RETRIEVAL_SKILLS_ROOT",
        )),
        documentation: requiredText(
            environment.SKILLS_RETRIEVAL_DOCUMENTATION ?? "pi-skills",
            "SKILLS_RETRIEVAL_DOCUMENTATION",
        ),
        scriberyCommand: requiredText(
            environment.SKILLS_RETRIEVAL_SCRIBERY_COMMAND ?? "scribery-mcp",
            "SKILLS_RETRIEVAL_SCRIBERY_COMMAND",
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

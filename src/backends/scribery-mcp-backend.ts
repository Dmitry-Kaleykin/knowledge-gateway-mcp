import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
    getDefaultEnvironment,
    StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";

import type { GatewayConfiguration } from "../config.js";
import type {
    KnowledgeBackend,
    KnowledgeSearchResult,
    KnowledgeSource,
} from "../contracts.js";

export class ScriberyMcpBackend implements KnowledgeBackend {
    readonly #configuration: GatewayConfiguration;
    #connection: Promise<Connection> | undefined;

    constructor(configuration: GatewayConfiguration) {
        this.#configuration = configuration;
    }

    async listSources(signal?: AbortSignal): Promise<readonly KnowledgeSource[]> {
        signal?.throwIfAborted();
        const connection = await this.#connect();
        const content = await callStructuredTool(connection.client, {
            name: "list_documentation_sources",
            arguments: { documentation: this.#configuration.documentation },
        });
        signal?.throwIfAborted();
        const sources = content.indexedSources;
        if (!Array.isArray(sources)) {
            throw new Error("Scribery returned an invalid indexed source inventory");
        }
        return sources.map(parseKnowledgeSource);
    }

    async search(
        request: { query: string; sourceIds: readonly string[]; limit: number },
        signal?: AbortSignal,
    ): Promise<readonly KnowledgeSearchResult[]> {
        signal?.throwIfAborted();
        const connection = await this.#connect();
        const content = await callStructuredTool(connection.client, {
            name: "search_documentation",
            arguments: {
                documentation: this.#configuration.documentation,
                query: request.query,
                sources: request.sourceIds,
                limit: request.limit,
                includeContext: false,
            },
        });
        signal?.throwIfAborted();
        const results = content.results;
        if (!Array.isArray(results)) {
            throw new Error("Scribery returned an invalid documentation search result");
        }
        return results.map(parseSearchResult);
    }

    async close(): Promise<void> {
        const connection = await this.#connection?.catch(() => undefined);
        this.#connection = undefined;
        await connection?.client.close();
    }

    #connect(): Promise<Connection> {
        this.#connection ??= this.#createConnection().catch((error: unknown) => {
            this.#connection = undefined;
            throw error;
        });
        return this.#connection;
    }

    async #createConnection(): Promise<Connection> {
        const args = [
            "--tools",
            "list_documentation_sources,search_documentation",
            ...(this.#configuration.scriberyProfile === undefined
                ? []
                : ["--profile", this.#configuration.scriberyProfile]),
            ...(this.#configuration.scriberyBaseUrl === undefined
                ? []
                : ["--base-url", this.#configuration.scriberyBaseUrl]),
            ...(this.#configuration.scriberyApiKey === undefined
                ? []
                : ["--api-key", this.#configuration.scriberyApiKey]),
            ...(this.#configuration.scriberyRerankModel === undefined
                ? []
                : ["--rerank-model", this.#configuration.scriberyRerankModel]),
            ...(this.#configuration.scriberyRerankInstruction === undefined
                ? []
                : ["--rerank-instruction", this.#configuration.scriberyRerankInstruction]),
        ];
        const transport = new StdioClientTransport({
            command: this.#configuration.scriberyCommand,
            args,
            env: {
                ...getDefaultEnvironment(),
                ...(process.env.OPENAI_COMPATIBLE_API_KEY === undefined
                    ? {}
                    : {
                        OPENAI_COMPATIBLE_API_KEY:
                            process.env.OPENAI_COMPATIBLE_API_KEY,
                    }),
                ...(process.env.LM_STUDIO_API_KEY === undefined
                    ? {}
                    : { LM_STUDIO_API_KEY: process.env.LM_STUDIO_API_KEY }),
            },
            stderr: "inherit",
        });
        const client = new Client({ name: "knowledge-gateway", version: "0.1.0" });
        await client.connect(transport);
        return { client };
    }
}

interface Connection {
    client: Client;
}

async function callStructuredTool(
    client: Client,
    request: { name: string; arguments: Record<string, unknown> },
): Promise<Record<string, unknown>> {
    const result = await client.callTool(request);
    if (result.isError === true) {
        throw new Error(textFromContent(result.content) || `${request.name} failed`);
    }
    if (!isRecord(result.structuredContent)) {
        throw new Error(`${request.name} returned no structured content`);
    }
    return result.structuredContent;
}

function parseKnowledgeSource(value: unknown): KnowledgeSource {
    if (!isRecord(value)) throw new Error("Scribery source must be an object");
    return {
        sourceId: requiredString(value.sourceId, "sourceId"),
        logicalPath: requiredString(value.logicalPath, "logicalPath"),
        ...(typeof value.originalLocation === "string" && value.originalLocation.length > 0
            ? { originalLocation: value.originalLocation }
            : {}),
    };
}

function parseSearchResult(value: unknown): KnowledgeSearchResult {
    if (!isRecord(value)) throw new Error("Scribery result must be an object");
    return {
        ...(typeof value.sourceId === "string" ? { sourceId: value.sourceId } : {}),
        path: requiredString(value.path, "path"),
        content: requiredString(value.content, "content"),
        score: requiredNumber(value.score, "score"),
        ...(typeof value.semanticScore === "number"
            ? { semanticScore: value.semanticScore }
            : {}),
        ...(typeof value.rerankScore === "number" ? { rerankScore: value.rerankScore } : {}),
    };
}

function textFromContent(content: unknown): string {
    if (!Array.isArray(content)) return "";
    return content
        .filter((item): item is { type: "text"; text: string } =>
            isRecord(item) && item.type === "text" && typeof item.text === "string"
        )
        .map(({ text }) => text)
        .join("\n");
}

function requiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.length === 0) {
        throw new Error(`Scribery result ${field} must be a non-empty string`);
    }
    return value;
}

function requiredNumber(value: unknown, field: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`Scribery result ${field} must be a finite number`);
    }
    return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

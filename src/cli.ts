#!/usr/bin/env node

import { createRequire } from "node:module";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { ScriberyMcpBackend } from "./backends/scribery-mcp-backend.js";
import { parseConfiguration, usage } from "./config.js";
import { KnowledgeGateway } from "./gateway.js";
import { createKnowledgeGatewayServer } from "./server.js";
import { SkillCatalog } from "./skills/catalog.js";

const packageMetadata = createRequire(import.meta.url)("../package.json") as {
    version: string;
};

try {
    const parsed = parseConfiguration(process.argv.slice(2));
    if (parsed.mode === "help") {
        console.log(usage());
    } else if (parsed.mode === "version") {
        console.log(packageMetadata.version);
    } else {
        const catalog = new SkillCatalog(parsed.configuration.skillsRoot);
        const backend = new ScriberyMcpBackend(parsed.configuration);
        const gateway = new KnowledgeGateway(catalog, backend);
        await gateway.initialize();
        const server = createKnowledgeGatewayServer(
            gateway,
            catalog,
            packageMetadata.version,
        );
        const shutdown = async () => {
            await server.close().catch(() => undefined);
            await gateway.close().catch(() => undefined);
        };
        process.once("SIGINT", () => void shutdown());
        process.once("SIGTERM", () => void shutdown());
        await server.connect(new StdioServerTransport());
    }
} catch (error: unknown) {
    console.error(JSON.stringify({
        error: "knowledge-gateway-failed",
        message: error instanceof Error ? error.message : String(error),
    }));
    process.exitCode = 1;
}

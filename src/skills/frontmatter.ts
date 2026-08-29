import { parse } from "yaml";

import type { InvocationMode } from "../contracts.js";

export interface ParsedSkillFrontmatter {
    name: string;
    description: string;
    disableModelInvocation: boolean;
    invocation: InvocationMode;
    invocationWasExplicit: boolean;
}

export function parseSkillFrontmatter(content: string, path: string): ParsedSkillFrontmatter {
    const normalized = content.startsWith("\uFEFF") ? content.slice(1) : content;
    const lines = normalized.split(/\r?\n/u);
    if (lines[0]?.trim() !== "---") {
        throw new Error(`${path} must begin with YAML frontmatter`);
    }
    const closing = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
    if (closing < 0) throw new Error(`${path} has unterminated YAML frontmatter`);
    const value = parse(lines.slice(1, closing).join("\n")) as unknown;
    if (!isRecord(value)) throw new Error(`${path} frontmatter must be a mapping`);

    const name = requiredString(value.name, "name", path);
    const description = requiredString(value.description, "description", path);
    const disableModelInvocation = value["disable-model-invocation"] === true;
    const metadata = isRecord(value.metadata) ? value.metadata : {};
    const invocationValue = metadata.invocation;
    const invocationWasExplicit = invocationValue !== undefined;
    const invocation = invocationValue === undefined
        ? "manual"
        : parseInvocation(invocationValue, path);
    return {
        name,
        description,
        disableModelInvocation,
        invocation,
        invocationWasExplicit,
    };
}

function parseInvocation(value: unknown, path: string): InvocationMode {
    if (value === "manual" || value === "retrieved" || value === "pinned") return value;
    throw new Error(
        `${path} metadata.invocation must be manual, retrieved, or pinned`,
    );
}

function requiredString(value: unknown, field: string, path: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`${path} frontmatter.${field} must be a non-empty string`);
    }
    return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

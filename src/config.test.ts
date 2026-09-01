import assert from "node:assert/strict";
import { test } from "node:test";

import { configurationFromEnvironment } from "./config.js";

test("Pi environment supplies defaults and resolves the skills root", () => {
    const configuration = configurationFromEnvironment({
        PI_CODING_AGENT_DIR: "/tmp/pi-agent",
    });

    assert.deepEqual(configuration, {
        skillsRoot: "/tmp/pi-agent/skills",
        documentation: "pi-skills",
        scriberyCommand: "scribery-mcp",
    });
});

test("explicit Pi extension settings are trimmed and retained", () => {
    const configuration = configurationFromEnvironment({
        SKILLS_RETRIEVAL_SKILLS_ROOT: " /tmp/custom-skills ",
        SKILLS_RETRIEVAL_DOCUMENTATION: " custom-docs ",
        SKILLS_RETRIEVAL_SCRIBERY_COMMAND: " /opt/scribery-mcp ",
        SKILLS_RETRIEVAL_SCRIBERY_PROFILE: " local-profile ",
        SKILLS_RETRIEVAL_SCRIBERY_API_KEY: " secret ",
    });

    assert.deepEqual(configuration, {
        skillsRoot: "/tmp/custom-skills",
        documentation: "custom-docs",
        scriberyCommand: "/opt/scribery-mcp",
        scriberyProfile: "local-profile",
        scriberyApiKey: "secret",
    });
});

test("a Scribery profile cannot be mixed with explicit provider settings", () => {
    assert.throws(
        () => configurationFromEnvironment({
            SKILLS_RETRIEVAL_SCRIBERY_PROFILE: "local-profile",
            SKILLS_RETRIEVAL_SCRIBERY_BASE_URL: "http://localhost:8000",
        }),
        /cannot be combined/u,
    );
});

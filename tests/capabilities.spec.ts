import { describe, expect, it } from "vitest";
import { parseHermesSkillsList, parseHermesToolsList, sanitizeSkillPolicy } from "../src/hermes/capabilities.js";

describe("Hermes capability helpers", () => {
  it("parses installed skills from the Hermes table output", () => {
    const skills = parseHermesSkillsList(`
                                Installed Skills                                
┏━━━━━━━━━━━━━━┳━━━━━━━━━━┳━━━━━━━━━┳━━━━━━━━━┓
┃ Name         ┃ Category ┃ Source  ┃ Trust   ┃
┡━━━━━━━━━━━━━━╇━━━━━━━━━━╇━━━━━━━━━╇━━━━━━━━━┩
│ Thinking     │          │ local   │ local   │
│ hermes-agent │          │ builtin │ builtin │
└──────────────┴──────────┴─────────┴─────────┘
`);

    expect(skills).toEqual(["Thinking", "hermes-agent"]);
  });

  it("parses enabled toolsets from Hermes tool output", () => {
    const toolsets = parseHermesToolsList(`
Built-in toolsets (cli):
  ✓ enabled  web  🔍 Web Search & Scraping
  ✗ disabled  browser  🌐 Browser Automation
  ✓ enabled  file  📁 File Operations
`);

    expect(toolsets).toEqual(["web", "file"]);
  });

  it("drops unsupported capability preferences", () => {
    const sanitized = sanitizeSkillPolicy({
      enabled: ["paperclip-search", "Thinking"],
      disabled: [],
      toolsets: ["web", "paperclip-context"],
    }, {
      availableSkills: ["Thinking", "hermes-agent"],
      enabledToolsets: ["web", "file"],
    });

    expect(sanitized.skillPolicy.enabled).toEqual(["Thinking"]);
    expect(sanitized.skillPolicy.toolsets).toEqual(["web"]);
    expect(sanitized.warnings).toContain("Skipped 1 unavailable Hermes skill preference(s).");
    expect(sanitized.warnings).toContain("Skipped 1 unavailable Hermes toolset preference(s).");
  });
});

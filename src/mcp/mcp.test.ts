import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { extractReportJson } from "../hermes/runner.js";

/**
 * Integration test: spins up the real SlopScore MCP server over stdio (the same
 * way Hermes connects to it) and verifies the tools are discoverable and
 * callable. This is proof that the "Hermes runs it" path is real.
 */
describe("SlopScore MCP server", () => {
  it("exposes tools and score_slop returns a valid SlopReport", async () => {
    const transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", "src/mcp/server.ts"],
    });
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(transport);

    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain("score_slop");
      expect(names).toContain("fetch_tweets");
      expect(names).toContain("get_leaderboard");

      const res: any = await client.callTool({
        name: "score_slop",
        arguments: { handle: "slopgpt" },
      });
      const text = res.content?.[0]?.text ?? "";
      const report = extractReportJson(text);
      expect(report).not.toBeNull();
      expect(report!.handle).toBe("slopgpt");
      expect(typeof report!.slopScore).toBe("number");
      expect(Array.isArray(report!.tells)).toBe(true);
    } finally {
      await client.close();
    }
  }, 60000);
});

describe("extractReportJson", () => {
  it("parses a bare JSON object", () => {
    const r = extractReportJson('{"handle":"x","slopScore":42}');
    expect(r?.slopScore).toBe(42);
  });

  it("parses JSON embedded in surrounding prose", () => {
    const r = extractReportJson('Here you go:\n{"handle":"x","slopScore":7} \nDone.');
    expect(r?.slopScore).toBe(7);
  });

  it("returns null when no valid report is present", () => {
    expect(extractReportJson("no json here")).toBeNull();
    expect(extractReportJson('{"foo":1}')).toBeNull();
  });
});

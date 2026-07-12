#!/usr/bin/env node
/**
 * SlopScore MCP server.
 *
 * This is how Hermes Agent "does the work": Hermes connects to this stdio MCP
 * server (declared in ~/.hermes/config.yaml), discovers these tools, and calls
 * them to fetch tweets and score the slop-tells. The deterministic engine stays
 * the scoring tool, so the roast is still fully defensible.
 *
 * Tools:
 *   - fetch_tweets(handle, limit)     → recent posts via LinkUp (mock fallback)
 *   - score_slop(handle, maxTweets)   → full SlopReport JSON (fetch + engine)
 *   - get_leaderboard(direction)      → shared Convex leaderboard
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { fetchTweets } from "../integrations/linkup.js";
import { computeReport } from "../pipeline.js";
import { getStore } from "../store/index.js";

const server = new McpServer({
  name: "slopscore",
  version: "0.1.0",
});

server.registerTool(
  "fetch_tweets",
  {
    title: "Fetch recent tweets",
    description:
      "Retrieve recent public posts for an X/Twitter handle via LinkUp. Returns an array of {id, text, url}.",
    inputSchema: {
      handle: z.string().describe("X/Twitter handle, with or without @"),
      limit: z.number().int().min(1).max(50).optional().describe("max posts (default 20)"),
    },
  },
  async ({ handle, limit }) => {
    const res = await fetchTweets(handle, limit ?? 20);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ handle: res.handle, source: res.source, tweets: res.tweets }),
        },
      ],
    };
  }
);

server.registerTool(
  "score_slop",
  {
    title: "Score slop-tells",
    description:
      "Fetch a handle's recent posts and score them for AI-writing tells (em-dash abuse, 'it's not X, it's Y', ChatGPT vocabulary like 'delve'/'tapestry', rhetorical-question bait, emoji bullet lists, suspiciously perfect grammar, tricolon rhythm). Returns the full SlopReport JSON including the 0-100 SlopScore, verdict, verbatim receipts, roast and 'how to sound human' tips.",
    inputSchema: {
      handle: z.string().describe("X/Twitter handle, with or without @"),
      maxTweets: z.number().int().min(1).max(50).optional(),
    },
  },
  async ({ handle, maxTweets }) => {
    const { report, tweetSource } = await computeReport(handle, maxTweets ?? 20);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ ...report, tweetSource }),
        },
      ],
    };
  }
);

server.registerTool(
  "get_leaderboard",
  {
    title: "Get the SlopScore leaderboard",
    description:
      "Return the shared leaderboard. direction 'slop' = most slop-pilled, 'human' = most human.",
    inputSchema: {
      direction: z.enum(["slop", "human"]).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    },
  },
  async ({ direction, limit }) => {
    const store = await getStore();
    const rows = await store.leaderboard(direction ?? "slop", limit ?? 10);
    return { content: [{ type: "text", text: JSON.stringify(rows) }] };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is safe for logs; stdout is the MCP channel.
  console.error("[slopscore-mcp] ready on stdio");
}

main().catch((err) => {
  console.error("[slopscore-mcp] fatal:", err);
  process.exit(1);
});

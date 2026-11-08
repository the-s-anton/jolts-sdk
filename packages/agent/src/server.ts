#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { Setup } from "./setup.js";

const [directory, authorizationUrl] = process.argv.slice(2);
if (!directory || !authorizationUrl) {
  process.stderr.write("Usage: jolts-agent PROJECT_DIRECTORY AUTHORIZATION_URL\n");
  process.exit(1);
}
const setup = new Setup(directory, authorizationUrl);
serveStdio(() => {
  const server = new McpServer({ name: "jolts-publisher-setup", version: "0.1.0" });
  for (const action of ["begin", "finish", "replace"] as const) {
    server.registerTool(
      action === "replace" ? "replace_publisher_connection" : `${action}_publisher_setup`,
      {
        description:
          action === "begin"
            ? "Request publisher approval. Open the returned approval URL for the publisher; then finish setup after approval."
            : action === "replace"
              ? "Ask the publisher to approve replacement of the installed connection. Finish setup after approval. Never read or print environment files."
              : "Install the approved test credential into the project's ignored .env.local. Never read or print that file.",
        inputSchema: z.object({}),
      },
      async () => {
        try {
          return {
            content: [{ type: "text" as const, text: JSON.stringify(await setup[action]()) }],
          };
        } catch {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: "Setup did not complete. Check the approval and ensure .env.local is ignored, untracked, writable, and matches the connection being installed or replaced.",
              },
            ],
          };
        }
      },
    );
  }
  return server;
});

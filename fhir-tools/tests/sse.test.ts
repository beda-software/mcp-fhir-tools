/*
 * Copyright 2025 Commonwealth Scientific and Industrial Research Organisation (CSIRO) ABN 41 687 119 230
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { AddressInfo } from "net";
import type { Server } from "http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp, McpApp } from "../src/app";

/**
 * These tests exercise the real HTTP transport layer (Express routes, session bookkeeping,
 * both the legacy SSE and Streamable HTTP protocols) end-to-end, using the MCP SDK's own
 * client + client transports rather than hand-rolled HTTP requests. Tool business logic is
 * covered separately in tools.test.ts.
 */
describe("MCP HTTP transports", () => {
  let mcpApp: McpApp;
  let httpServer: Server;
  let baseUrl: URL;

  beforeEach(async () => {
    mcpApp = createApp();
    httpServer = mcpApp.app.listen(0);
    await new Promise<void>((resolve) => httpServer.once("listening", resolve));
    const { port } = httpServer.address() as AddressInfo;
    baseUrl = new URL(`http://127.0.0.1:${port}/sse`);
  });

  afterEach(async () => {
    await mcpApp.closeAllTransports();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  async function connectStreamableClient() {
    const client = new Client({ name: "test-client", version: "0.0.1" });
    const transport = new StreamableHTTPClientTransport(baseUrl);
    await client.connect(transport);
    return { client, transport };
  }

  async function connectSseClient() {
    const client = new Client({ name: "test-client", version: "0.0.1" });
    const transport = new SSEClientTransport(baseUrl);
    await client.connect(transport);
    return { client, transport };
  }

  /** Opens a legacy SSE stream directly (bypassing the SDK client) to read off its sessionId. */
  async function openLegacySseSession() {
    const controller = new AbortController();
    const response = await fetch(baseUrl, {
      method: "GET",
      headers: { Accept: "text/event-stream" },
      signal: controller.signal,
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (!buffer.includes("sessionId=")) {
      const { value, done } = await reader.read();
      if (done) throw new Error("SSE stream closed before endpoint event");
      buffer += decoder.decode(value, { stream: true });
    }
    const [, sessionId] = buffer.match(/sessionId=([\w-]+)/) ?? [];
    if (!sessionId) throw new Error("No sessionId found in endpoint event");
    return { sessionId, close: () => controller.abort() };
  }

  describe("Streamable HTTP transport (POST /sse)", () => {
    test("initializes and lists the registered tools", async () => {
      const { client } = await connectStreamableClient();
      try {
        const { tools } = await client.listTools();
        expect(tools.map((tool) => tool.name).sort()).toEqual([
          "generate-uuid",
          "validate",
        ]);
      } finally {
        await client.close();
      }
    });

    test("calls a tool end-to-end through the real transport", async () => {
      const { client } = await connectStreamableClient();
      try {
        const result = await client.callTool({
          name: "generate-uuid",
          arguments: {},
        });
        const content = result.content as { type: string; text: string }[];
        expect(content[0].text).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        );
      } finally {
        await client.close();
      }
    });

    test("rejects a request with an unrecognised session id", async () => {
      const response = await fetch(baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "mcp-session-id": "does-not-exist",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(response.status).toBe(400);
    });

    test("terminates the session on DELETE, rejecting further requests", async () => {
      const { client, transport } = await connectStreamableClient();
      const sessionId = transport.sessionId;
      expect(sessionId).toBeDefined();

      await transport.terminateSession();

      const response = await fetch(baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "mcp-session-id": sessionId as string,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(response.status).toBe(400);
      await client.close();
    });
  });

  describe("Legacy HTTP+SSE transport (GET /sse + POST /messages)", () => {
    test("initializes and lists the registered tools", async () => {
      const { client } = await connectSseClient();
      try {
        const { tools } = await client.listTools();
        expect(tools.map((tool) => tool.name).sort()).toEqual([
          "generate-uuid",
          "validate",
        ]);
      } finally {
        await client.close();
      }
    });

    test("rejects a POST to /messages with an unrecognised sessionId", async () => {
      const messagesUrl = new URL(`http://${baseUrl.host}/messages`);
      messagesUrl.searchParams.set("sessionId", "does-not-exist");
      const response = await fetch(messagesUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(response.status).toBe(400);
    });

    test("keeps two concurrent sessions independent (regression: sessions used to be shared globally)", async () => {
      const first = await connectSseClient();
      const second = await connectSseClient();
      try {
        const [firstTools, secondTools] = await Promise.all([
          first.client.listTools(),
          second.client.listTools(),
        ]);
        expect(firstTools.tools.length).toBeGreaterThan(0);
        expect(secondTools.tools.length).toBeGreaterThan(0);
      } finally {
        await first.client.close();
        await second.client.close();
      }
    });
  });

  test("a session opened over the legacy transport is rejected by the Streamable HTTP endpoint", async () => {
    const legacySession = await openLegacySseSession();
    try {
      const response = await fetch(baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "mcp-session-id": legacySession.sessionId,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(response.status).toBe(400);
    } finally {
      legacySession.close();
    }
  });
});

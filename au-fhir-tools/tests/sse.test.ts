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

  const expectedTools = [
    "generate-dva",
    "generate-hpi-i",
    "generate-hpi-o",
    "generate-ihi",
    "generate-medicare",
  ];

  describe("Streamable HTTP transport (POST /sse)", () => {
    test("initializes and lists the registered tools", async () => {
      const { client } = await connectStreamableClient();
      try {
        const { tools } = await client.listTools();
        expect(tools.map((tool) => tool.name).sort()).toEqual(expectedTools);
      } finally {
        await client.close();
      }
    });

    test("calls a tool end-to-end through the real transport", async () => {
      const { client } = await connectStreamableClient();
      try {
        const result = await client.callTool({
          name: "generate-hpi-i",
          arguments: {},
        });
        const content = result.content as { type: string; text: string }[];
        expect(content[0].text).toMatch(/^800361\d{10}$/);
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

    test("a GET carrying the session id opens the notification stream on that session rather than a new legacy session", async () => {
      // Initialize with a raw request (not the SDK client transport, which would open its own
      // standalone GET stream on connect and leave no room for the one this test opens itself).
      const initResponse = await fetch(baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "test-client", version: "0.0.1" },
          },
        }),
      });
      const sessionId = initResponse.headers.get("mcp-session-id");
      expect(sessionId).toBeTruthy();

      const controller = new AbortController();
      const response = await fetch(baseUrl, {
        method: "GET",
        headers: {
          Accept: "text/event-stream",
          "mcp-session-id": sessionId as string,
        },
        signal: controller.signal,
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "text/event-stream",
      );

      // The legacy handler would have written an "endpoint" event immediately; the Streamable
      // HTTP notification stream never does, confirming this GET took the Streamable path.
      const reader = response.body!.getReader();
      const firstChunk = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value: undefined }>((resolve) =>
          setTimeout(() => resolve({ done: true, value: undefined }), 300),
        ),
      ]);
      if (!firstChunk.done && firstChunk.value) {
        const text = new TextDecoder().decode(firstChunk.value);
        expect(text).not.toContain("event: endpoint");
      }
      controller.abort();
    });

    test("rejects a GET carrying an unrecognised session id", async () => {
      const response = await fetch(baseUrl, {
        method: "GET",
        headers: {
          Accept: "text/event-stream",
          "mcp-session-id": "does-not-exist",
        },
      });
      expect(response.status).toBe(400);
    });
  });

  describe("Legacy HTTP+SSE transport (GET /sse + POST /messages)", () => {
    test("initializes and lists the registered tools", async () => {
      const { client } = await connectSseClient();
      try {
        const { tools } = await client.listTools();
        expect(tools.map((tool) => tool.name).sort()).toEqual(expectedTools);
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

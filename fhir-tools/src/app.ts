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

import { randomUUID } from "node:crypto";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import createServer from "./server.js";

const logger = console;

type Transport = SSEServerTransport | StreamableHTTPServerTransport;

export interface McpApp {
  app: express.Express;
  /** Closes every open transport (both legacy SSE and Streamable HTTP sessions). */
  closeAllTransports: () => Promise<void>;
}

/**
 * Builds the Express app serving the MCP HTTP transports, isolated from process-level concerns
 * (listening on a port, OS signal handling) so it can be exercised directly in tests.
 *
 * Exposes both:
 * - The legacy HTTP+SSE transport (protocol version 2024-11-05), kept for backwards compatibility
 *   with older clients: GET opens the stream; the client then POSTs JSON-RPC messages to the
 *   `${basePath}/messages` endpoint advertised in the `endpoint` SSE event.
 * - The Streamable HTTP transport (current MCP spec), used by modern clients such as the OpenAI
 *   Responses API `mcp` tool. Exposed on the same `${basePath}/sse` path as the legacy transport
 *   (GET keeps the legacy meaning) so that existing client configuration keeps working.
 */
export function createApp(basePath = process.env.BASE_PATH ?? ""): McpApp {
  const app = express();
  app.use(express.json());

  // Sessions are tracked by ID across both transports, so that /messages and /sse (POST/DELETE)
  // requests can be routed back to the transport that owns them.
  const transports: Record<string, Transport> = {};

  app.get(
    `${basePath}/sse`,
    async (_req: express.Request, res: express.Response) => {
      logger.info("Received legacy SSE connection request");
      const transport = new SSEServerTransport(`${basePath}/messages`, res);
      transports[transport.sessionId] = transport;
      res.on("close", () => {
        delete transports[transport.sessionId];
      });
      await createServer().connect(transport);
      logger.info(`Legacy SSE transport connected: ${transport.sessionId}`);
    },
  );

  app.post(
    `${basePath}/messages`,
    async (req: express.Request, res: express.Response) => {
      logger.debug("Received message", req);
      const sessionId = req.query.sessionId as string | undefined;
      const transport = sessionId ? transports[sessionId] : undefined;

      if (!(transport instanceof SSEServerTransport)) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message:
              "Bad Request: No SSE connection found for the given sessionId",
          },
          id: null,
        });
        return;
      }

      await transport.handlePostMessage(req, res, req.body);
    },
  );

  app.post(
    `${basePath}/sse`,
    async (req: express.Request, res: express.Response) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport = sessionId ? transports[sessionId] : undefined;

      if (transport && !(transport instanceof StreamableHTTPServerTransport)) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message:
              "Bad Request: Session exists but uses a different transport protocol",
          },
          id: null,
        });
        return;
      }

      if (!transport) {
        if (sessionId || !isInitializeRequest(req.body)) {
          res.status(400).json({
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: "Bad Request: No valid session ID provided",
            },
            id: null,
          });
          return;
        }

        const newTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            logger.info(`Streamable HTTP session initialized: ${id}`);
            transports[id] = newTransport;
          },
        });
        newTransport.onclose = () => {
          const id = newTransport.sessionId;
          if (id) {
            logger.info(`Streamable HTTP transport closed: ${id}`);
            delete transports[id];
          }
        };
        await createServer().connect(newTransport);
        transport = newTransport;
      }

      await transport.handleRequest(req, res, req.body);
    },
  );

  app.delete(
    `${basePath}/sse`,
    async (req: express.Request, res: express.Response) => {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      const transport = sessionId ? transports[sessionId] : undefined;

      if (!(transport instanceof StreamableHTTPServerTransport)) {
        res
          .status(400)
          .send(
            "No active Streamable HTTP session found for the given session ID",
          );
        return;
      }

      await transport.handleRequest(req, res);
    },
  );

  const closeAllTransports = async () => {
    await Promise.all(
      Object.entries(transports).map(async ([sessionId, transport]) => {
        try {
          await transport.close();
        } catch (error) {
          logger.error(
            `Error closing transport for session ${sessionId}:`,
            error,
          );
        }
        delete transports[sessionId];
      }),
    );
  };

  return { app, closeAllTransports };
}

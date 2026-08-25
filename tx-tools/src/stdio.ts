#!/usr/bin/env node
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

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import createServer from "./server.js";

const logger = console;

async function runServer() {
  try {
    const transport = new StdioServerTransport(process.stdin, process.stdout);
    await createServer().connect(transport);
  } catch (error) {
    logger.error(
      `Failed to start server:\n${JSON.stringify(getErrorDetails(error), null, 2)}`,
    );
    throw error;
  }
}

function getErrorDetails(error: unknown) {
  return {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : "No stack trace available",
    errorObject:
      error instanceof Error
        ? Object.getOwnPropertyNames(error).reduce(
            (obj, prop) => {
              obj[prop] = (error as unknown as Record<string, unknown>)[prop];
              return obj;
            },
            {} as Record<string, unknown>,
          )
        : error,
  };
}

// Add signal handlers for graceful shutdown
["SIGINT", "SIGTERM", "SIGQUIT"].forEach((signal) => {
  process.on(signal, () => {
    logger.info(
      `Received ${signal} signal - shutting down Terminology Tools MCP Server`,
    );
    process.stdin.destroy();
    process.exit(0);
  });
});

process.stdin.on("error", (err) => {
  logger.error(`stdin error: ${err}`);
});

process.stdout.on("error", (err) => {
  logger.error(`stdout error: ${err}`);
});

runServer().catch((error) => {
  logger.error(
    `Fatal error running server:\n${JSON.stringify(getErrorDetails(error), null, 2)}`,
  );
  process.exit(1);
});

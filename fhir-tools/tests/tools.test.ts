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

import type { ChildProcess } from "child_process";
import { jest } from "@jest/globals";

// server.ts calls child_process.execFile to run the FHIR validator JAR. Under real ESM, Jest
// can't monkey-patch a module namespace object (it's frozen), so the module has to be mocked
// before it's imported, and anything that transitively imports it (server.ts) has to be pulled
// in afterwards via a dynamic import rather than a static one.
const execFileMock = jest.fn();
jest.unstable_mockModule("child_process", () => ({
  execFile: execFileMock,
}));

const { default: createServer } = await import("../src/server");

describe("FHIR Tools", () => {
  const server = createServer();

  test("generate-uuid returns a valid UUID v4", async () => {
    const tool = server["_registeredTools"]["generate-uuid"];
    const result = await tool.handler({});
    expect(result.content[0].text).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  describe("validate tool", () => {
    afterEach(() => {
      execFileMock.mockReset();
    });

    test("returns warnings and errors when validator outputs lines", async () => {
      // Stub execFile so that it returns simulated warnings/errors.
      execFileMock.mockImplementation((...args: unknown[]) => {
        const callback = args[args.length - 1] as (
          error: Error | null,
          stdout: string,
          stderr: string,
        ) => void;
        process.nextTick(() =>
          callback(null, "Warning: Something is off\nError: Fake error", ""),
        );
        return {} as ChildProcess;
      });
      const tool = server["_registeredTools"]["validate"];
      const response = await tool.handler({
        resource: "{}",
        fhirVersion: "4.0.1",
        snomedVersion: "intl",
      });
      expect(response.content[0].text).toContain("Warning: Something is off");
      expect(response.content[0].text).toContain("Error: Fake error");
    });

    test("returns an error when execFile fails", async () => {
      execFileMock.mockImplementation((...args: unknown[]) => {
        const callback = args[args.length - 1] as (
          error: Error | null,
          stdout: string,
          stderr: string,
        ) => void;
        process.nextTick(() => callback(new Error("Exec failed"), "", ""));
        return {} as ChildProcess;
      });
      const tool = server["_registeredTools"]["validate"];
      const response = await tool.handler({
        resource: "{}",
        fhirVersion: "4.0.1",
        snomedVersion: "intl",
      });
      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain("Exec failed");
    });
  });
});

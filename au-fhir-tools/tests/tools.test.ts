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

import createServer from "../src/server";

// Add tests similar to those in fhir-tools/tests/tools.test.ts
describe("Australian FHIR Tools", () => {
  const server = createServer();

  test("generate-hpi-i returns a valid HPI-I", async () => {
    const tool = server["_registeredTools"]["generate-hpi-i"];
    const result = await tool.handler({});
    expect(result.content[0].text).toMatch(/^800361\d{10}$/);
  });

  test("generate-ihi returns a valid IHI", async () => {
    const tool = server["_registeredTools"]["generate-ihi"];
    const result = await tool.handler({});
    expect(result.content[0].text).toMatch(/^800360\d{10}$/);
  });

  test("generate-medicare returns a Medicare number", async () => {
    const tool = server["_registeredTools"]["generate-medicare"];
    const result = await tool.handler({});
    expect(result.content[0].text).toMatch(/^[2-6]\d{8,9}$/);
  });

  test("generate-dva returns a DVA number", async () => {
    const tool = server["_registeredTools"]["generate-dva"];
    const result = await tool.handler({});
    expect(result.content[0].text).toMatch(/^[NHWQ]\d{7,9}$/);
  });

  test("generate-hpi-o returns a valid HPI-O", async () => {
    const tool = server["_registeredTools"]["generate-hpi-o"];
    const result = await tool.handler({});
    expect(result.content[0].text).toMatch(/^800362\d{10}$/);
  });
});

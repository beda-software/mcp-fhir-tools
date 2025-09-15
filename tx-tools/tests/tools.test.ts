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

import fetch from "node-fetch";
import server from "../src/server";

jest.mock("node-fetch", () => jest.fn());

describe("Terminology Tools", () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  test("lookup-code returns 'No matching codes found' if the expansion is empty", async () => {
    (fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ expansion: { contains: [] } }),
    });
    const tool = server["_registeredTools"]["lookup-code"];
    const response = await tool.callback({
      filter: "hypertension",
      url: "http://snomed.info/sct?fhir_vs",
    });
    expect(response.content[0].text).toBe("No matching codes found");
  });

  test("lookup-code returns the first matching coding when available", async () => {
    const firstMatch = { code: "12345", display: "Test Code" };
    (fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ expansion: { contains: [firstMatch] } }),
    });
    const tool = server["_registeredTools"]["lookup-code"];
    const response = await tool.callback({
      filter: "hypertension",
      url: "http://snomed.info/sct?fhir_vs",
    });
    expect(response.content[0].text).toContain(
      JSON.stringify(firstMatch, null, 2),
    );
  });

  test("lookup-code returns an error if the fetch response is not OK", async () => {
    (fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Server Error",
    });
    const tool = server["_registeredTools"]["lookup-code"];
    const response = await tool.callback({
      filter: "hypertension",
      url: "http://snomed.info/sct?fhir_vs",
    });
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/Terminology server error/);
  });

  test("validate-code returns valid result for a valid code", async () => {
    const mockParameters = {
      resourceType: "Parameters",
      parameter: [
        { name: "result", valueBoolean: true },
        { name: "code", valueCode: "30371007" },
        { name: "system", valueUri: "http://snomed.info/sct" },
        {
          name: "version",
          valueString:
            "http://snomed.info/sct/32506021000036107/version/20250831",
        },
        {
          name: "display",
          valueString:
            "Open fracture of base of skull with contusion and laceration of cerebrum",
        },
      ],
    };

    (fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockParameters,
    });

    const tool = server["_registeredTools"]["validate-code"];
    const response = await tool.callback({
      system: "http://snomed.info/sct",
      code: "30371007",
      url: "http://snomed.info/sct?fhir_vs",
      version: "http://snomed.info/sct/32506021000036107/version/20250831",
    });

    const result = JSON.parse(response.content[0].text);
    expect(result.valid).toBe(true);
    expect(result.code).toBe("30371007");
    expect(result.system).toBe("http://snomed.info/sct");
    expect(result.display).toBe(
      "Open fracture of base of skull with contusion and laceration of cerebrum",
    );
  });

  test("validate-code returns invalid result for an invalid code", async () => {
    const mockParameters = {
      resourceType: "Parameters",
      parameter: [{ name: "result", valueBoolean: false }],
    };

    (fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockParameters,
    });

    const tool = server["_registeredTools"]["validate-code"];
    const response = await tool.callback({
      system: "http://snomed.info/sct",
      code: "invalid-code",
      url: "http://snomed.info/sct?fhir_vs",
    });

    const result = JSON.parse(response.content[0].text);
    expect(result.valid).toBe(false);
    expect(result.code).toBe("invalid-code");
  });

  test("validate-code works without optional version parameter", async () => {
    const mockParameters = {
      resourceType: "Parameters",
      parameter: [
        { name: "result", valueBoolean: true },
        { name: "code", valueCode: "72133-2" },
        { name: "system", valueUri: "http://loinc.org" },
        { name: "display", valueString: "Respiratory rate" },
      ],
    };

    (fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockParameters,
    });

    const tool = server["_registeredTools"]["validate-code"];
    const response = await tool.callback({
      system: "http://loinc.org",
      code: "72133-2",
      url: "http://loinc.org/vs",
    });

    const result = JSON.parse(response.content[0].text);
    expect(result.valid).toBe(true);
    expect(result.version).toBeUndefined();
  });

  test("validate-code returns an error if the fetch response is not OK", async () => {
    (fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "ValueSet not found",
    });

    const tool = server["_registeredTools"]["validate-code"];
    const response = await tool.callback({
      system: "http://snomed.info/sct",
      code: "12345",
      url: "http://invalid-valueset-url",
    });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toMatch(/Terminology server error/);
  });
});

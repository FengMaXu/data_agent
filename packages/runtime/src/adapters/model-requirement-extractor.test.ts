import { describe, expect, it } from "vitest";
import type { Models } from "@earendil-works/pi-ai";
import { ModelRequirementExtractor, REQUIREMENT_EXTRACTION_PROMPT, parseRequirementResponse } from "./model-requirement-extractor.js";

describe("requirement extraction", () => {
  it("keeps quotes with a known role and rejects a reply without a requirements list", () => {
    expect(parseRequirementResponse('```json\n{"requirements": [{"quote": "for each customer", "role": "scope"}, {"quote": "x", "role": "style"}, {"role": "time"}]}\n```'))
      .toEqual([{ quote: "for each customer", role: "scope" }]);
    expect(() => parseRequirementResponse("no json here")).toThrow("no JSON object");
    expect(() => parseRequirementResponse('{"items": []}')).toThrow("no requirements list");
  });

  it("sends only the request to the model, under the extraction prompt", async () => {
    const calls: unknown[] = [];
    const models = {
      completeSimple: async (_model: unknown, context: unknown) => {
        calls.push(context);
        return { role: "assistant", content: [{ type: "text", text: '{"requirements": [{"quote": "top three", "role": "selection"}]}' }], stopReason: "stop" };
      },
    } as unknown as Models;
    const extractor = new ModelRequirementExtractor(models, { id: "m" } as never);
    await expect(extractor.extract("List the top three regions")).resolves.toEqual([{ quote: "top three", role: "selection" }]);
    expect(calls[0]).toMatchObject({ systemPrompt: REQUIREMENT_EXTRACTION_PROMPT, messages: [{ role: "user", content: "List the top three regions" }] });
  });

  it("reports a provider failure instead of returning an empty list", async () => {
    const models = { completeSimple: async () => ({ role: "assistant", content: [], stopReason: "error", errorMessage: "HTTP 500" }) } as unknown as Models;
    await expect(new ModelRequirementExtractor(models, { id: "m" } as never).extract("q")).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });
});

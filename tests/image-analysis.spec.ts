import { describe, expect, it } from "vitest";
import {
  buildImageAnalysisFallbackText,
  buildMetadataFallbackAnalysis,
  buildImageAnalysisPrompt,
  parseImageAnalysisResponse,
} from "../src/hermes/image-analysis.js";

describe("image analysis helpers", () => {
  it("builds a strict JSON prompt for Hermes vision analysis", () => {
    const prompt = buildImageAnalysisPrompt(1200);
    expect(prompt).toContain("Return strict JSON only");
    expect(prompt).toContain("\"summary\": string");
    expect(prompt).toContain("1200");
  });

  it("parses structured JSON analysis responses", () => {
    const result = parseImageAnalysisResponse(JSON.stringify({
      summary: "Dashboard screenshot with a red warning pill",
      extractedText: "READY\nDEPLOY BLOCKED",
      notableDetails: ["Top-right timestamp", "Orange alert banner"],
    }), 1200);

    expect(result).toEqual({
      status: "complete",
      summary: "Dashboard screenshot with a red warning pill",
      extractedText: "READY\nDEPLOY BLOCKED",
      notableDetails: ["Top-right timestamp", "Orange alert banner"],
    });
  });

  it("derives a multimodal fallback text block from stored analysis", () => {
    const fallback = buildImageAnalysisFallbackText({
      status: "complete",
      summary: "Handwritten note on a whiteboard",
      extractedText: "READY FOR QA",
      notableDetails: ["Blue underlined heading"],
      generatedAt: "2026-04-19T08:00:00Z",
    }, 1200);

    expect(fallback).toContain("Vision summary: Handwritten note on a whiteboard");
    expect(fallback).toContain("Extracted text:\nREADY FOR QA");
    expect(fallback).toContain("Blue underlined heading");
  });

  it("builds a metadata-only fallback analysis when Hermes vision is unavailable", () => {
    const result = buildMetadataFallbackAnalysis({
      name: "ready-card.png",
      mimeType: "image/png",
      altText: "READY",
      maxChars: 1200,
      error: new Error("Hermes image analysis timed out after 45000ms"),
    });

    expect(result.status).toBe("complete");
    expect(result.summary).toContain("Metadata-only image summary for ready-card.png");
    expect(result.extractedText).toBe("READY");
    expect(result.notableDetails).toEqual(expect.arrayContaining([
      "mime=image/png",
      "analysis=fallback-metadata",
    ]));
    expect(result.errorMessage).toContain("timed out");
  });
});

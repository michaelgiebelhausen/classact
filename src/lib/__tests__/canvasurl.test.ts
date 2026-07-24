import { describe, expect, it } from "vitest";
import { normalizeCanvasBaseUrl } from "@/lib/canvasurl";

describe("normalizeCanvasBaseUrl", () => {
  it("accepts a bare hostname and adds https", () => {
    expect(normalizeCanvasBaseUrl("clemson.instructure.com")).toBe(
      "https://clemson.instructure.com"
    );
  });

  it("strips paths, ports, and query from pasted URLs", () => {
    expect(
      normalizeCanvasBaseUrl("https://clemson.instructure.com/courses/123456?x=1")
    ).toBe("https://clemson.instructure.com");
  });

  it("rejects http (https only)", () => {
    expect(normalizeCanvasBaseUrl("http://clemson.instructure.com")).toBeNull();
  });

  it("rejects localhost, IP literals, and internal hosts", () => {
    expect(normalizeCanvasBaseUrl("localhost")).toBeNull();
    expect(normalizeCanvasBaseUrl("https://127.0.0.1")).toBeNull();
    expect(normalizeCanvasBaseUrl("https://[::1]")).toBeNull();
    expect(normalizeCanvasBaseUrl("canvas.local")).toBeNull();
  });

  it("rejects embedded credentials and garbage", () => {
    expect(normalizeCanvasBaseUrl("https://user:pass@school.edu")).toBeNull();
    expect(normalizeCanvasBaseUrl("not a url at all")).toBeNull();
    expect(normalizeCanvasBaseUrl("")).toBeNull();
  });

  it("normalizes case", () => {
    expect(normalizeCanvasBaseUrl("Clemson.Instructure.COM")).toBe(
      "https://clemson.instructure.com"
    );
  });
});

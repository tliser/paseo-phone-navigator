import { describe, expect, it } from "vitest";
import { isLightColor } from "../shared/colors";

describe("isLightColor", () => {
  it("tells light from dark theme surfaces in the formats themes use", () => {
    expect(isLightColor("#FAFAFA")).toBe(true);
    expect(isLightColor("#fff")).toBe(true);
    expect(isLightColor("#18181bff")).toBe(false);
    expect(isLightColor("rgb(245, 245, 245)")).toBe(true);
    expect(isLightColor("rgba(9,9,11,1)")).toBe(false);
    expect(isLightColor("hsl(0 0% 100%)")).toBe(false);
  });
});

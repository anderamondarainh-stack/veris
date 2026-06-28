import { describe, it, expect } from "vitest";
import { parseKeys } from "../src/providers/specs.js";

describe("parseKeys", () => {
  it("devuelve [] para undefined o cadena vacía", () => {
    expect(parseKeys(undefined)).toEqual([]);
    expect(parseKeys("")).toEqual([]);
    expect(parseKeys("   ")).toEqual([]);
  });
  it("separa por comas y recorta espacios", () => {
    expect(parseKeys("a, b ,c")).toEqual(["a", "b", "c"]);
  });
  it("ignora segmentos vacíos entre comas", () => {
    expect(parseKeys("a,,b,")).toEqual(["a", "b"]);
  });
});

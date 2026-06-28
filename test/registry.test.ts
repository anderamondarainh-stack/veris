import { describe, it, expect } from "vitest";
import { Registry } from "../src/providers/registry.js";

describe("Registry", () => {
  it("expone 'groq' cuando hay GROQ_API_KEY", () => {
    const reg = new Registry({ GROQ_API_KEY: "x" } as NodeJS.ProcessEnv);
    expect(reg.availableProviderNames().has("groq")).toBe(true);
  });

  it("Ollama NO está disponible por defecto", () => {
    const reg = new Registry({ GROQ_API_KEY: "x" } as NodeJS.ProcessEnv);
    expect(reg.availableProviderNames().has("ollama")).toBe(false);
  });

  it("Ollama disponible con OLLAMA_ENABLED='true'", () => {
    const reg = new Registry({ OLLAMA_ENABLED: "true" } as NodeJS.ProcessEnv);
    expect(reg.availableProviderNames().has("ollama")).toBe(true);
  });

  it("Ollama disponible con OLLAMA_BASE_URL", () => {
    const reg = new Registry({ OLLAMA_BASE_URL: "http://localhost:11434/v1" } as NodeJS.ProcessEnv);
    expect(reg.availableProviderNames().has("ollama")).toBe(true);
  });

  it("openai existe con multi-key 'k1,k2' en OPENAI_API_KEY", () => {
    const reg = new Registry({ OPENAI_API_KEY: "k1,k2" } as NodeJS.ProcessEnv);
    expect(reg.availableProviderNames().has("openai")).toBe(true);
    const provider = reg.get("openai") as any;
    expect(provider.keyCount()).toBe(2);
  });

  it("sin keys el registro queda vacío de providers OpenAI-compatible", () => {
    const reg = new Registry({} as NodeJS.ProcessEnv);
    expect(reg.availableProviderNames().has("openai")).toBe(false);
    expect(reg.availableProviderNames().has("groq")).toBe(false);
  });
});

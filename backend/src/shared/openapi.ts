import { OpenAPIRegistry, OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";

// Modules register their paths here; spec is generated from the same Zod schemas used for validation.
export const registry = new OpenAPIRegistry();

export const buildSpec = () =>
  new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: "3.0.3",
    info: { title: "Social Publishing API", version: "0.1.0" },
  });

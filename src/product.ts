import manifest from "../package.json";

export const productVersion = manifest.version;
export const productResources = {
  install: "https://github.com/him55710-sudo/pureobom/releases",
  repository: "https://github.com/him55710-sudo/pureobom",
  feedback:
    "https://github.com/him55710-sudo/pureobom/issues/new?template=experience.yml",
} as const;
export type ProductResource = keyof typeof productResources;
export function productResource(value: unknown): string {
  if (typeof value !== "string" || !Object.hasOwn(productResources, value))
    throw Error("Unknown product resource");
  return productResources[value as ProductResource];
}

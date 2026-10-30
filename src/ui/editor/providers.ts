/** Share authenticated provider choices across the standard and terminal editors. */
import type { ModelItem } from "../editor-types.js";

/** List providers with at least one authenticated model in original registry order. */
export function availableProviders(models: readonly ModelItem[]): string[] {
  const available = new Set(
    models.filter((item) => item.available).map((item) => item.provider),
  );

  return [...new Set(models.map((item) => item.provider))].filter((provider) =>
    available.has(provider),
  );
}

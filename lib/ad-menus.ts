export type AdMenu = { name: string; description?: string };

export function parseAdMenus(value: unknown): AdMenu[] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) return undefined;

  const menus: AdMenu[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
    const { name, description } = item as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim() || name.trim().length > 80) return undefined;
    if (description !== undefined && (typeof description !== "string" || description.trim().length > 300)) return undefined;

    const trimmedDescription = typeof description === "string" ? description.trim() : "";
    menus.push({ name: name.trim(), ...(trimmedDescription ? { description: trimmedDescription } : {}) });
  }
  return menus;
}

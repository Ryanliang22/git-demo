// Spoken-unit counting used by the mock engine and by length estimates.
export function countUnits(text: string, unit: "char" | "word"): number {
  if (unit === "char") return (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export function publicRankingName(name: unknown): string {
  const displayName = typeof name === "string" ? name.trim() : "";
  return !displayName || /^[^\s@]+@[^\s@]+$/.test(displayName) ? "利用者" : displayName;
}

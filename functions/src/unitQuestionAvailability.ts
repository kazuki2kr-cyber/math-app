export function canManageUnitQuestionAvailability(token: unknown): boolean {
  return Boolean(
    token
    && typeof token === "object"
    && (token as { admin?: unknown }).admin === true
  );
}

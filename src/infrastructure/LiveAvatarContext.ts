/** LiveAvatar substitutes these placeholders consecutively in its configured prompt. */
export const AVATAR_CONTEXT_PART_COUNT = 50;
export const AVATAR_CONTEXT_PART_LENGTH = 1000;

/** Preserve the complete serialized briefing, including Unicode, or reject it before billing. */
export function splitAvatarContext(serialized: string): Record<string, string> {
  const parts: string[] = [];
  let part = '';
  for (const character of serialized) {
    if (part.length + character.length > AVATAR_CONTEXT_PART_LENGTH) {
      parts.push(part);
      part = '';
    }
    part += character;
    if (parts.length >= AVATAR_CONTEXT_PART_COUNT) {
      throw new Error(
        'This practice context exceeds the live interviewer’s capacity. Choose a scenario with fewer source records; no context was truncated or sent to LiveAvatar.',
      );
    }
  }
  parts.push(part);
  // Every placeholder must be supplied, even for empty-context or short briefings.
  return Object.fromEntries(
    Array.from({ length: AVATAR_CONTEXT_PART_COUNT }, (_, index) => [
      `brief_part_${String(index + 1).padStart(2, '0')}`,
      parts[index] ?? '',
    ]),
  );
}

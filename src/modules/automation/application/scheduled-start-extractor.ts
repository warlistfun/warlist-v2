const months: Readonly<Record<string, number>> = Object.freeze({
  januari: 0,
  februari: 1,
  maret: 2,
  april: 3,
  mei: 4,
  juni: 5,
  juli: 6,
  agustus: 7,
  september: 8,
  oktober: 9,
  november: 10,
  desember: 11,
});

export function extractScheduledStartAt(text: string): string | null {
  const match = text
    .replace(/\r?\n\s*(?:\d+[.)]|[-*•])\s[\s\S]*$/u, '')
    .replace(/\p{Cf}/gu, '')
    .match(
      /\b(\d{1,2})\s+(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s+(\d{4})\s+(?:pukul\s+(\d{1,2})[:.](\d{2})|jam\s+(\d{1,2}):(\d{2}))\b/iu,
    );
  if (!match) return null;

  const day = Number(match[1]);
  const month = months[match[2]?.toLowerCase() ?? ''];
  const year = Number(match[3]);
  const hour = Number(match[4] ?? match[6]);
  const minute = Number(match[5] ?? match[7]);
  if (
    month === undefined ||
    year < 1 ||
    hour > 23 ||
    minute > 59 ||
    new Date(Date.UTC(year, month, day)).getUTCFullYear() !== year ||
    new Date(Date.UTC(year, month, day)).getUTCMonth() !== month ||
    new Date(Date.UTC(year, month, day)).getUTCDate() !== day
  ) {
    return null;
  }
  return new Date(Date.UTC(year, month, day, hour - 7, minute)).toISOString();
}

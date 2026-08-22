const WIB_OFFSET_MILLISECONDS = 7 * 60 * 60 * 1_000;

export function businessDateInWib(timestamp: string): string {
  const instant = new Date(timestamp);
  if (!Number.isFinite(instant.getTime())) throw new Error('invalid timestamp');
  return new Date(instant.getTime() + WIB_OFFSET_MILLISECONDS).toISOString().slice(0, 10);
}

export function shouldConsumeDailyEntitlement(
  consumedBusinessDates: readonly string[],
  businessDate: string,
): boolean {
  return !consumedBusinessDates.includes(businessDate);
}

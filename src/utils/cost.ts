/** Logs Insights list price per GB scanned in us-east-1/us-east-2; other regions cost a bit more. */
export const DEFAULT_COST_PER_GB = 0.005;

/** AWS bills Logs Insights by GB scanned, counted in 2^30 bytes. */
export function estimateCost(bytesScanned: number, costPerGb: number): number {
  return (bytesScanned / 2 ** 30) * costPerGb;
}

/** "≈ $0.0036", "≈ $1.25", "< $0.0001". */
export function formatCost(usd: number): string {
  if (usd === 0) {
    return '$0';
  }
  if (usd < 0.0001) {
    return '< $0.0001';
  }
  return `≈ $${usd < 0.01 ? usd.toPrecision(2) : usd.toFixed(2)}`;
}

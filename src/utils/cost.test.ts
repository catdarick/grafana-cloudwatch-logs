import { estimateCost, formatCost } from './cost';

describe('cost', () => {
  it('prices bytes scanned per GiB', () => {
    expect(estimateCost(2 ** 30, 0.005)).toBeCloseTo(0.005);
    expect(formatCost(estimateCost(743 * 2 ** 20, 0.005))).toBe('≈ $0.0036');
  });

  it('formats small and large amounts', () => {
    expect(formatCost(0)).toBe('$0');
    expect(formatCost(0.00001)).toBe('< $0.0001');
    expect(formatCost(1.254)).toBe('≈ $1.25');
  });
});

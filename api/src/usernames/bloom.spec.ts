import {
  bloomPositions,
  bloomSize,
  expectedFalsePositiveRate,
} from './bloom.js';

describe('bloomSize', () => {
  it('needs ~9.6M bits (1.2 MB) and 7 hashes for 1M items at 1%', () => {
    expect(bloomSize(1_000_000, 0.01)).toEqual({ bits: 9_585_059, hashes: 7 });
  });

  it('grows by ~4.8 bits per item for each 10x lower error rate', () => {
    const at1 = bloomSize(1_000, 0.01).bits;
    const at01 = bloomSize(1_000, 0.001).bits;
    expect((at01 - at1) / 1_000).toBeCloseTo(4.79, 1);
  });

  it('hits its target rate when filled to capacity', () => {
    const { bits, hashes } = bloomSize(1_000_000, 0.01);
    expect(expectedFalsePositiveRate(bits, hashes, 1_000_000)).toBeCloseTo(
      0.01,
      3,
    );
  });
});

describe('bloomPositions', () => {
  it('is deterministic and stays inside the filter', () => {
    const a = bloomPositions('alice', 1_000, 7);
    expect(a).toEqual(bloomPositions('alice', 1_000, 7));
    expect(a).toHaveLength(7);
    for (const p of a) expect(p >= 0 && p < 1_000).toBe(true);
  });

  it('maps different values to different positions', () => {
    expect(bloomPositions('alice', 1_000_000, 7)).not.toEqual(
      bloomPositions('alicf', 1_000_000, 7),
    );
  });
});

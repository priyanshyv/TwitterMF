import { decodeSnowflake, Snowflake } from './snowflake.js';

describe('Snowflake', () => {
  it('generates unique, strictly increasing IDs', () => {
    const gen = new Snowflake(1);
    const ids = Array.from({ length: 100_000 }, () => gen.next());

    expect(new Set(ids).size).toBe(ids.length);
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i] > ids[i - 1]).toBe(true);
    }
  });

  it('encodes the timestamp, worker ID and sequence', () => {
    const at = Date.parse('2026-10-15T12:00:00Z');
    const gen = new Snowflake(42, () => at);
    gen.next();
    const id = gen.next();

    expect(decodeSnowflake(id)).toEqual({
      timestamp: new Date(at),
      workerId: 42,
      sequence: 1,
    });
  });

  it('gives different workers different IDs in the same millisecond', () => {
    const at = Date.parse('2026-10-15T12:00:00Z');
    const a = new Snowflake(1, () => at).next();
    const b = new Snowflake(2, () => at).next();
    expect(a).not.toBe(b);
  });

  it('waits for the next millisecond after 4096 IDs in one millisecond', () => {
    const now = Date.parse('2026-10-15T12:00:00Z');
    let calls = 0;
    // The clock only ticks forward after the generator has polled it a lot,
    // simulating a very fast burst.
    const gen = new Snowflake(1, () => (++calls > 4100 ? now + 1 : now));

    const ids = Array.from({ length: 4097 }, () => gen.next());

    expect(decodeSnowflake(ids[4095]).sequence).toBe(4095);
    expect(decodeSnowflake(ids[4096])).toMatchObject({
      timestamp: new Date(now + 1),
      sequence: 0,
    });
  });

  it('refuses to generate IDs when the clock goes backwards', () => {
    let now = Date.parse('2026-10-15T12:00:00Z');
    const gen = new Snowflake(1, () => now);
    gen.next();
    now -= 5;
    expect(() => gen.next()).toThrow('Clock moved backwards by 5ms');
  });

  it('rejects worker IDs outside 0..1023', () => {
    expect(() => new Snowflake(1024)).toThrow('workerId');
    expect(() => new Snowflake(-1)).toThrow('workerId');
  });
});

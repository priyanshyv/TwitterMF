import { withTimeout } from './with-timeout.js';

describe('withTimeout', () => {
  it('resolves with the value when the promise is fast enough', async () => {
    await expect(withTimeout(Promise.resolve(42), 50, 'fast')).resolves.toBe(
      42,
    );
  });

  it('rejects when the promise takes longer than the deadline', async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 200));
    await expect(withTimeout(slow, 20, 'slow')).rejects.toThrow(
      'slow timed out after 20ms',
    );
  });
});

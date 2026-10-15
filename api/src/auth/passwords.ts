import argon2 from 'argon2';

// argon2id is deliberately slow and memory-hungry (~64 MB per hash), so a
// leaked hash costs an attacker real hardware per guess.
export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export function verifyPassword(hash: string, password: string) {
  return argon2.verify(hash, password);
}

// When the username doesn't exist we still run one verify against this hash.
// Otherwise "no such user" answers in ~1ms and "wrong password" in ~50ms, and
// the timing alone tells an attacker which usernames are real.
let dummyHash: Promise<string> | undefined;
export async function burnPasswordCheck(password: string) {
  dummyHash ??= hashPassword('not-a-real-password');
  await argon2.verify(await dummyHash, password);
}

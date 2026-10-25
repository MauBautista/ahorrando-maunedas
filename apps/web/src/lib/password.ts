/** Letters and digits that cannot be mistaken for each other when read out loud or copied by hand (no l, 1, O, 0). */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * A password for a new user or a reset (W-11): [length] characters from `crypto.getRandomValues`, without modulo
 * bias. It is shown once to the admin, who hands it over in person; it is never stored or logged.
 */
export function generatePassword(length = 12): string {
  const out: string[] = [];
  const limit = 256 - (256 % ALPHABET.length);
  while (out.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (byte < limit && out.length < length) out.push(ALPHABET[byte % ALPHABET.length]!);
    }
  }
  return out.join('');
}

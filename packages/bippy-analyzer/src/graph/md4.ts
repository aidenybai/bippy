/** RFC 1320 MD4, webpack's default `output.hashFunction`, which OpenSSL 3 no longer provides to `node:crypto`. */

interface MixFunction {
  (x: number, y: number, z: number): number;
}

interface Round {
  mix: MixFunction;
  addend: number;
  wordOrder: number[];
  shifts: number[];
}

const BLOCK_BYTES = 64;
const LENGTH_BYTES = 8;
const INITIAL_STATE = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];

const ROUNDS: Round[] = [
  {
    mix: (x, y, z) => (x & y) | (~x & z),
    addend: 0,
    wordOrder: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    shifts: [3, 7, 11, 19],
  },
  {
    mix: (x, y, z) => (x & y) | (x & z) | (y & z),
    addend: 0x5a827999,
    wordOrder: [0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15],
    shifts: [3, 5, 9, 13],
  },
  {
    mix: (x, y, z) => x ^ y ^ z,
    addend: 0x6ed9eba1,
    wordOrder: [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15],
    shifts: [3, 9, 11, 15],
  },
];

const rotateLeft = (value: number, shift: number): number =>
  (value << shift) | (value >>> (32 - shift));

const padMessage = (content: Buffer): Buffer => {
  const paddedLength =
    (Math.floor((content.length + LENGTH_BYTES) / BLOCK_BYTES) + 1) * BLOCK_BYTES;
  const padded = Buffer.alloc(paddedLength);
  content.copy(padded);
  padded[content.length] = 0x80;
  const bitLength = content.length * 8;
  padded.writeUInt32LE(bitLength >>> 0, paddedLength - LENGTH_BYTES);
  padded.writeUInt32LE(Math.floor(bitLength / 0x1_0000_0000), paddedLength - LENGTH_BYTES / 2);
  return padded;
};

const processBlock = (state: number[], words: Uint32Array): void => {
  const working = [...state];
  for (const round of ROUNDS) {
    round.wordOrder.forEach((wordIndex, step) => {
      const target = (4 - (step % 4)) % 4;
      const x = working[(target + 1) % 4];
      const y = working[(target + 2) % 4];
      const z = working[(target + 3) % 4];
      working[target] = rotateLeft(
        (working[target] + round.mix(x, y, z) + words[wordIndex] + round.addend) | 0,
        round.shifts[step % 4],
      );
    });
  }
  working.forEach((word, index) => {
    state[index] = (state[index] + word) | 0;
  });
};

export const md4Hex = (content: Buffer): string => {
  const padded = padMessage(content);
  const state = [...INITIAL_STATE];
  const words = new Uint32Array(BLOCK_BYTES / 4);
  for (let offset = 0; offset < padded.length; offset += BLOCK_BYTES) {
    for (let wordIndex = 0; wordIndex < words.length; wordIndex++) {
      words[wordIndex] = padded.readUInt32LE(offset + wordIndex * 4);
    }
    processBlock(state, words);
  }
  const digest = Buffer.alloc(state.length * 4);
  state.forEach((word, index) => digest.writeUInt32LE(word >>> 0, index * 4));
  return digest.toString("hex");
};

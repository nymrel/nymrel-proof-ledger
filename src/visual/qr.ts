/**
 * Zero-dependency QR Code Matrix Generator (ISO/IEC 18004 compliant subset).
 *
 * Implements pure-mathematical Byte Mode QR matrix synthesis with Reed-Solomon
 * error correction over GF(256). Used to render vector QR verification paths
 * in standalone SVG badges without third-party dependencies.
 *
 * @module @nymrel/proof-ledger/visual/qr
 */

// Galois Field GF(256) tables with primitive polynomial 0x11d (285)
const GF256_EXP = new Uint8Array(512);
const GF256_LOG = new Uint8Array(256);

(function initGaloisField() {
  let val = 1;
  for (let i = 0; i < 255; i++) {
    GF256_EXP[i] = val;
    GF256_EXP[i + 255] = val;
    GF256_LOG[val] = i;
    val <<= 1;
    if (val & 0x100) {
      val ^= 0x11d;
    }
  }
})();

function gfMul(x: number, y: number): number {
  if (x === 0 || y === 0) return 0;
  return GF256_EXP[GF256_LOG[x] + GF256_LOG[y]];
}

function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const nextPoly = new Uint8Array(poly.length + 1);
    const root = GF256_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      nextPoly[j] ^= gfMul(poly[j], root);
      nextPoly[j + 1] ^= poly[j];
    }
    poly = nextPoly;
  }
  return poly;
}

function rsCalculateRemainder(data: Uint8Array, numEccBytes: number): Uint8Array {
  const gen = rsGeneratorPoly(numEccBytes);
  const remainder = new Uint8Array(numEccBytes);

  for (const byte of data) {
    const factor = byte ^ remainder[0];
    for (let j = 0; j < numEccBytes - 1; j++) {
      remainder[j] = remainder[j + 1] ^ gfMul(gen[j + 1], factor);
    }
    remainder[numEccBytes - 1] = gfMul(gen[numEccBytes], factor);
  }

  return remainder;
}

interface QRVersionSpec {
  version: number;
  totalDataCodewords: number;
  eccCodewords: number;
  alignPos: number[];
}

const QR_SPECS: Record<number, QRVersionSpec> = {
  1: { version: 1, totalDataCodewords: 19, eccCodewords: 7, alignPos: [] },
  2: { version: 2, totalDataCodewords: 34, eccCodewords: 10, alignPos: [6, 18] },
  3: { version: 3, totalDataCodewords: 55, eccCodewords: 15, alignPos: [6, 22] },
  4: { version: 4, totalDataCodewords: 80, eccCodewords: 20, alignPos: [6, 26] },
  5: { version: 5, totalDataCodewords: 108, eccCodewords: 26, alignPos: [6, 30] },
  6: { version: 6, totalDataCodewords: 136, eccCodewords: 36, alignPos: [6, 34] },
};

/**
 * Encodes text into a boolean 2D QR matrix (true = dark module, false = light module).
 */
export function generateQRMatrix(text: string): boolean[][] {
  const textBytes = Buffer.from(text, 'utf8');

  // Select minimum suitable version (ECL L)
  let chosenSpec: QRVersionSpec | undefined;
  for (let v = 1; v <= 6; v++) {
    const spec = QR_SPECS[v];
    // Byte mode overhead: 4 bits mode + 8/16 bits char count + data
    const charCountBits = v <= 9 ? 8 : 16;
    const requiredBits = 4 + charCountBits + textBytes.length * 8;
    const availableBits = spec.totalDataCodewords * 8;
    if (requiredBits <= availableBits) {
      chosenSpec = spec;
      break;
    }
  }

  if (!chosenSpec) {
    // Fallback: truncate if text is huge or use version 6
    chosenSpec = QR_SPECS[6];
  }

  const { version, totalDataCodewords, eccCodewords, alignPos } = chosenSpec;
  const size = 17 + 4 * version;

  // 1. Bit Stream Construction (Byte Mode: 0100)
  const bitStream: number[] = [];
  function pushBits(val: number, length: number) {
    for (let i = length - 1; i >= 0; i--) {
      bitStream.push((val >> i) & 1);
    }
  }

  pushBits(0b0100, 4); // Byte mode indicator
  const charCountBits = version <= 9 ? 8 : 16;
  pushBits(Math.min(textBytes.length, totalDataCodewords - 2), charCountBits);

  for (let i = 0; i < textBytes.length; i++) {
    if (bitStream.length + 8 <= totalDataCodewords * 8) {
      pushBits(textBytes[i], 8);
    }
  }

  // Terminator (up to 4 zeroes)
  while (bitStream.length < totalDataCodewords * 8 && bitStream.length % 8 !== 0) {
    bitStream.push(0);
  }
  while (bitStream.length < totalDataCodewords * 8 && bitStream.length < totalDataCodewords * 8) {
    bitStream.push(0);
    if (bitStream.length % 8 === 0 && bitStream.length >= totalDataCodewords * 8) break;
  }

  // Convert bitStream to data bytes
  const dataBytes = new Uint8Array(totalDataCodewords);
  for (let i = 0; i < totalDataCodewords; i++) {
    let byteVal = 0;
    for (let b = 0; b < 8; b++) {
      const bitIndex = i * 8 + b;
      if (bitIndex < bitStream.length) {
        byteVal = (byteVal << 1) | bitStream[bitIndex];
      } else {
        // Pad bytes: 0xEC, 0x11
        byteVal = (i % 2 === 0) ? 0xec : 0x11;
        break;
      }
    }
    dataBytes[i] = byteVal;
  }

  // Calculate Reed-Solomon error correction codewords
  const eccBytes = rsCalculateRemainder(dataBytes, eccCodewords);

  // Combine data + ECC
  const finalCodewords = new Uint8Array(totalDataCodewords + eccCodewords);
  finalCodewords.set(dataBytes, 0);
  finalCodewords.set(eccBytes, totalDataCodewords);

  // Initialize Matrix
  const matrix: (boolean | null)[][] = Array.from({ length: size }, () => Array(size).fill(null));
  const isFunctionModule: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  function setModule(r: number, c: number, val: boolean, isFunc = true) {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      matrix[r][c] = val;
      if (isFunc) isFunctionModule[r][c] = true;
    }
  }

  // Position Patterns (Finder Patterns)
  function drawFinderPattern(row: number, col: number) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const nr = row + r;
        const nc = col + c;
        if (nr >= 0 && nr < size && nc >= 0 && nc < size) {
          if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
            const isDark =
              r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
            setModule(nr, nc, isDark);
          } else {
            setModule(nr, nc, false); // Separator
          }
        }
      }
    }
  }

  drawFinderPattern(0, 0);
  drawFinderPattern(0, size - 7);
  drawFinderPattern(size - 7, 0);

  // Alignment Patterns
  if (alignPos.length > 0) {
    for (const r of alignPos) {
      for (const c of alignPos) {
        if (isFunctionModule[r][c]) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const isDark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
            setModule(r + dr, c + dc, isDark);
          }
        }
      }
    }
  }

  // Timing Patterns
  for (let i = 8; i < size - 8; i++) {
    const val = i % 2 === 0;
    if (!isFunctionModule[6][i]) setModule(6, i, val);
    if (!isFunctionModule[i][6]) setModule(i, 6, val);
  }

  // Dark module
  setModule(4 * version + 9, 8, true);

  // Reserve format info area
  for (let i = 0; i < 9; i++) {
    if (!isFunctionModule[8][i]) setModule(8, i, false);
    if (!isFunctionModule[i][8]) setModule(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    if (!isFunctionModule[8][size - 1 - i]) setModule(8, size - 1 - i, false);
    if (!isFunctionModule[size - 1 - i][8]) setModule(size - 1 - i, 8, false);
  }

  // Place Data Bits (Zigzag traversal)
  let bitIdx = 0;
  const totalBits = finalCodewords.length * 8;

  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right--; // Skip vertical timing column
    const upward = ((size - 1 - right) / 2) % 2 === 0;

    for (let vert = 0; vert < size; vert++) {
      const r = upward ? size - 1 - vert : vert;
      for (let c = right; c >= right - 1; c--) {
        if (!isFunctionModule[r][c]) {
          let bit = false;
          if (bitIdx < totalBits) {
            const bytePos = Math.floor(bitIdx / 8);
            const bitPos = 7 - (bitIdx % 8);
            bit = ((finalCodewords[bytePos] >> bitPos) & 1) === 1;
            bitIdx++;
          }
          // Apply Standard Mask Pattern 0: (row + col) % 2 == 0
          if ((r + c) % 2 === 0) {
            bit = !bit;
          }
          matrix[r][c] = bit;
        }
      }
    }
  }

  // Format Info for Mask 0, ECL L (BCH 15,5 format bits: 0b111011111000100)
  const formatBits = [1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0];
  // Top-left
  const positionsTL = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
  ];
  positionsTL.forEach(([r, c], idx) => {
    matrix[r][c] = formatBits[idx] === 1;
  });

  // Split around other corners
  for (let i = 0; i < 7; i++) {
    matrix[size - 1 - i][8] = formatBits[i] === 1;
  }
  for (let i = 7; i < 15; i++) {
    matrix[8][size - 15 + i] = formatBits[i] === 1;
  }

  return matrix.map((row) => row.map((cell) => cell === true));
}

/**
 * Generates an SVG path string from a QR matrix.
 */
export function generateQRSvgPath(matrix: boolean[][], cellSize = 4, offsetX = 0, offsetY = 0): string {
  const paths: string[] = [];
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix[r].length; c++) {
      if (matrix[r][c]) {
        const x = offsetX + c * cellSize;
        const y = offsetY + r * cellSize;
        paths.push(`M${x},${y}h${cellSize}v${cellSize}h-${cellSize}z`);
      }
    }
  }
  return paths.join(' ');
}

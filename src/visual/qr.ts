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
      nextPoly[j] ^= poly[j];
      nextPoly[j + 1] ^= gfMul(poly[j], root);
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
  blocks: number;
  alignPos: number[];
}

const QR_SPECS: Record<number, QRVersionSpec> = {
  1: { version: 1, totalDataCodewords: 19, eccCodewords: 7, blocks: 1, alignPos: [] },
  2: { version: 2, totalDataCodewords: 34, eccCodewords: 10, blocks: 1, alignPos: [6, 18] },
  3: { version: 3, totalDataCodewords: 55, eccCodewords: 15, blocks: 1, alignPos: [6, 22] },
  4: { version: 4, totalDataCodewords: 80, eccCodewords: 20, blocks: 1, alignPos: [6, 26] },
  5: { version: 5, totalDataCodewords: 108, eccCodewords: 26, blocks: 1, alignPos: [6, 30] },
  // Version 6-L has two equal 68-data/18-ECC blocks, interleaved below.
  6: { version: 6, totalDataCodewords: 136, eccCodewords: 18, blocks: 2, alignPos: [6, 34] },
};

/**
 * Encodes UTF-8 text in byte mode, ECL L, mask 0, versions 1 through 6.
 * Returns dark modules without a quiet zone. Rejects input over 134 UTF-8 bytes.
 */
export function generateQRMatrix(text: string): boolean[][] {
  if (typeof text !== 'string' || /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(text)) {
    throw new TypeError('QR payload must be a string without lone UTF-16 surrogates');
  }
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
    throw new RangeError('QR payload exceeds the supported capacity of 134 UTF-8 bytes');
  }

  const { version, totalDataCodewords, eccCodewords, blocks, alignPos } = chosenSpec;
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
  pushBits(textBytes.length, charCountBits);

  for (let i = 0; i < textBytes.length; i++) {
    pushBits(textBytes[i], 8);
  }

  // Terminator (up to 4 zeroes)
  pushBits(0, Math.min(4, totalDataCodewords * 8 - bitStream.length));
  while (bitStream.length % 8 !== 0) {
    bitStream.push(0);
  }

  // Convert bitStream to data bytes
  const dataBytes = new Uint8Array(totalDataCodewords);
  const usedDataBytes = bitStream.length / 8;
  for (let i = 0; i < usedDataBytes; i++) {
    let byteVal = 0;
    for (let b = 0; b < 8; b++) {
      const bitIndex = i * 8 + b;
      byteVal = (byteVal << 1) | bitStream[bitIndex];
    }
    dataBytes[i] = byteVal;
  }
  for (let i = usedDataBytes; i < totalDataCodewords; i++) {
    dataBytes[i] = (i - usedDataBytes) % 2 === 0 ? 0xec : 0x11;
  }

  // Calculate Reed-Solomon error correction codewords
  const dataPerBlock = totalDataCodewords / blocks;
  const eccBlocks = Array.from({ length: blocks }, (_, block) =>
    rsCalculateRemainder(dataBytes.subarray(block * dataPerBlock, (block + 1) * dataPerBlock), eccCodewords)
  );
  const finalCodewords = new Uint8Array(totalDataCodewords + blocks * eccCodewords);
  let codewordIndex = 0;
  for (let i = 0; i < dataPerBlock; i++) {
    for (let block = 0; block < blocks; block++) {
      finalCodewords[codewordIndex++] = dataBytes[block * dataPerBlock + i];
    }
  }
  for (let i = 0; i < eccCodewords; i++) {
    for (let block = 0; block < blocks; block++) {
      finalCodewords[codewordIndex++] = eccBlocks[block][i];
    }
  }

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
    const upward = ((right + 1) & 2) === 0;

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
  const formatBits = 0b111011111000100;
  const formatBit = (index: number) => ((formatBits >>> index) & 1) === 1;
  for (let i = 0; i < 6; i++) matrix[i][8] = formatBit(i);
  matrix[7][8] = formatBit(6);
  matrix[8][8] = formatBit(7);
  matrix[8][7] = formatBit(8);
  for (let i = 9; i < 15; i++) matrix[8][14 - i] = formatBit(i);
  for (let i = 0; i < 8; i++) matrix[8][size - 1 - i] = formatBit(i);
  for (let i = 8; i < 15; i++) matrix[size - 15 + i][8] = formatBit(i);

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

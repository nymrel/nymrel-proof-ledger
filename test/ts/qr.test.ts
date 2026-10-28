import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { generateQRMatrix, generateQRSvgPath } from '../../src/visual/qr.js';

interface QRVector {
  name: string;
  text: string;
  utf8Bytes: number;
  version: number;
  rows: string[];
}

const { vectors } = JSON.parse(
  readFileSync('test/fixtures/qr-vectors.json', 'utf8')
) as { vectors: QRVector[] };

describe('QR byte-mode encoding', () => {
  for (const vector of vectors) {
    it(`matches the independent QR matrix: ${vector.name}`, () => {
      const matrix = generateQRMatrix(vector.text);
      assert.strictEqual(Buffer.byteLength(vector.text, 'utf8'), vector.utf8Bytes);
      assert.strictEqual(matrix.length, 17 + 4 * vector.version);
      assert.deepStrictEqual(
        matrix.map(row => row.map(cell => cell ? '1' : '0').join('')),
        vector.rows,
      );
    });
  }

  it('rejects oversize byte payloads without truncating their targets', () => {
    for (const text of ['A'.repeat(135), 'A'.repeat(500), 'é'.repeat(68)]) {
      assert.throws(() => generateQRMatrix(text), /134 UTF-8 bytes/);
    }
  });

  it('rejects lone surrogates instead of silently substituting UTF-8 bytes', () => {
    for (const text of ['\ud800', '\udfff', 'x\ud800x']) {
      assert.throws(() => generateQRMatrix(text), /lone UTF-16 surrogates/);
    }
  });

  it('renders the supplied dark modules at the requested SVG coordinates', () => {
    assert.strictEqual(
      generateQRSvgPath([[true, false], [false, true]], 2, 5, 7),
      'M5,7h2v2h-2z M7,9h2v2h-2z',
    );
  });
});

"""
Zero-dependency QR Code Matrix Generator in Python.

Pure-mathematical Byte Mode QR matrix synthesis with Reed-Solomon
error correction over GF(256) for rendering standalone vector SVG badges.
"""

from typing import List

# Galois Field GF(256) tables with primitive polynomial 0x11d (285)
GF256_EXP = bytearray(512)
GF256_LOG = bytearray(256)

_val = 1
for _i in range(255):
    GF256_EXP[_i] = _val
    GF256_EXP[_i + 255] = _val
    GF256_LOG[_val] = _i
    _val <<= 1
    if _val & 0x100:
        _val ^= 0x11D


def gf_mul(x: int, y: int) -> int:
    if x == 0 or y == 0:
        return 0
    return GF256_EXP[GF256_LOG[x] + GF256_LOG[y]]


def rs_generator_poly(degree: int) -> bytearray:
    poly = bytearray([1])
    for i in range(degree):
        next_poly = bytearray(len(poly) + 1)
        root = GF256_EXP[i]
        for j in range(len(poly)):
            next_poly[j] ^= poly[j]
            next_poly[j + 1] ^= gf_mul(poly[j], root)
        poly = next_poly
    return poly


def rs_calculate_remainder(data: bytes, num_ecc_bytes: int) -> bytes:
    gen = rs_generator_poly(num_ecc_bytes)
    remainder = bytearray(num_ecc_bytes)

    for byte in data:
        factor = byte ^ remainder[0]
        for j in range(num_ecc_bytes - 1):
            remainder[j] = remainder[j + 1] ^ gf_mul(gen[j + 1], factor)
        remainder[num_ecc_bytes - 1] = gf_mul(gen[num_ecc_bytes], factor)

    return bytes(remainder)


QR_SPECS = {
    1: {"version": 1, "totalDataCodewords": 19, "eccCodewords": 7, "blocks": 1, "alignPos": []},
    2: {"version": 2, "totalDataCodewords": 34, "eccCodewords": 10, "blocks": 1, "alignPos": [6, 18]},
    3: {"version": 3, "totalDataCodewords": 55, "eccCodewords": 15, "blocks": 1, "alignPos": [6, 22]},
    4: {"version": 4, "totalDataCodewords": 80, "eccCodewords": 20, "blocks": 1, "alignPos": [6, 26]},
    5: {"version": 5, "totalDataCodewords": 108, "eccCodewords": 26, "blocks": 1, "alignPos": [6, 30]},
    # Version 6-L has two equal 68-data/18-ECC blocks, interleaved below.
    6: {"version": 6, "totalDataCodewords": 136, "eccCodewords": 18, "blocks": 2, "alignPos": [6, 34]},
}


def generate_qr_matrix(text: str) -> List[List[bool]]:
    """Encode UTF-8 byte mode, ECL L, mask 0, versions 1 through 6.

    Return dark modules without a quiet zone. Reject input over 134 UTF-8 bytes.
    """
    if not isinstance(text, str):
        raise TypeError("QR payload must be a string")
    text_bytes = text.encode("utf-8")

    chosen_spec = None
    for v in range(1, 7):
        spec = QR_SPECS[v]
        char_count_bits = 8 if v <= 9 else 16
        required_bits = 4 + char_count_bits + len(text_bytes) * 8
        available_bits = spec["totalDataCodewords"] * 8
        if required_bits <= available_bits:
            chosen_spec = spec
            break

    if not chosen_spec:
        raise ValueError("QR payload exceeds the supported capacity of 134 UTF-8 bytes")

    version = chosen_spec["version"]
    total_data_codewords = chosen_spec["totalDataCodewords"]
    ecc_codewords = chosen_spec["eccCodewords"]
    blocks = chosen_spec["blocks"]
    align_pos = chosen_spec["alignPos"]
    size = 17 + 4 * version

    bit_stream: List[int] = []

    def push_bits(val: int, length: int):
        for i in range(length - 1, -1, -1):
            bit_stream.append((val >> i) & 1)

    push_bits(0b0100, 4)  # Byte mode
    char_count_bits = 8 if version <= 9 else 16
    push_bits(len(text_bytes), char_count_bits)

    for b in text_bytes:
        push_bits(b, 8)

    push_bits(0, min(4, total_data_codewords * 8 - len(bit_stream)))
    while len(bit_stream) % 8 != 0:
        bit_stream.append(0)

    data_bytes = bytearray(total_data_codewords)
    used_data_bytes = len(bit_stream) // 8
    for i in range(used_data_bytes):
        byte_val = 0
        for b in range(8):
            bit_idx = i * 8 + b
            byte_val = (byte_val << 1) | bit_stream[bit_idx]
        data_bytes[i] = byte_val
    for i in range(used_data_bytes, total_data_codewords):
        data_bytes[i] = 0xEC if (i - used_data_bytes) % 2 == 0 else 0x11

    data_per_block = total_data_codewords // blocks
    ecc_blocks = [
        rs_calculate_remainder(
            bytes(data_bytes[block * data_per_block:(block + 1) * data_per_block]),
            ecc_codewords,
        ) for block in range(blocks)
    ]
    final_codewords = bytes(
        data_bytes[block * data_per_block + i]
        for i in range(data_per_block) for block in range(blocks)
    ) + bytes(
        ecc_blocks[block][i]
        for i in range(ecc_codewords) for block in range(blocks)
    )

    matrix = [[None for _ in range(size)] for _ in range(size)]
    is_func = [[False for _ in range(size)] for _ in range(size)]

    def set_module(r: int, c: int, val: bool, is_f: bool = True):
        if 0 <= r < size and 0 <= c < size:
            matrix[r][c] = val
            if is_f:
                is_func[r][c] = True

    # Finder patterns
    def draw_finder(row: int, col: int):
        for r in range(-1, 8):
            for c in range(-1, 8):
                nr = row + r
                nc = col + c
                if 0 <= nr < size and 0 <= nc < size:
                    if 0 <= r <= 6 and 0 <= c <= 6:
                        is_dark = (
                            r == 0 or r == 6 or c == 0 or c == 6 or (2 <= r <= 4 and 2 <= c <= 4)
                        )
                        set_module(nr, nc, is_dark)
                    else:
                        set_module(nr, nc, False)

    draw_finder(0, 0)
    draw_finder(0, size - 7)
    draw_finder(size - 7, 0)

    # Alignment patterns
    if align_pos:
        for r in align_pos:
            for c in align_pos:
                if is_func[r][c]:
                    continue
                for dr in range(-2, 3):
                    for dc in range(-2, 3):
                        is_dark = max(abs(dr), abs(dc)) != 1
                        set_module(r + dr, c + dc, is_dark)

    # Timing patterns
    for i in range(8, size - 8):
        val = (i % 2 == 0)
        if not is_func[6][i]:
            set_module(6, i, val)
        if not is_func[i][6]:
            set_module(i, 6, val)

    set_module(4 * version + 9, 8, True)

    for i in range(9):
        if not is_func[8][i]:
            set_module(8, i, False)
        if not is_func[i][8]:
            set_module(i, 8, False)
    for i in range(8):
        if not is_func[8][size - 1 - i]:
            set_module(8, size - 1 - i, False)
        if not is_func[size - 1 - i][8]:
            set_module(size - 1 - i, 8, False)

    # Place data bits with mask pattern 0
    bit_idx = 0
    total_bits = len(final_codewords) * 8

    right = size - 1
    while right > 0:
        if right == 6:
            right -= 1
        upward = ((right + 1) & 2) == 0

        for vert in range(size):
            r = size - 1 - vert if upward else vert
            for c in (right, right - 1):
                if not is_func[r][c]:
                    bit = False
                    if bit_idx < total_bits:
                        byte_pos = bit_idx // 8
                        bit_pos = 7 - (bit_idx % 8)
                        bit = ((final_codewords[byte_pos] >> bit_pos) & 1) == 1
                        bit_idx += 1
                    if (r + c) % 2 == 0:
                        bit = not bit
                    matrix[r][c] = bit
        right -= 2

    format_bits = 0b111011111000100

    def format_bit(index):
        return ((format_bits >> index) & 1) == 1

    for i in range(6):
        matrix[i][8] = format_bit(i)
    matrix[7][8] = format_bit(6)
    matrix[8][8] = format_bit(7)
    matrix[8][7] = format_bit(8)
    for i in range(9, 15):
        matrix[8][14 - i] = format_bit(i)
    for i in range(8):
        matrix[8][size - 1 - i] = format_bit(i)
    for i in range(8, 15):
        matrix[size - 15 + i][8] = format_bit(i)

    return [[bool(cell) for cell in row] for row in matrix]


def generate_qr_svg_path(matrix: List[List[bool]], cell_size: int = 4, offset_x: int = 0, offset_y: int = 0) -> str:
    """Generates an SVG path string from a QR matrix."""
    paths = []
    for r in range(len(matrix)):
        for c in range(len(matrix[r])):
            if matrix[r][c]:
                x = offset_x + c * cell_size
                y = offset_y + r * cell_size
                paths.append(f"M{x},{y}h{cell_size}v{cell_size}h-{cell_size}z")
    return " ".join(paths)

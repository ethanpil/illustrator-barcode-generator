/*
    Barcode Generator for Adobe Illustrator
    =======================================
    Generates a vector barcode as a group on a new layer of the active
    document (a new document is created if none is open).

    Supported symbologies (v2):
      - UPC-A    : 11 digits (check digit appended) or 12 (check digit verified)
      - EAN-13   : 12 digits (check digit appended) or 13 (check digit verified)
      - Code 39  : 0-9  A-Z  space  - . $ / + %   (input is upper-cased,
                   start/stop asterisks are added automatically)
      - Code 128 : ASCII 32-126, automatic subset B/C switching,
                   checksum calculated automatically (per spec)
      - QR Code  : numeric / alphanumeric / Latin-1 byte modes (auto-selected),
                   versions 1-40, error correction level M, mask chosen by
                   penalty score (ISO/IEC 18004)

    Features:
      - Options panel: human-readable text, white background, sliders for
        padding, bar height, text size and text gap, plus UPC/EAN
        magnification presets (GS1: 0.33 mm module @ 100%) which also set
        the module width internally
      - Live preview drawn on the artboard while the dialog is open
        (Illustrator allows document edits + app.redraw() during a modal
        ScriptUI dialog; preview add/remove steps accumulate in undo history).
        Refreshes on control changes or the Preview button.
      - Bars are drawn as a single compound path (select/recolor in one click);
        text is converted to outlines and the background hugs the real glyph
        bounds, so Padding 0 means zero empty space
      - Preflight: check digits, OCR-B font recommendation

    Usage: File > Scripts > Other Script...  (or install in the Scripts folder)
*/

#target illustrator

(function () {

    // =========================================================
    //  SETTINGS  (defaults; the dialog overrides most per run.
    //  All sizes in points, 72 pt = 1 inch)
    // =========================================================
    var MODULE_WIDTH   = 1;      // width of one module / narrow bar ("X" dimension)
    var BAR_HEIGHT     = 72;     // bar height
    var QUIET_ZONE     = 10;     // 1D quiet zone on each side, in modules
    var QR_QUIET_ZONE  = 4;      // QR quiet zone on each side, in modules (ISO/IEC 18004)
    var FONT_SIZE      = 7;      // human-readable text size
    var C39_WIDE_RATIO = 2.5;    // Code 39 wide:narrow ratio (2.0 - 3.0)
    var DRAW_BACKGROUND = true;  // draw a white rectangle behind bars + quiet zone
    var PAD            = 2;      // top/bottom padding of the background rectangle
    var TEXT_GAP       = 4;      // gap between the bottom of the bars and the top of the text
    var MM             = 72 / 25.4;                  // pt per mm
    var EAN_X100       = 0.33 * MM;                  // GS1 nominal module width @ 100%
    var EAN_H100       = 22.85 * MM;                 // GS1 nominal bar height @ 100%
    var MAGS           = [0.8, 0.9, 1.0, 1.5, 2.0];  // magnification presets

    // =========================================================
    //  ENCODING TABLES
    // =========================================================

    // ---- UPC / EAN ----
    // Left (odd parity) digit patterns. R = complement of L, G = reverse of R.
    var EAN_L = ["0001101", "0011001", "0010011", "0111101", "0100011",
                 "0110001", "0101111", "0111011", "0110111", "0001011"];
    var EAN_R = [];
    var EAN_G = [];
    (function () {
        for (var d = 0; d < 10; d++) {
            var r = "", g = "", i;
            for (i = 0; i < 7; i++) r += (EAN_L[d].charAt(i) === "0") ? "1" : "0";
            for (i = 6; i >= 0; i--) g += r.charAt(i);
            EAN_R.push(r);
            EAN_G.push(g);
        }
    }());

    // First-digit parity patterns for EAN-13 (L = odd, G = even)
    var EAN13_PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG",
                        "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

    // ---- Code 39 ----
    // 9 elements per character (bar,space,bar,space,bar,space,bar,space,bar)
    // "1" = wide element, "0" = narrow element.
    var C39 = {
        "0": "000110100", "1": "100100001", "2": "001100001", "3": "101100000",
        "4": "000110001", "5": "100110000", "6": "001110000", "7": "000100101",
        "8": "100100100", "9": "001100100",
        "A": "100001001", "B": "001001001", "C": "101001000", "D": "000011001",
        "E": "100011000", "F": "001011000", "G": "000001101", "H": "100001100",
        "I": "001001100", "J": "000011100", "K": "100000011", "L": "001000011",
        "M": "101000010", "N": "000010011", "O": "100010010", "P": "001010010",
        "Q": "000000111", "R": "100000110", "S": "001000110", "T": "000010110",
        "U": "110000001", "V": "011000001", "W": "111000000", "X": "010010001",
        "Y": "110010000", "Z": "011010000",
        "-": "010000101", ".": "110000100", " ": "011000100", "$": "010101000",
        "/": "010100010", "+": "010001010", "%": "000101010", "*": "010010100"
    };

    // ---- Code 128 ----
    // Element widths (bar,space,bar,space,bar,space) for values 0-105,
    // plus the stop pattern (value 106, 7 elements).
    var C128 = [
        "212222", "222122", "222221", "121223", "121322", "131222", "122213",
        "122312", "132212", "221213", "221312", "231212", "112232", "122132",
        "122231", "113222", "123122", "123221", "223211", "221132", "221231",
        "213212", "223112", "312131", "311222", "321122", "321221", "312212",
        "322112", "322211", "212123", "212321", "232121", "111323", "131123",
        "131321", "112313", "132113", "132311", "211313", "231113", "231311",
        "112133", "112331", "132131", "113123", "113321", "133121", "313121",
        "211331", "231131", "213113", "213311", "213131", "311123", "311321",
        "331121", "312113", "312311", "332111", "314111", "221411", "431111",
        "111224", "111422", "121124", "121421", "141122", "141221", "112214",
        "112412", "122114", "122411", "142112", "142211", "241211", "221114",
        "413111", "241112", "134111", "111242", "121142", "121241", "114212",
        "124112", "124211", "411212", "421112", "421211", "212141", "214121",
        "412121", "111143", "111341", "131141", "114113", "114311", "411113",
        "411311", "113141", "114131", "311141", "411131", "211412", "211214",
        "211232", "2331112"
    ];
    var C128_CODE_C = 99, C128_CODE_B = 100;
    var C128_START_B = 104, C128_START_C = 105, C128_STOP = 106;

    // ---- QR Code ----
    // Error correction level M block structure per version 1-40:
    // [ecCodewordsPerBlock, group1Blocks, group1DataCw, group2Blocks, group2DataCw]
    var QR_EC_M = [
        [10, 1, 16, 0, 0],    [16, 1, 28, 0, 0],    [26, 1, 44, 0, 0],    [18, 2, 32, 0, 0],    // v1-4
        [24, 2, 43, 0, 0],    [16, 4, 27, 0, 0],    [18, 4, 31, 0, 0],    [22, 2, 38, 2, 39],   // v5-8
        [22, 3, 36, 2, 37],   [26, 4, 43, 1, 44],   [30, 1, 50, 4, 51],   [22, 6, 36, 2, 37],   // v9-12
        [22, 8, 37, 1, 38],   [24, 4, 40, 5, 41],   [24, 5, 41, 5, 42],   [28, 7, 45, 3, 46],   // v13-16
        [28, 10, 46, 1, 47],  [26, 9, 43, 4, 44],   [26, 3, 44, 11, 45],  [26, 3, 41, 13, 42],  // v17-20
        [26, 17, 42, 0, 0],   [28, 17, 46, 0, 0],   [28, 4, 47, 14, 48],  [28, 6, 45, 14, 46],  // v21-24
        [28, 8, 47, 13, 48],  [28, 19, 46, 4, 47],  [28, 22, 45, 3, 46],  [28, 3, 45, 23, 46],  // v25-28
        [28, 21, 45, 7, 46],  [28, 19, 47, 10, 48], [28, 2, 46, 29, 47],  [28, 10, 46, 23, 47], // v29-32
        [28, 14, 46, 21, 47], [28, 14, 46, 23, 47], [28, 12, 47, 26, 48], [28, 6, 47, 34, 48],  // v33-36
        [28, 29, 46, 14, 47], [28, 13, 46, 32, 47], [28, 40, 47, 7, 48],  [28, 18, 47, 31, 48]  // v37-40
    ];

    // Alignment pattern center coordinates per version 1-40
    var QR_ALIGN = [
        [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],                                     // v1-6
        [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58],        // v7-12
        [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78],     // v13-17
        [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90], [6, 28, 50, 72, 94],              // v18-21
        [6, 26, 50, 74, 98], [6, 30, 54, 78, 102], [6, 28, 54, 80, 106], [6, 32, 58, 84, 110], // v22-25
        [6, 30, 58, 86, 114], [6, 34, 62, 90, 118], [6, 26, 50, 74, 98, 122],                // v26-28
        [6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130], [6, 30, 56, 82, 108, 134],     // v29-31
        [6, 34, 60, 86, 112, 138], [6, 30, 58, 86, 114, 142], [6, 34, 62, 90, 118, 146],     // v32-34
        [6, 30, 54, 78, 102, 126, 150], [6, 24, 50, 76, 102, 128, 154],                      // v35-36
        [6, 28, 54, 80, 106, 132, 158], [6, 32, 58, 84, 110, 136, 162],                      // v37-38
        [6, 26, 54, 82, 110, 138, 166], [6, 30, 58, 86, 114, 142, 170]                       // v39-40
    ];

    // GF(256) antilog/log tables (polynomial 0x11D), generated like EAN_R/EAN_G above
    var QR_EXP = [], QR_LOG = [];
    (function () {
        var x = 1;
        for (var i = 0; i < 255; i++) {
            QR_EXP[i] = x;
            QR_LOG[x] = i;
            x <<= 1;
            if (x & 0x100) x ^= 0x11D;
        }
    }());

    // Alphanumeric mode character set (value = index)
    var QR_ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

    // =========================================================
    //  ENCODERS
    //  1D encoders return { bars: [{x, w, tall}], width: <total modules> }
    //  x / w are in modules (may be fractional for Code 39).
    //  "tall" marks bars that extend below the others (UPC/EAN guards
    //  when human-readable text is enabled).
    //  encodeQR returns { matrix: [[0|1,...]], size: n }.
    // =========================================================

    // Convert a binary module string to bar runs; tallRanges is an array of
    // [firstModule, lastModule] (inclusive) spans whose bars are drawn tall.
    function binaryToBars(bin, tallRanges) {
        function isTall(idx) {
            if (!tallRanges) return false;
            for (var t = 0; t < tallRanges.length; t++) {
                if (idx >= tallRanges[t][0] && idx <= tallRanges[t][1]) return true;
            }
            return false;
        }
        var bars = [], i = 0, n = bin.length;
        while (i < n) {
            if (bin.charAt(i) === "1") {
                var start = i, tall = isTall(i);
                while (i < n && bin.charAt(i) === "1" && isTall(i) === tall) i++;
                bars.push({ x: start, w: i - start, tall: tall });
            } else {
                i++;
            }
        }
        return { bars: bars, width: n };
    }

    function encodeUPCA(value, includeText) {
        var bin = "101", d, i;
        for (i = 0; i < 6; i++) {
            d = Number(value.charAt(i));
            bin += EAN_L[d];
        }
        bin += "01010";
        for (i = 6; i < 12; i++) {
            d = Number(value.charAt(i));
            bin += EAN_R[d];
        }
        bin += "101";
        // Guards + first and last digit symbols print tall on UPC-A.
        var tall = includeText ? [[0, 9], [45, 49], [85, 94]] : null;
        return binaryToBars(bin, tall);
    }

    function encodeEAN13(value, includeText) {
        var parity = EAN13_PARITY[Number(value.charAt(0))];
        var bin = "101", d, i;
        for (i = 1; i <= 6; i++) {
            d = Number(value.charAt(i));
            bin += (parity.charAt(i - 1) === "L") ? EAN_L[d] : EAN_G[d];
        }
        bin += "01010";
        for (i = 7; i <= 12; i++) {
            d = Number(value.charAt(i));
            bin += EAN_R[d];
        }
        bin += "101";
        var tall = includeText ? [[0, 2], [45, 49], [92, 94]] : null;
        return binaryToBars(bin, tall);
    }

    function encodeCode39(value) {
        var text = "*" + value + "*";
        var bars = [], x = 0;
        for (var c = 0; c < text.length; c++) {
            var pat = C39[text.charAt(c)];
            for (var e = 0; e < 9; e++) {
                var w = (pat.charAt(e) === "1") ? C39_WIDE_RATIO : 1;
                if (e % 2 === 0) bars.push({ x: x, w: w, tall: false });
                x += w;
            }
            if (c < text.length - 1) x += 1; // inter-character gap (1 narrow)
        }
        return { bars: bars, width: x };
    }

    // Build the list of Code 128 symbol values with automatic B/C switching.
    function code128Values(text) {
        var vals = [], mode = null, i = 0, n = text.length;

        function digitRun(pos) {
            var c = 0;
            while (pos + c < n) {
                var ch = text.charAt(pos + c);
                if (ch < "0" || ch > "9") break;
                c++;
            }
            return c;
        }
        function ensureMode(m) {
            if (mode === m) return;
            if (mode === null) vals.push(m === "C" ? C128_START_C : C128_START_B);
            else vals.push(m === "C" ? C128_CODE_C : C128_CODE_B);
            mode = m;
        }

        while (i < n) {
            var run = digitRun(i);
            if (run >= 4) {
                if (run % 2 === 1) { // odd run: encode first digit in subset B
                    ensureMode("B");
                    vals.push(text.charCodeAt(i) - 32);
                    i++; run--;
                }
                ensureMode("C");
                while (run > 0) {
                    vals.push(Number(text.substr(i, 2)));
                    i += 2; run -= 2;
                }
            } else {
                ensureMode("B");
                vals.push(text.charCodeAt(i) - 32);
                i++;
            }
        }

        // Checksum: (startValue + sum(value_i * position_i)) mod 103
        var sum = vals[0];
        for (var k = 1; k < vals.length; k++) sum += vals[k] * k;
        vals.push(sum % 103);
        vals.push(C128_STOP);
        return vals;
    }

    function encodeCode128(value) {
        var vals = code128Values(value);
        var bars = [], x = 0;
        for (var v = 0; v < vals.length; v++) {
            var pat = C128[vals[v]];
            for (var e = 0; e < pat.length; e++) {
                var w = Number(pat.charAt(e));
                if (e % 2 === 0) bars.push({ x: x, w: w, tall: false });
                x += w;
            }
        }
        return { bars: bars, width: x };
    }

    // ---- QR Code encoder ----
    // Follows ISO/IEC 18004; structure adapted from the reference
    // implementation by Project Nayuki (MIT).

    // Bit writer: accumulates bits MSB-first into a byte array.
    function BitBuf() {
        this.bytes = [];
        this.length = 0; // in bits
    }
    BitBuf.prototype.put = function (val, n) {
        for (var i = n - 1; i >= 0; i--) {
            var byteIdx = this.length >> 3;
            if (byteIdx >= this.bytes.length) this.bytes.push(0);
            this.bytes[byteIdx] |= ((val >> i) & 1) << (7 - (this.length & 7));
            this.length++;
        }
    };

    function qrPickMode(text) {
        var numeric = true, alnum = true;
        for (var i = 0; i < text.length; i++) {
            var ch = text.charAt(i);
            if (ch < "0" || ch > "9") numeric = false;
            if (QR_ALNUM.indexOf(ch) === -1) alnum = false;
        }
        if (numeric) return "numeric";
        if (alnum) return "alnum";
        return "byte";
    }

    // Character-count field width in bits
    function qrCountBits(mode, version) {
        var g = (version <= 9) ? 0 : (version <= 26 ? 1 : 2);
        if (mode === "numeric") return [10, 12, 14][g];
        if (mode === "alnum")   return [9, 11, 13][g];
        return (version <= 9) ? 8 : 16;
    }

    // Total data bits for n characters in the given mode/version
    function qrDataBitLen(mode, n, version) {
        var bits = 4 + qrCountBits(mode, version);
        if (mode === "numeric") bits += 10 * Math.floor(n / 3) + [0, 4, 7][n % 3];
        else if (mode === "alnum") bits += 11 * Math.floor(n / 2) + 6 * (n % 2);
        else bits += 8 * n;
        return bits;
    }

    // Data codeword capacity (bytes) at EC level M
    function qrDataCapacity(version) {
        var r = QR_EC_M[version - 1];
        return r[1] * r[2] + r[3] * r[4];
    }

    // Smallest version that fits n characters of the mode, or -1
    function qrPickVersion(mode, n) {
        for (var v = 1; v <= 40; v++) {
            if (qrDataBitLen(mode, n, v) <= qrDataCapacity(v) * 8) return v;
        }
        return -1;
    }

    // Mode indicator + count + payload + terminator + padding -> data codewords
    function qrDataCodewords(text, mode, version) {
        var buf = new BitBuf();
        var n = text.length, i;
        buf.put(mode === "numeric" ? 1 : (mode === "alnum" ? 2 : 4), 4);
        buf.put(n, qrCountBits(mode, version));
        if (mode === "numeric") {
            for (i = 0; i + 3 <= n; i += 3) buf.put(Number(text.substr(i, 3)), 10);
            if (n % 3 === 1) buf.put(Number(text.substr(n - 1, 1)), 4);
            else if (n % 3 === 2) buf.put(Number(text.substr(n - 2, 2)), 7);
        } else if (mode === "alnum") {
            for (i = 0; i + 2 <= n; i += 2) {
                buf.put(QR_ALNUM.indexOf(text.charAt(i)) * 45 +
                        QR_ALNUM.indexOf(text.charAt(i + 1)), 11);
            }
            if (n % 2 === 1) buf.put(QR_ALNUM.indexOf(text.charAt(n - 1)), 6);
        } else {
            for (i = 0; i < n; i++) buf.put(text.charCodeAt(i) & 0xFF, 8);
        }
        var capacity = qrDataCapacity(version) * 8;
        var term = capacity - buf.length;
        buf.put(0, term > 4 ? 4 : term);                       // terminator
        if (buf.length % 8 !== 0) buf.put(0, 8 - (buf.length % 8));
        var padByte = 0xEC;                                    // alternate 0xEC / 0x11
        while (buf.length < capacity) {
            buf.put(padByte, 8);
            padByte = (padByte === 0xEC) ? 0x11 : 0xEC;
        }
        return buf.bytes;
    }

    function qrMul(a, b) {
        if (a === 0 || b === 0) return 0;
        return QR_EXP[(QR_LOG[a] + QR_LOG[b]) % 255];
    }

    // Reed-Solomon generator polynomial coefficients (monic, leading 1 omitted)
    var qrGenCache = {};
    function qrRSGenPoly(degree) {
        if (qrGenCache[degree]) return qrGenCache[degree];
        var result = [], i, j;
        for (i = 0; i < degree - 1; i++) result.push(0);
        result.push(1);
        var root = 1;
        for (i = 0; i < degree; i++) {
            for (j = 0; j < result.length; j++) {
                result[j] = qrMul(result[j], root);
                if (j + 1 < result.length) result[j] ^= result[j + 1];
            }
            root = qrMul(root, 2);
        }
        qrGenCache[degree] = result;
        return result;
    }

    // Polynomial remainder of data * x^degree divided by the generator
    function qrRSRemainder(data, gen) {
        var result = [], i, j;
        for (i = 0; i < gen.length; i++) result.push(0);
        for (i = 0; i < data.length; i++) {
            var factor = data[i] ^ result[0];
            for (j = 0; j < result.length - 1; j++) result[j] = result[j + 1];
            result[result.length - 1] = 0;
            for (j = 0; j < gen.length; j++) result[j] ^= qrMul(gen[j], factor);
        }
        return result;
    }

    // Split into EC blocks, compute EC per block, interleave data then EC
    function qrInterleave(dataCw, version) {
        var r = QR_EC_M[version - 1];
        var gen = qrRSGenPoly(r[0]);
        var blocks = [], ecs = [], pos = 0, i, b;
        for (b = 0; b < r[1]; b++) { blocks.push(dataCw.slice(pos, pos + r[2])); pos += r[2]; }
        for (b = 0; b < r[3]; b++) { blocks.push(dataCw.slice(pos, pos + r[4])); pos += r[4]; }
        for (b = 0; b < blocks.length; b++) ecs.push(qrRSRemainder(blocks[b], gen));
        var out = [], maxLen = (r[3] > 0) ? r[4] : r[2];
        for (i = 0; i < maxLen; i++) {
            for (b = 0; b < blocks.length; b++) {
                if (i < blocks[b].length) out.push(blocks[b][i]);
            }
        }
        for (i = 0; i < r[0]; i++) {
            for (b = 0; b < blocks.length; b++) out.push(ecs[b][i]);
        }
        return out;
    }

    // Fresh matrix with all function patterns placed and reserved.
    // m[y][x] = 0|1 module color, fun[y][x] = true for function modules.
    function qrNewMatrix(version) {
        var size = version * 4 + 17;
        var m = [], fun = [], x, y, i;
        for (y = 0; y < size; y++) {
            var row = [], frow = [];
            for (x = 0; x < size; x++) { row.push(0); frow.push(false); }
            m.push(row);
            fun.push(frow);
        }
        var qr = { size: size, version: version, m: m, fun: fun };
        function setF(px, py, dark) { m[py][px] = dark ? 1 : 0; fun[py][px] = true; }

        // Timing patterns
        for (i = 0; i < size; i++) {
            setF(6, i, i % 2 === 0);
            setF(i, 6, i % 2 === 0);
        }
        // Finder patterns + separators
        function finder(cx, cy) {
            for (var dy = -4; dy <= 4; dy++) {
                for (var dx = -4; dx <= 4; dx++) {
                    var xx = cx + dx, yy = cy + dy;
                    if (xx < 0 || xx >= size || yy < 0 || yy >= size) continue;
                    var dist = Math.max(Math.abs(dx), Math.abs(dy));
                    setF(xx, yy, dist !== 2 && dist !== 4);
                }
            }
        }
        finder(3, 3);
        finder(size - 4, 3);
        finder(3, size - 4);
        // Alignment patterns (skip the three that overlap finders)
        var pos = QR_ALIGN[version - 1], na = pos.length, a, b;
        for (a = 0; a < na; a++) {
            for (b = 0; b < na; b++) {
                if ((a === 0 && b === 0) || (a === 0 && b === na - 1) ||
                    (a === na - 1 && b === 0)) continue;
                for (var dy = -2; dy <= 2; dy++) {
                    for (var dx = -2; dx <= 2; dx++) {
                        setF(pos[a] + dx, pos[b] + dy,
                             Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
                    }
                }
            }
        }
        // Version information, v7+ (18 bits, BCH poly 0x1F25)
        if (version >= 7) {
            var rem = version;
            for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
            var vbits = (version << 12) | rem;
            for (i = 0; i < 18; i++) {
                var bit = ((vbits >> i) & 1) === 1;
                var aa = size - 11 + (i % 3);
                var bb = Math.floor(i / 3);
                setF(aa, bb, bit);
                setF(bb, aa, bit);
            }
        }
        // Reserve the format areas (real bits written per mask later)
        qrWriteFormat(qr, 0);
        return qr;
    }

    // Write the 15 format bits (EC level M + mask, BCH poly 0x537) into both
    // reserved locations, plus the fixed dark module.
    function qrWriteFormat(qr, mask) {
        var m = qr.m, fun = qr.fun, size = qr.size, i;
        function setF(px, py, dark) { m[py][px] = dark ? 1 : 0; fun[py][px] = true; }
        var data = mask;                       // EC level M bits are "00"
        var rem = data;
        for (i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
        var bits = ((data << 10) | rem) ^ 0x5412;
        function bitAt(k) { return ((bits >> k) & 1) === 1; }
        for (i = 0; i <= 5; i++) setF(8, i, bitAt(i));
        setF(8, 7, bitAt(6));
        setF(8, 8, bitAt(7));
        setF(7, 8, bitAt(8));
        for (i = 9; i < 15; i++) setF(14 - i, 8, bitAt(i));
        for (i = 0; i < 8; i++) setF(size - 1 - i, 8, bitAt(i));
        for (i = 8; i < 15; i++) setF(8, size - 15 + i, bitAt(i));
        setF(8, size - 8, true);               // dark module
    }

    // Zigzag placement of the final codeword sequence (remainder bits stay 0)
    function qrPlaceData(qr, cw) {
        var size = qr.size, m = qr.m, fun = qr.fun;
        var i = 0, total = cw.length * 8;
        for (var right = size - 1; right >= 1; right -= 2) {
            if (right === 6) right = 5;        // skip the vertical timing column
            for (var vert = 0; vert < size; vert++) {
                for (var j = 0; j < 2; j++) {
                    var x = right - j;
                    var upward = ((right + 1) & 2) === 0;
                    var y = upward ? size - 1 - vert : vert;
                    if (!fun[y][x] && i < total) {
                        m[y][x] = (cw[i >> 3] >> (7 - (i & 7))) & 1;
                        i++;
                    }
                }
            }
        }
    }

    // XOR the mask pattern over all non-function modules (self-inverse)
    function qrApplyMask(qr, mask) {
        var size = qr.size, m = qr.m, fun = qr.fun;
        for (var y = 0; y < size; y++) {
            for (var x = 0; x < size; x++) {
                if (fun[y][x]) continue;
                var invert;
                switch (mask) {
                    case 0: invert = (x + y) % 2 === 0; break;
                    case 1: invert = y % 2 === 0; break;
                    case 2: invert = x % 3 === 0; break;
                    case 3: invert = (x + y) % 3 === 0; break;
                    case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
                    case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
                    case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
                    default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
                }
                if (invert) m[y][x] = m[y][x] ? 0 : 1;
            }
        }
    }

    // Penalty score, rules N1-N4 (lower is better)
    function qrPenalty(qr) {
        var n = qr.size, m = qr.m, score = 0, x, y, i;
        // Row and column strings for the run-based rules
        var lines = [];
        for (y = 0; y < n; y++) lines.push(m[y].join(""));
        for (x = 0; x < n; x++) {
            var s = "";
            for (y = 0; y < n; y++) s += m[y][x];
            lines.push(s);
        }
        for (var L = 0; L < lines.length; L++) {
            var str = lines[L];
            // N1: runs of 5+ same-colored modules
            var run = 1;
            for (i = 1; i <= n; i++) {
                if (i < n && str.charAt(i) === str.charAt(i - 1)) {
                    run++;
                } else {
                    if (run >= 5) score += 3 + (run - 5);
                    run = 1;
                }
            }
            // N3: finder-like 1:1:3:1:1 pattern with 4 light modules on a side
            var idx = str.indexOf("1011101");
            while (idx !== -1) {
                if ((idx >= 4 && str.substring(idx - 4, idx) === "0000") ||
                    (idx + 11 <= n && str.substring(idx + 7, idx + 11) === "0000")) {
                    score += 40;
                }
                idx = str.indexOf("1011101", idx + 1);
            }
        }
        // N2: 2x2 blocks of the same color
        for (y = 0; y < n - 1; y++) {
            for (x = 0; x < n - 1; x++) {
                var c = m[y][x];
                if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
            }
        }
        // N4: deviation of the dark-module proportion from 50%
        var dark = 0;
        for (y = 0; y < n; y++) {
            for (x = 0; x < n; x++) dark += m[y][x];
        }
        var pct = dark * 100 / (n * n);
        score += Math.floor((pct < 50 ? 50 - pct : pct - 50) / 5) * 10;
        return score;
    }

    var qrLastText = null, qrLastResult = null; // the preview re-requests the same value
    function encodeQR(text) {
        if (text === qrLastText) return qrLastResult;
        var mode = qrPickMode(text);
        var version = qrPickVersion(mode, text.length);
        if (version < 0) throw new Error("Value too long for a QR code.");
        var dataCw = qrDataCodewords(text, mode, version);
        var allCw = qrInterleave(dataCw, version);
        var qr = qrNewMatrix(version);
        qrPlaceData(qr, allCw);
        // Try all 8 masks, keep the lowest penalty (apply is self-inverse)
        var bestMask = 0, bestScore = -1;
        for (var mask = 0; mask < 8; mask++) {
            qrApplyMask(qr, mask);
            qrWriteFormat(qr, mask);
            var score = qrPenalty(qr);
            if (bestScore < 0 || score < bestScore) {
                bestScore = score;
                bestMask = mask;
            }
            qrApplyMask(qr, mask);
        }
        qrApplyMask(qr, bestMask);
        qrWriteFormat(qr, bestMask);
        qrLastText = text;
        qrLastResult = { matrix: qr.m, size: qr.size };
        return qrLastResult;
    }

    // =========================================================
    //  VALIDATION
    //  Returns { value } or { error } - plus optional fields the
    //  caller decides how to surface (preview stays silent):
    //    notice        : informational message (check digit appended)
    //    checkMismatch : { typed, fixed } when the check digit is wrong
    // =========================================================

    // Mod-10 check digit for UPC/EAN; digits = data digits WITHOUT the check
    // digit (11 for UPC-A, 12 for EAN-13). Weight 3 starts at the rightmost
    // data digit, alternating 3/1.
    function eanCheckDigit(digits) {
        var sum = 0, w = 3;
        for (var i = digits.length - 1; i >= 0; i--) {
            sum += Number(digits.charAt(i)) * w;
            w = 4 - w;
        }
        return String((10 - (sum % 10)) % 10);
    }

    function validateInput(type, raw) {
        var value = raw;

        if (type === "UPC-A" || type === "EAN-13") {
            value = value.replace(/[\s\-]/g, ""); // allow spaces/hyphens as separators
            var len = (type === "UPC-A") ? 12 : 13;
            if (value.length === 0) return { error: "Please enter a barcode value." };
            if (!/^\d+$/.test(value)) {
                return { error: type + " accepts digits only\n(spaces and hyphens are ignored)." };
            }
            if (value.length === len - 1) {
                var cd = eanCheckDigit(value);
                return { value: value + cd,
                         notice: type + " check digit " + cd + " was appended:\n" + value + cd };
            }
            if (value.length === len) {
                var body = value.substring(0, len - 1);
                var expect = eanCheckDigit(body);
                if (value.charAt(len - 1) !== expect) {
                    return { value: value,
                             checkMismatch: { typed: value, fixed: body + expect } };
                }
                return { value: value };
            }
            return { error: type + " requires " + (len - 1) + " digits (check digit is " +
                            "added automatically) or all " + len + " digits." };
        }

        if (type === "Code 39") {
            value = value.toUpperCase().replace(/^\*+|\*+$/g, ""); // strip start/stop asterisks
            if (value.length === 0) return { error: "Please enter a barcode value." };
            for (var i = 0; i < value.length; i++) {
                var ch = value.charAt(i);
                if (ch === "*" || C39[ch] === undefined) {
                    return { error: "Invalid Code 39 character: \"" + ch + "\"\n" +
                                    "Allowed: 0-9  A-Z  space  - . $ / + %" };
                }
            }
            return { value: value };
        }

        if (type === "QR Code") {
            if (value.length === 0) return { error: "Please enter a barcode value." };
            var mode = qrPickMode(value);
            if (mode === "byte") {
                for (var q = 0; q < value.length; q++) {
                    if (value.charCodeAt(q) > 255) {
                        return { error: "QR Code (byte mode) supports Latin-1 characters " +
                                        "only.\nCharacter \"" + value.charAt(q) +
                                        "\" cannot be encoded." };
                    }
                }
            }
            if (qrPickVersion(mode, value.length) === -1) {
                return { error: "Value too long for a QR code.\nMaximum at EC level M: " +
                                "5596 digits, 3391 alphanumeric,\nor 2331 byte characters." };
            }
            return { value: value };
        }

        // Code 128
        if (value.length === 0) return { error: "Please enter a barcode value." };
        for (var j = 0; j < value.length; j++) {
            var code = value.charCodeAt(j);
            if (code < 32 || code > 126) {
                return { error: "Invalid Code 128 character at position " + (j + 1) + ".\n" +
                                "Only printable ASCII (32-126) is supported." };
            }
        }
        return { value: value };
    }

    // =========================================================
    //  DRAWING
    // =========================================================
    function makeBlack(doc) {
        if (doc.documentColorSpace === DocumentColorSpace.CMYK) {
            var k = new CMYKColor();
            k.cyan = 0; k.magenta = 0; k.yellow = 0; k.black = 100;
            return k;
        }
        var rgb = new RGBColor();
        rgb.red = 0; rgb.green = 0; rgb.blue = 0;
        return rgb;
    }

    function makeWhite(doc) {
        if (doc.documentColorSpace === DocumentColorSpace.CMYK) {
            var k = new CMYKColor();
            k.cyan = 0; k.magenta = 0; k.yellow = 0; k.black = 0;
            return k;
        }
        var rgb = new RGBColor();
        rgb.red = 255; rgb.green = 255; rgb.blue = 255;
        return rgb;
    }

    function pickFont() {
        var names = ["OCRB", "OCR-B", "ArialMT", "Helvetica", "MyriadPro-Regular"];
        for (var i = 0; i < names.length; i++) {
            try { return app.textFonts.getByName(names[i]); } catch (e) {}
        }
        return null; // fall back to the application default
    }

    // Adds one closed rectangle subpath to a compound path.
    function addRectPath(cp, top, left, w, h, color) {
        var p = cp.pathItems.add();
        p.setEntirePath([[left, top], [left + w, top], [left + w, top - h], [left, top - h]]);
        p.closed = true;
        p.stroked = false;
        p.filled = true;
        p.fillColor = color; // compound paths take their style from the subpaths
    }

    // Geometry shared by the on-canvas art and the dialog preview.
    // All values in pt; y is measured DOWN from the top of the background.
    // opts = { type, value, includeText, drawBackground, pad, fontSize,
    //          textGap, moduleWidth, barHeight }
    // Returns { bgW, bgH, rects: [{x,y,w,h}], texts: [{str,cx,baseY}],
    //           fontSize, barsTopY, barH, vQuiet, info }
    function buildLayout(opts) {
        var type = opts.type, value = opts.value, includeText = opts.includeText;
        var mw = opts.moduleWidth;
        var fs = opts.fontSize;
        var isQR = (type === "QR Code");
        var isRetail = (type === "UPC-A" || type === "EAN-13");

        var enc = null, qr = null;
        if (isQR)                    qr = encodeQR(value);
        else if (type === "UPC-A")   enc = encodeUPCA(value, includeText);
        else if (type === "EAN-13")  enc = encodeEAN13(value, includeText);
        else if (type === "Code 39") enc = encodeCode39(value);
        else                         enc = encodeCode128(value);

        var barH = isQR ? qr.size * mw : opts.barHeight;
        var barsWidth = (isQR ? qr.size : enc.width) * mw;
        var quiet = (isQR ? QR_QUIET_ZONE : QUIET_ZONE) * mw;
        var vQuiet = isQR ? quiet : 0; // QR needs the quiet zone on all four sides

        // Caps/digits reach ~0.72 em above the baseline; the text top sits
        // opts.textGap below the bars (below the quiet zone for QR).
        var cap = fs * 0.72;
        var guardDrop = 0; // tall (guard) bars extend down to the digit baseline
        var textBand = 0;  // reserved space below the bars for Code 39/128/QR text
        if (includeText) {
            if (isRetail) guardDrop = opts.textGap + cap;
            else          textBand = opts.textGap + fs; // cap height + descender slack
        }
        var barsTopY = opts.pad + vQuiet;
        var belowBars = isRetail ? guardDrop : vQuiet + textBand;
        var bgW = barsWidth + 2 * quiet;
        var bgH = barsTopY + barH + belowBars + opts.pad;

        var rects = [], texts = [], i;
        var x0 = quiet; // left edge of the first module

        if (isQR) {
            for (var rr = 0; rr < qr.size; rr++) {
                var runs = binaryToBars(qr.matrix[rr].join(""), null);
                for (var qq = 0; qq < runs.bars.length; qq++) {
                    var runBar = runs.bars[qq];
                    rects.push({ x: x0 + runBar.x * mw, y: barsTopY + rr * mw,
                                 w: runBar.w * mw, h: mw });
                }
            }
        } else {
            for (var b = 0; b < enc.bars.length; b++) {
                var bar = enc.bars[b];
                rects.push({ x: x0 + bar.x * mw, y: barsTopY,
                             w: bar.w * mw, h: barH + (bar.tall ? guardDrop : 0) });
            }
        }

        function addTextItem(str, cx, baseY) {
            texts.push({ str: str, cx: cx, baseY: baseY });
        }
        // One digit per slot, evenly spread between two module positions
        function addDigits(str, leftModule, rightModule, baseY) {
            var xL = x0 + leftModule * mw;
            var slot = ((rightModule - leftModule) * mw) / str.length;
            for (var k = 0; k < str.length; k++) {
                addTextItem(str.charAt(k), xL + (k + 0.5) * slot, baseY);
            }
        }

        if (includeText) {
            if (type === "UPC-A") {
                var baseY = barsTopY + barH + guardDrop; // guard-bar bottom
                addTextItem(value.charAt(0), x0 - 5 * mw, baseY);    // lead digit (quiet zone)
                addDigits(value.substring(1, 6), 10, 45, baseY);     // left group
                addDigits(value.substring(6, 11), 50, 85, baseY);    // right group
                addTextItem(value.charAt(11), x0 + 100 * mw, baseY); // trailing digit
            } else if (type === "EAN-13") {
                var baseY2 = barsTopY + barH + guardDrop;
                addTextItem(value.charAt(0), x0 - 6 * mw, baseY2);   // lead digit (quiet zone)
                addDigits(value.substring(1, 7), 3, 45, baseY2);     // left group
                addDigits(value.substring(7, 13), 50, 92, baseY2);   // right group
            } else {
                var txt = (value.length > 40) ? value.substr(0, 40) + "..." : value;
                addTextItem(txt, x0 + barsWidth / 2,
                            barsTopY + barH + vQuiet + opts.textGap + cap);
            }
        }

        return { bgW: bgW, bgH: bgH, rects: rects, texts: texts, fontSize: fs,
                 barsTopY: barsTopY, barH: barH, vQuiet: vQuiet };
    }

    // Draws the barcode on a new layer, centered on the active artboard.
    // Returns the created Layer.
    function drawBarcode(opts) {
        var doc = (app.documents.length > 0) ? app.activeDocument : app.documents.add();
        var lay = buildLayout(opts);
        var i;

        // Center on the active artboard
        var ab = doc.artboards[doc.artboards.getActiveArtboardIndex()].artboardRect;
        var bgLeft = (ab[0] + ab[2]) / 2 - lay.bgW / 2;
        var bgTop = (ab[1] + ab[3]) / 2 + lay.bgH / 2;

        var black = makeBlack(doc);
        var white = makeWhite(doc);
        var font = opts.includeText ? pickFont() : null;

        // New layer + group
        var layer = doc.layers.add();
        var label = opts.value.length > 24 ? opts.value.substr(0, 24) + "..." : opts.value;
        layer.name = "Barcode - " + opts.type + " " + label;
        var grp = layer.groupItems.add();
        grp.name = opts.type + " " + label;

        // Background / quiet zone
        var bg = null;
        if (opts.drawBackground) {
            bg = grp.pathItems.rectangle(bgTop, bgLeft, lay.bgW, lay.bgH);
            bg.stroked = false;
            bg.filled = true;
            bg.fillColor = white;
            bg.name = "Background (quiet zone)";
        }

        // Bars / modules as a single compound path
        var cp = grp.compoundPathItems.add();
        cp.name = "Bars";
        for (i = 0; i < lay.rects.length; i++) {
            var r = lay.rects[i];
            addRectPath(cp, bgTop - r.y, bgLeft + r.x, r.w, r.h, black);
        }

        // Human-readable text
        if (opts.includeText) {
            for (i = 0; i < lay.texts.length; i++) {
                var t = lay.texts[i];
                var tf = grp.textFrames.pointText([bgLeft + t.cx, bgTop - t.baseY]);
                tf.contents = t.str;
                var attrs = tf.textRange.characterAttributes;
                attrs.size = lay.fontSize;
                attrs.fillColor = black;
                if (font) attrs.textFont = font;
                tf.textRange.paragraphAttributes.justification = Justification.CENTER;
            }
            // Convert text to outlines: the output no longer depends on
            // installed fonts, and the background can hug the real glyph
            // bounds instead of reserving descender space.
            for (i = grp.textFrames.length - 1; i >= 0; i--) {
                grp.textFrames[i].createOutline();
            }
            if (bg) {
                // Tighten the background bottom to the lowest artwork edge
                // (never inside the QR quiet zone), plus the padding.
                var minBottom = bgTop - (lay.barsTopY + lay.barH + lay.vQuiet);
                for (i = 0; i < grp.pageItems.length; i++) {
                    var it = grp.pageItems[i];
                    if (it === bg) continue;
                    var gb = it.geometricBounds; // [left, top, right, bottom]
                    if (gb[3] < minBottom) minBottom = gb[3];
                }
                bg.height = bgTop - (minBottom - opts.pad);
            }
        }

        doc.selection = null;
        grp.selected = true;
        app.redraw();
        return layer;
    }

    // =========================================================
    //  DIALOG
    // =========================================================

    // BARCODEGENERATOR
    // ================
    var BarcodeGenerator = new Window("dialog");
        BarcodeGenerator.text = "Barcode Generator";
        BarcodeGenerator.orientation = "column";
        BarcodeGenerator.alignChildren = ["fill", "top"];
        BarcodeGenerator.spacing = 10;
        BarcodeGenerator.margins = 16;

    // MAINROW: input column + options panel side by side
    // ==================================================
    var mainRow = BarcodeGenerator.add("group");
        mainRow.orientation = "row";
        mainRow.alignChildren = ["left", "top"];
        mainRow.spacing = 12;
        mainRow.margins = 0;

    var leftCol = mainRow.add("group");
        leftCol.orientation = "column";
        leftCol.alignChildren = ["left", "top"];
        leftCol.spacing = 10;
        leftCol.margins = 0;

    var group1 = leftCol.add("group");
        group1.orientation = "row";
        group1.alignChildren = ["left", "center"];
        group1.spacing = 10;
        group1.margins = 0;

    var statictext1 = group1.add("statictext", undefined, "Barcode Type:");

    var BarcodeType_array = ["UPC-A", "EAN-13", "Code 39", "Code 128", "QR Code"];
    var BarcodeType = group1.add("dropdownlist", undefined, undefined,
                                 {name: "BarcodeType", items: BarcodeType_array});
        BarcodeType.selection = 0;
        BarcodeType.preferredSize.width = 100;

    var group2 = leftCol.add("group");
        group2.orientation = "column";
        group2.alignChildren = ["left", "center"];
        group2.spacing = 0;
        group2.margins = 0;

    var statictext2 = group2.add("statictext", undefined, "Barcode Value:");

    var BarcodeValue = group2.add("edittext", undefined, "", {name: "BarcodeValue"});
        BarcodeValue.preferredSize.width = 200;
        BarcodeValue.helpTip = "UPC-A: 11-12 digits / EAN-13: 12-13 digits " +
            "(check digit added or verified)\n" +
            "Code 39: 0-9 A-Z space - . $ / + %\n" +
            "Code 128: any printable ASCII\n" +
            "QR Code: any text (digits-only or uppercase A-Z 0-9 $%*+-./: " +
            "encode as smaller symbols)";

    // OPTIONS PANEL
    // =============
    var optsPanel = mainRow.add("panel", undefined, "Options");
        optsPanel.orientation = "column";
        optsPanel.alignChildren = ["left", "top"];
        optsPanel.spacing = 8;
        optsPanel.margins = 12;

    var IncludeText = optsPanel.add("checkbox", undefined, "Include Text Value",
                                    {name: "IncludeText"});
        IncludeText.value = true;

    var WhiteBg = optsPanel.add("checkbox", undefined, "White Background",
                                {name: "WhiteBg"});
        WhiteBg.value = DRAW_BACKGROUND;

    var padRow = optsPanel.add("group");
        padRow.add("statictext", undefined, "Padding:");
    var PadSlider = padRow.add("slider", undefined, PAD, 0, 10);
        PadSlider.preferredSize.width = 100;
    var PadLabel = padRow.add("statictext", undefined, PAD + " pt");
        PadLabel.preferredSize.width = 40;

    var heightRow = optsPanel.add("group");
        heightRow.add("statictext", undefined, "Height:");
    var HeightSlider = heightRow.add("slider", undefined, BAR_HEIGHT, 10, 400);
        HeightSlider.preferredSize.width = 100;
    var HeightLabel = heightRow.add("statictext", undefined, BAR_HEIGHT + " pt");
        HeightLabel.preferredSize.width = 40;

    var fontRow = optsPanel.add("group");
        fontRow.add("statictext", undefined, "Text Size:");
    var FontSlider = fontRow.add("slider", undefined, FONT_SIZE, 4, 24);
        FontSlider.preferredSize.width = 100;
    var FontLabel = fontRow.add("statictext", undefined, FONT_SIZE + " pt");
        FontLabel.preferredSize.width = 40;

    var gapRow = optsPanel.add("group");
        gapRow.add("statictext", undefined, "Text Gap:");
    var GapSlider = gapRow.add("slider", undefined, TEXT_GAP, 0, 10);
        GapSlider.preferredSize.width = 100;
        GapSlider.helpTip = "Space between the bottom of the bars and the top of the text";
    var GapLabel = gapRow.add("statictext", undefined, TEXT_GAP + " pt");
        GapLabel.preferredSize.width = 40;

    var magRow = optsPanel.add("group");
        magRow.add("statictext", undefined, "Magnification:");
    var MagList = magRow.add("dropdownlist", undefined, undefined,
                             {items: ["80%", "90%", "100%", "150%", "200%", "Custom"]});
        MagList.selection = MAGS.length; // "Custom"
        MagList.preferredSize.width = 80;
        MagList.helpTip = "GS1 UPC/EAN size presets: 100% = 0.33 mm module width, " +
                          "22.85 mm bar height.\nSets the module width internally " +
                          "and moves the Height slider.";

    // BUTTONS
    // =======
    var btnRow = BarcodeGenerator.add("group");
        btnRow.orientation = "row";
        btnRow.alignment = ["right", "top"];
        btnRow.spacing = 10;

    var previewBtn = btnRow.add("button", undefined, "Preview");
    var cancelBtn = btnRow.add("button", undefined, "Cancel", {name: "cancel"});
    var button1 = btnRow.add("button", undefined, "Generate", {name: "ok"});

    // =========================================================
    //  WIRING
    // =========================================================
    var result = null;
    var previewLayer = null;   // Layer currently drawn as preview, or null
    var previewKey = "";       // parameter fingerprint of what's on canvas
    var suppressEvents = false;
    var curModuleWidth = MODULE_WIDTH; // pt; set by the Magnification presets
    var fontWarned = false;

    // Reads all controls (sizes in pt)
    function readOpts() {
        return {
            type: BarcodeType.selection.text,
            rawValue: BarcodeValue.text,
            includeText: IncludeText.value,
            drawBackground: WhiteBg.value,
            pad: Math.round(PadSlider.value),
            fontSize: Math.round(FontSlider.value),
            textGap: Math.round(GapSlider.value),
            moduleWidth: curModuleWidth,
            barHeight: Math.round(HeightSlider.value)
        };
    }

    function makeKey(o) {
        // values are single-line, so a newline is a collision-safe separator
        return [o.type, o.value, o.includeText, o.drawBackground, o.pad,
                o.fontSize, o.textGap, o.moduleWidth, o.barHeight].join("\n");
    }

    function clearPreview() {
        if (!previewLayer) return;
        try { previewLayer.remove(); } catch (e) {} // user may have deleted it
        previewLayer = null;
        previewKey = "";
        try { app.redraw(); } catch (e2) {}
    }

    function updatePreview() {
        if (suppressEvents) return;
        var o = readOpts();
        var check = validateInput(o.type, o.rawValue);
        if (check.error) { clearPreview(); return; }   // invalid -> clear, no alert
        o.value = check.value;                          // mismatch previews as typed
        var key = makeKey(o);
        if (previewLayer && key === previewKey) return;
        clearPreview();
        try {
            previewLayer = drawBarcode(o);
            previewKey = key;
        } catch (err) {
            previewLayer = null;
            previewKey = "";
        }
    }

    // Three-way dialog for a wrong check digit. Returns "fix" | "ignore" | "cancel".
    function askCheckDigit(typed, fixed) {
        var w = new Window("dialog", "Check Digit");
        w.orientation = "column";
        w.alignChildren = ["fill", "top"];
        w.margins = 16;
        w.spacing = 12;
        var msg = w.add("statictext", undefined,
            "The check digit should be \"" + fixed.charAt(fixed.length - 1) +
            "\" but you entered \"" + typed.charAt(typed.length - 1) + "\".",
            {multiline: true});
        msg.preferredSize.width = 280;
        var btns = w.add("group");
        btns.orientation = "row";
        btns.alignment = ["center", "top"];
        var out = "cancel";
        var bFix = btns.add("button", undefined, "Fix (" + fixed + ")");
        var bKeep = btns.add("button", undefined, "Use as typed");
        var bCancel = btns.add("button", undefined, "Cancel", {name: "cancel"});
        bFix.onClick = function () { out = "fix"; w.close(1); };
        bKeep.onClick = function () { out = "ignore"; w.close(2); };
        bCancel.onClick = function () { out = "cancel"; w.close(0); };
        w.show();
        return out;
    }

    // Recommend OCR-B for UPC/EAN human-readable text (once per run)
    function warnIfNoOCRFont() {
        if (fontWarned) return;
        fontWarned = true;
        var names = ["OCRB", "OCR-B"], ok = false;
        for (var i = 0; i < names.length; i++) {
            try { app.textFonts.getByName(names[i]); ok = true; break; } catch (e) {}
        }
        if (!ok) {
            alert("The OCR-B font (the standard for UPC/EAN human-readable " +
                  "digits) is not installed.\nA fallback font will be used - " +
                  "consider installing OCR-B for spec-compliant output.",
                  "Barcode Generator");
        }
    }

    BarcodeType.onChange = function () {
        if (suppressEvents) return;
        var t = BarcodeType.selection.text;
        HeightSlider.enabled = (t !== "QR Code");  // QR stays square
        MagList.enabled = (t === "UPC-A" || t === "EAN-13");
        updatePreview();
    };

    MagList.onChange = function () {
        if (suppressEvents) return;
        var idx = MagList.selection.index;
        if (idx >= MAGS.length) { updatePreview(); return; } // "Custom"
        suppressEvents = true;
        curModuleWidth = EAN_X100 * MAGS[idx];
        HeightSlider.value = EAN_H100 * MAGS[idx];
        HeightLabel.text = Math.round(HeightSlider.value) + " pt";
        suppressEvents = false;
        updatePreview();
    };

    // Labels track the drag live; the artboard preview redraws only on
    // release (a full vector rebuild per drag tick is too slow).
    PadSlider.onChanging = function () {
        PadLabel.text = Math.round(PadSlider.value) + " pt";
    };
    PadSlider.onChange = function () {
        PadLabel.text = Math.round(PadSlider.value) + " pt";
        updatePreview();
    };

    HeightSlider.onChanging = function () {
        HeightLabel.text = Math.round(HeightSlider.value) + " pt";
    };
    HeightSlider.onChange = function () {
        if (suppressEvents) return;
        HeightLabel.text = Math.round(HeightSlider.value) + " pt";
        suppressEvents = true;
        MagList.selection = MAGS.length; // height no longer matches a preset
        suppressEvents = false;
        updatePreview();
    };

    FontSlider.onChanging = function () {
        FontLabel.text = Math.round(FontSlider.value) + " pt";
    };
    FontSlider.onChange = function () {
        FontLabel.text = Math.round(FontSlider.value) + " pt";
        updatePreview();
    };

    GapSlider.onChanging = function () {
        GapLabel.text = Math.round(GapSlider.value) + " pt";
    };
    GapSlider.onChange = function () {
        GapLabel.text = Math.round(GapSlider.value) + " pt";
        updatePreview();
    };

    previewBtn.onClick = function () { updatePreview(); };

    BarcodeValue.onChange = function () { updatePreview(); };
    IncludeText.onClick = function () { updatePreview(); };
    WhiteBg.onClick = function () { updatePreview(); };

    button1.onClick = function () {
        var o = readOpts();
        var check = validateInput(o.type, o.rawValue);
        if (check.error) {
            alert(check.error, "Barcode Generator");
            return;
        }
        var finalValue = check.value;
        if (check.checkMismatch) {
            var ans = askCheckDigit(check.checkMismatch.typed, check.checkMismatch.fixed);
            if (ans === "cancel") return;              // stay in the dialog
            finalValue = (ans === "fix") ? check.checkMismatch.fixed
                                         : check.checkMismatch.typed;
        } else if (check.notice) {
            alert(check.notice, "Barcode Generator");
        }
        if ((o.type === "UPC-A" || o.type === "EAN-13") && o.includeText) {
            warnIfNoOCRFont();
        }
        o.value = finalValue;
        var key = makeKey(o);
        if (previewLayer && previewKey === key) {
            previewLayer = null;                       // keep the preview as final art
            BarcodeGenerator.close(1);
            return;
        }
        clearPreview();
        result = o;
        BarcodeGenerator.close(1);
    };

    cancelBtn.onClick = function () {
        BarcodeGenerator.close(0);
    };

    // Covers Cancel, the title-bar close box, and Esc. A kept final layer
    // has previewLayer nulled before close, so it survives this cleanup.
    BarcodeGenerator.onClose = function () {
        clearPreview();
        return true;
    };

    BarcodeGenerator.show();

    if (result) {
        try {
            drawBarcode(result);
        } catch (err) {
            alert("Could not generate barcode:\n" + err.message, "Barcode Generator");
        }
    }

}());

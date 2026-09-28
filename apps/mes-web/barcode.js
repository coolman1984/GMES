// Code 128 (set B: printable ASCII) as bar widths, for the label preview. No imports: the tests load it directly.
// The printer draws the real barcode from the ZPL; this only shows what it will look like, so a wrong value is seen
// before a roll of labels is spent on it. The check character is computed exactly as the printer does.
const P = ("212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 " +
  "221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 " +
  "231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 " +
  "314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 " +
  "111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 " +
  "114131 311141 411131 211412 211214 211232 2331112").split(" ");
const START_B = 104, STOP = 106;

/** The symbol values of a text in Code 128 B, with the start and the check character (not the stop). */
export function code128Values(text) {
  const vals = [START_B];
  for (const ch of String(text)) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 127) throw new RangeError("Code 128 B carries printable ASCII only");
    vals.push(c - 32);
  }
  let sum = vals[0];
  for (let i = 1; i < vals.length; i++) sum += vals[i] * i;
  vals.push(sum % 103);
  return vals;
}
/** Alternating bar/space widths in modules, starting with a bar (quiet zones not included). */
export function code128Widths(text) {
  return code128Values(text).concat([STOP]).flatMap((v) => P[v].split("").map(Number));
}
export const CODE128_PATTERNS = P;

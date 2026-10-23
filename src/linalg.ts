/** Three-component vectors and 3 × 3 matrices (row-major), the only linear algebra the package needs. */

export type Vec3 = [number, number, number];
export type Mat3 = [Vec3, Vec3, Vec3];

export function mulMV(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

export function mulMM(a: Mat3, b: Mat3): Mat3 {
  const r = (i: number): Vec3 => [
    a[i][0] * b[0][0] + a[i][1] * b[1][0] + a[i][2] * b[2][0],
    a[i][0] * b[0][1] + a[i][1] * b[1][1] + a[i][2] * b[2][1],
    a[i][0] * b[0][2] + a[i][1] * b[1][2] + a[i][2] * b[2][2],
  ];
  return [r(0), r(1), r(2)];
}

export function inv3(m: Mat3): Mat3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (det === 0) throw new Error('wlab: singular 3 × 3 matrix');
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

export const identity3 = (): Mat3 => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

export const diag3 = (v: Vec3): Mat3 => [[v[0], 0, 0], [0, v[1], 0], [0, 0, v[2]]];

// Dimensi lapangan dalam meter. Semua koordinat di engine memakai meter,
// bukan piksel. Renderer yang bertugas mengubah meter menjadi piksel.
//
// Sistem koordinat:
//   x: 0 = garis gawang kiri, PITCH.length = garis gawang kanan
//   y: 0 = garis samping atas, PITCH.width = garis samping bawah
// Tim kandang menyerang ke kanan, tim tamu menyerang ke kiri.

export const PITCH = Object.freeze({
  length: 105,
  width: 68,
  centerCircleRadius: 9.15,
  penaltyAreaDepth: 16.5,
  penaltyAreaWidth: 40.32,
  goalAreaDepth: 5.5,
  goalAreaWidth: 18.32,
  penaltySpotDistance: 11,
  goalWidth: 7.32,
  goalDepth: 2,
});

export function isInsidePitch(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  return x >= 0 && x <= PITCH.length && y >= 0 && y <= PITCH.width;
}

// Tarik titik ke dalam lapangan, menyisakan jarak `margin` meter dari garis.
export function clampToPitch(point, margin = 0) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new TypeError(`clampToPitch: titik tidak valid ${JSON.stringify(point)}`);
  }
  if (!(margin >= 0) || margin * 2 >= PITCH.width) {
    throw new RangeError(`clampToPitch: margin tidak valid ${margin}`);
  }
  return {
    x: Math.min(PITCH.length - margin, Math.max(margin, point.x)),
    y: Math.min(PITCH.width - margin, Math.max(margin, point.y)),
  };
}

// Jarak "ke depan" dari sudut pandang tim: 0 = garis gawang sendiri.
export function forwardOf(point, attacksRight) {
  return attacksRight ? point.x : PITCH.length - point.x;
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Kotak penalti milik tim yang menyerang ke arah `attacksRight`
// (kotak di depan gawangnya sendiri).
export function insideOwnPenaltyArea(point, attacksRight) {
  const depth = forwardOf(point, attacksRight);
  return depth <= PITCH.penaltyAreaDepth && Math.abs(point.y - PITCH.width / 2) <= PITCH.penaltyAreaWidth / 2;
}

// Garis gawang yang diserang tim ini.
export function opponentGoalX(attacksRight) {
  return attacksRight ? PITCH.length : 0;
}

export function isBetweenPosts(y) {
  return Math.abs(y - PITCH.width / 2) <= PITCH.goalWidth / 2;
}

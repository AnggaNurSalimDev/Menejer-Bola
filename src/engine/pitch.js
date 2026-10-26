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

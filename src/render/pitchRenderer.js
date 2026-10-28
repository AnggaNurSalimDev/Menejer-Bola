// Renderer canvas. Hanya membaca state engine, tidak pernah mengubahnya.
// Semua ukuran di sini ditulis dalam meter, lalu dikonversi lewat viewport.

import { PITCH } from '../engine/pitch.js';
import { CONDITION } from '../engine/condition.js';

const MARGIN_METERS = 4;
const JERSEY_WIDTH_METERS = 2.6;
const BALL_RADIUS_METERS = 0.55;

const COLORS = {
  grassLight: '#3f8f4a',
  grassDark: '#377f41',
  line: 'rgba(255, 255, 255, 0.85)',
  outside: '#2e6b37',
  nameText: '#ffffff',
  nameStroke: 'rgba(0, 0, 0, 0.75)',
};

// Viewport: mengubah koordinat meter menjadi piksel, menjaga rasio lapangan.
export function createViewport(cssWidth, cssHeight) {
  if (!(cssWidth > 0) || !(cssHeight > 0)) {
    throw new RangeError(`createViewport: ukuran tidak valid ${cssWidth}x${cssHeight}`);
  }

  const totalW = PITCH.length + MARGIN_METERS * 2;
  const totalH = PITCH.width + MARGIN_METERS * 2;
  const scale = Math.min(cssWidth / totalW, cssHeight / totalH);
  const offsetX = (cssWidth - totalW * scale) / 2 + MARGIN_METERS * scale;
  const offsetY = (cssHeight - totalH * scale) / 2 + MARGIN_METERS * scale;

  return {
    scale,
    px: (meters) => meters * scale,
    toX: (x) => offsetX + x * scale,
    toY: (y) => offsetY + y * scale,
  };
}

function drawPitch(ctx, vp, cssWidth, cssHeight) {
  const L = PITCH.length;
  const W = PITCH.width;

  ctx.fillStyle = COLORS.outside;
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  // Garis-garis rumput.
  const stripes = 14;
  for (let i = 0; i < stripes; i += 1) {
    ctx.fillStyle = i % 2 === 0 ? COLORS.grassLight : COLORS.grassDark;
    const x0 = (L / stripes) * i;
    ctx.fillRect(vp.toX(x0), vp.toY(0), vp.px(L / stripes) + 1, vp.px(W));
  }

  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = Math.max(1.5, vp.px(0.15));

  // Batas lapangan dan garis tengah.
  ctx.strokeRect(vp.toX(0), vp.toY(0), vp.px(L), vp.px(W));
  line(ctx, vp, L / 2, 0, L / 2, W);

  // Lingkaran tengah dan titik tengah.
  circle(ctx, vp, L / 2, W / 2, PITCH.centerCircleRadius);
  dot(ctx, vp, L / 2, W / 2, 0.35);

  // Kotak penalti, kotak gawang, titik penalti, gawang — kedua sisi.
  for (const side of [0, 1]) {
    const dir = side === 0 ? 1 : -1;
    const goalLine = side === 0 ? 0 : L;

    box(ctx, vp, goalLine, PITCH.penaltyAreaDepth * dir, PITCH.penaltyAreaWidth);
    box(ctx, vp, goalLine, PITCH.goalAreaDepth * dir, PITCH.goalAreaWidth);
    dot(ctx, vp, goalLine + PITCH.penaltySpotDistance * dir, W / 2, 0.3);
    box(ctx, vp, goalLine, -PITCH.goalDepth * dir, PITCH.goalWidth);
  }
}

function line(ctx, vp, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(vp.toX(x1), vp.toY(y1));
  ctx.lineTo(vp.toX(x2), vp.toY(y2));
  ctx.stroke();
}

function circle(ctx, vp, x, y, r) {
  ctx.beginPath();
  ctx.arc(vp.toX(x), vp.toY(y), vp.px(r), 0, Math.PI * 2);
  ctx.stroke();
}

function dot(ctx, vp, x, y, r) {
  ctx.beginPath();
  ctx.arc(vp.toX(x), vp.toY(y), vp.px(r), 0, Math.PI * 2);
  ctx.fillStyle = COLORS.line;
  ctx.fill();
}

// Kotak yang menempel di garis gawang, depth bisa negatif (ke arah kiri).
function box(ctx, vp, goalLineX, depth, width) {
  const x = Math.min(goalLineX, goalLineX + depth);
  const y = (PITCH.width - width) / 2;
  ctx.strokeRect(vp.toX(x), vp.toY(y), vp.px(Math.abs(depth)), vp.px(width));
}

// Bentuk kaos dilihat dari belakang: badan, bahu, dan lengan pendek.
function jerseyPath(ctx, cx, cy, w) {
  const h = w * 1.05;
  const top = cy - h / 2;
  const bottom = cy + h / 2;
  const body = w * 0.32;
  const neck = w * 0.16;
  const sleeve = w * 0.5;
  const sleeveDrop = h * 0.32;

  ctx.beginPath();
  ctx.moveTo(cx - neck, top);
  ctx.quadraticCurveTo(cx, top + h * 0.1, cx + neck, top);
  ctx.lineTo(cx + sleeve, top + h * 0.12);
  ctx.lineTo(cx + sleeve, top + sleeveDrop);
  ctx.lineTo(cx + body, top + sleeveDrop * 0.85);
  ctx.lineTo(cx + body, bottom);
  ctx.lineTo(cx - body, bottom);
  ctx.lineTo(cx - body, top + sleeveDrop * 0.85);
  ctx.lineTo(cx - sleeve, top + sleeveDrop);
  ctx.lineTo(cx - sleeve, top + h * 0.12);
  ctx.closePath();
}

function drawPlayer(ctx, vp, player, teamColors) {
  const cx = vp.toX(player.x);
  const cy = vp.toY(player.y);
  const w = vp.px(JERSEY_WIDTH_METERS);
  const isKeeper = player.role === 'GK';
  const shirt = isKeeper && teamColors.goalkeeper ? teamColors.goalkeeper : teamColors.shirt;

  // Bayangan tipis supaya jersey tidak menyatu dengan rumput.
  ctx.save();
  ctx.translate(1, 1.5);
  jerseyPath(ctx, cx, cy, w);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.fill();
  ctx.restore();

  jerseyPath(ctx, cx, cy, w);
  ctx.fillStyle = shirt;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.stroke();

  // Nomor punggung.
  ctx.fillStyle = teamColors.number;
  ctx.font = `700 ${Math.round(w * 0.45)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(player.number), cx, cy + w * 0.08);

  // Nama di bawah jersey.
  // Di layar kecil, nama ikut mengecil bersama jersey agar tidak menutupi lapangan.
  const nameSize = Math.max(6, Math.round(w * 0.36));
  ctx.font = `600 ${nameSize}px system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  ctx.lineWidth = 3;
  ctx.strokeStyle = COLORS.nameStroke;
  ctx.lineJoin = 'round';
  const nameY = cy + w * 0.62;
  ctx.strokeText(player.shortName, cx, nameY);
  ctx.fillStyle = COLORS.nameText;
  ctx.fillText(player.shortName, cx, nameY);

  drawConditionCues(ctx, cx, cy, w, nameY + nameSize + 2, player.condition);
}

// Tanda kondisi (tahap 6). Hanya muncul saat relevan supaya lapangan tidak ramai:
//   bar tenaga   : di bawah nama, saat tenaga < LOW_ENERGY_CUE
//   titik merah  : di bahu jersey, saat percaya diri < LOW_CONFIDENCE_CUE
const LOW_ENERGY_CUE = 0.6;
const LOW_CONFIDENCE_CUE = 0.4;
//   titik oranye : di bahu jersey, saat on fire (ambang sama dengan engine)
const ON_FIRE_CUE = CONDITION.fireThreshold;

function drawConditionCues(ctx, cx, cy, w, barY, condition) {
  if (!condition) return; // state lama tanpa kondisi: lewati saja
  if (condition.energy < LOW_ENERGY_CUE) {
    const barW = w * 0.9;
    const barH = Math.max(2, w * 0.1);
    const left = cx - barW / 2;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(left, barY, barW, barH);
    const e = Math.min(1, Math.max(0, condition.energy));
    ctx.fillStyle = e < 0.35 ? '#ff6b5a' : '#ffd166';
    ctx.fillRect(left, barY, barW * e, barH);
  }
  if (condition.confidence >= ON_FIRE_CUE) {
    // On fire: lingkaran oranye dengan inti kuning di bahu jersey.
    const r = Math.max(3, w * 0.2);
    const x = cx + w * 0.55;
    const y = cy - w * 0.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#ff8c1a';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y + r * 0.15, r * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = '#ffe066';
    ctx.fill();
  } else if (condition.confidence < LOW_CONFIDENCE_CUE) {
    const r = Math.max(2.5, w * 0.16);
    ctx.beginPath();
    ctx.arc(cx + w * 0.55, cy - w * 0.5, r, 0, Math.PI * 2);
    ctx.fillStyle = '#ff4d4d';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }
}

function drawBall(ctx, vp, ball) {
  ctx.beginPath();
  ctx.arc(vp.toX(ball.x), vp.toY(ball.y), Math.max(3, vp.px(BALL_RADIUS_METERS)), 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#111111';
  ctx.stroke();
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Interpolasi: posisi di antara dua tick, supaya gerakan halus di 60fps
// walaupun simulasi hanya 10 tick per detik (prinsip arsitektur no. 2).
export function interpolateState(previous, current, alpha) {
  if (!previous || previous.players.length !== current.players.length) return current;
  const t = Math.min(1, Math.max(0, alpha));

  return {
    ...current,
    ball: {
      ...current.ball,
      x: lerp(previous.ball.x, current.ball.x, t),
      y: lerp(previous.ball.y, current.ball.y, t),
    },
    players: current.players.map((player, i) => {
      const before = previous.players[i];
      if (before.id !== player.id) return player;
      return { ...player, x: lerp(before.x, player.x, t), y: lerp(before.y, player.y, t) };
    }),
  };
}

export function renderMatch(ctx, state, cssWidth, cssHeight) {
  if (!ctx) throw new TypeError('renderMatch: context canvas tidak ada');
  if (!state) throw new TypeError('renderMatch: state tidak ada');

  const vp = createViewport(cssWidth, cssHeight);
  drawPitch(ctx, vp, cssWidth, cssHeight);

  // Lingkaran di bawah pemegang bola, supaya penguasaan mudah diikuti mata.
  const holder = state.ball.ownerId ? state.players.find((p) => p.id === state.ball.ownerId) : null;
  if (holder) {
    ctx.beginPath();
    ctx.arc(vp.toX(holder.x), vp.toY(holder.y), vp.px(JERSEY_WIDTH_METERS * 0.85), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 224, 102, 0.28)';
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, vp.px(0.18));
    ctx.strokeStyle = 'rgba(255, 224, 102, 0.9)';
    ctx.stroke();
  }

  for (const player of state.players) {
    const team = state.teams[player.teamId];
    if (!team) throw new Error(`renderMatch: tim "${player.teamId}" tidak ditemukan`);
    drawPlayer(ctx, vp, player, team.colors);
  }

  drawBall(ctx, vp, state.ball);
}

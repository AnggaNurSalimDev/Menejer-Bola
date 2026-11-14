import { useId } from 'react';
import { logoErrors } from '../engine/logo.js';

// Logo klub sebagai SVG (14 Nov). Bentuk dipotong (clipPath), pola diisi warna kedua, teks di tengah.
// Logo tidak valid → lingkaran abu-abu (tidak melempar: dipakai di banyak tempat tampilan).

const SHAPES = {
  perisai: 'M50 4 L92 16 L92 52 C92 76 72 90 50 98 C28 90 8 76 8 52 L8 16 Z',
  bulat: 'M50 4 A46 46 0 1 1 49.99 4 Z',
  kotak: 'M10 6 H90 Q94 6 94 10 V90 Q94 94 90 94 H10 Q6 94 6 90 V10 Q6 6 10 6 Z',
  berlian: 'M50 3 L97 50 L50 97 L3 50 Z',
  bintang: 'M50 4 L61 36 L95 36 L68 56 L78 90 L50 70 L22 90 L32 56 L5 36 L39 36 Z',
};

function Pattern({ pattern, color }) {
  switch (pattern) {
    case 'tengah':
      return <rect x="38" y="0" width="24" height="100" fill={color} />;
    case 'diagonal':
      return <path d="M-10 70 L70 -10 L100 -10 L100 10 L10 100 L-10 100 Z" fill={color} />;
    case 'setengah':
      return <rect x="50" y="0" width="50" height="100" fill={color} />;
    case 'garis':
      return (
        <g fill={color}>
          {[0, 1, 2, 3, 4].map((i) => (
            <rect key={i} x={i * 20 + 5} y="0" width="10" height="100" />
          ))}
        </g>
      );
    case 'cincin':
      return <circle cx="50" cy="52" r="30" fill="none" stroke={color} strokeWidth="9" />;
    default:
      return null;
  }
}

export default function ClubLogo({ logo, size = 32, title }) {
  const uid = useId().replace(/:/g, '');
  const ok = logo && logoErrors(logo).length === 0;
  if (!ok) {
    return (
      <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={title ?? 'logo'}>
        <circle cx="50" cy="50" r="46" fill="#495057" />
      </svg>
    );
  }
  const d = SHAPES[logo.shape];
  const len = logo.text.length;
  const fontSize = len <= 1 ? 46 : len === 2 ? 38 : 30;
  const textY = logo.shape === 'perisai' ? 60 : logo.shape === 'bintang' ? 64 : 62;
  // Teks memakai warna kedua dengan garis tepi warna utama, supaya terbaca di atas pola apa pun.
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={title ?? `logo ${logo.text}`} className="club-logo">
      {title && <title>{title}</title>}
      <defs>
        <clipPath id={`clip-${uid}`}>
          <path d={d} />
        </clipPath>
      </defs>
      <g clipPath={`url(#clip-${uid})`}>
        <rect width="100" height="100" fill={logo.primary} />
        <Pattern pattern={logo.pattern} color={logo.secondary} />
      </g>
      <path d={d} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth="3" />
      {logo.text && (
        <text
          x="50"
          y={textY}
          textAnchor="middle"
          fontFamily="Inter, system-ui, sans-serif"
          fontWeight="900"
          fontSize={fontSize}
          fill={logo.secondary}
          stroke={logo.primary}
          strokeWidth="4"
          paintOrder="stroke"
        >
          {logo.text}
        </text>
      )}
    </svg>
  );
}

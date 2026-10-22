/** Quinn, the Quick Note mascot: full body, standing. `size` is the width. */
export function Quinn({ size = 120 }: { size?: number }) {
  return (
    <svg width={size} height={Math.round(size * 1.25)} viewBox="0 0 120 150" aria-hidden="true">
      <ellipse cx="60" cy="142" rx="34" ry="5" fill="#14161C" fillOpacity="0.12" />
      <line x1="54" y1="96" x2="54" y2="124" stroke="#2C5A1B" strokeWidth="4" strokeLinecap="round" />
      <line x1="66" y1="96" x2="66" y2="124" stroke="#2C5A1B" strokeWidth="4" strokeLinecap="round" />
      <ellipse cx="48" cy="130" rx="13" ry="6.5" fill="#E5484D" stroke="#2C5A1B" strokeWidth="2.5" />
      <ellipse cx="42" cy="131" rx="5.5" ry="4" fill="#FFFFFF" />
      <ellipse cx="72" cy="130" rx="13" ry="6.5" fill="#E5484D" stroke="#2C5A1B" strokeWidth="2.5" />
      <ellipse cx="78" cy="131" rx="5.5" ry="4" fill="#FFFFFF" />
      <ellipse cx="60" cy="90" rx="13" ry="9" fill="#5FA02E" stroke="#2C5A1B" strokeWidth="3" />
      <path d="M47 90 Q33 96 29 108" fill="none" stroke="#2C5A1B" strokeWidth="4" strokeLinecap="round" />
      <circle cx="28" cy="111" r="5.5" fill="#FFFFFF" stroke="#2C5A1B" strokeWidth="2.5" />
      <path d="M73 90 Q87 96 91 108" fill="none" stroke="#2C5A1B" strokeWidth="4" strokeLinecap="round" />
      <circle cx="92" cy="111" r="5.5" fill="#FFFFFF" stroke="#2C5A1B" strokeWidth="2.5" />
      <g transform="translate(0 -14)">
        <QuinnFace />
      </g>
    </svg>
  );
}

/**
 * Quinn running while writing in a notepad. Pure SVG + CSS animation (the
 * `qr-*` classes in globals.css); it stands still for reduced-motion users.
 */
export function QuinnRunning({ size = 150 }: { size?: number }) {
  return (
    <svg
      className="quinn-running"
      width={size}
      height={size}
      viewBox="0 0 150 150"
      aria-hidden="true"
    >
      <ellipse className="qr-shadow" cx="66" cy="142" rx="34" ry="5" fill="#14161C" fillOpacity="0.12" />

      {/* Speed lines: he is running to the right. */}
      <g stroke="#7DC242" strokeWidth="3.5" strokeLinecap="round">
        <line className="qr-speed" x1="4" y1="62" x2="20" y2="62" />
        <line className="qr-speed qr-speed-2" x1="0" y1="84" x2="22" y2="84" />
        <line className="qr-speed qr-speed-3" x1="6" y1="106" x2="20" y2="106" />
      </g>

      <g transform="rotate(5 66 140)">
        <g className="qr-bob">
          {/* Legs pump up and down in turn. */}
          <g className="qr-leg">
            <line x1="60" y1="96" x2="60" y2="124" stroke="#2C5A1B" strokeWidth="4" strokeLinecap="round" />
            <ellipse cx="54" cy="130" rx="13" ry="6.5" fill="#E5484D" stroke="#2C5A1B" strokeWidth="2.5" />
            <ellipse cx="48" cy="131" rx="5.5" ry="4" fill="#FFFFFF" />
          </g>
          <g className="qr-leg qr-leg-2">
            <line x1="72" y1="96" x2="72" y2="124" stroke="#2C5A1B" strokeWidth="4" strokeLinecap="round" />
            <ellipse cx="78" cy="130" rx="13" ry="6.5" fill="#E5484D" stroke="#2C5A1B" strokeWidth="2.5" />
            <ellipse cx="84" cy="131" rx="5.5" ry="4" fill="#FFFFFF" />
          </g>

          <ellipse cx="66" cy="90" rx="13" ry="9" fill="#5FA02E" stroke="#2C5A1B" strokeWidth="3" />

          {/* Right arm holds the notepad. */}
          <path d="M79 90 Q94 96 104 114" fill="none" stroke="#2C5A1B" strokeWidth="4" strokeLinecap="round" />
          <g transform="rotate(-8 92 106)">
            <rect x="74" y="92" width="36" height="30" rx="4" fill="#FFFFFF" stroke="#2C5A1B" strokeWidth="2.5" />
            <rect x="74" y="92" width="36" height="6" rx="3" fill="#CDEFA9" />
            <g stroke="#8CB86B" strokeWidth="2.5" strokeLinecap="round">
              <line className="qr-line qr-line-1" x1="80" y1="104" x2="104" y2="104" />
              <line className="qr-line qr-line-2" x1="80" y1="110" x2="102" y2="110" />
              <line className="qr-line qr-line-3" x1="80" y1="116" x2="94" y2="116" />
            </g>
          </g>
          <circle cx="105" cy="116" r="5.5" fill="#FFFFFF" stroke="#2C5A1B" strokeWidth="2.5" />

          <g transform="translate(6 -14)">
            <QuinnFace />
          </g>

          {/* Left arm reaches across and scribbles with a pencil. */}
          <g className="qr-scribble">
            <path d="M53 90 Q54 108 74 108" fill="none" stroke="#2C5A1B" strokeWidth="4" strokeLinecap="round" />
            <g transform="rotate(-40 80 102)">
              <rect x="77" y="88" width="6" height="16" rx="1.5" fill="#F5C542" stroke="#2C5A1B" strokeWidth="1.8" />
              <path d="M77 104 L80 109 L83 104 Z" fill="#2C5A1B" />
            </g>
            <circle cx="76" cy="108" r="5.5" fill="#FFFFFF" stroke="#2C5A1B" strokeWidth="2.5" />
          </g>
        </g>
      </g>
    </svg>
  );
}

/** Round head crop of Quinn, for avatars and small spots. */
export function QuinnHead({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="60" cy="60" r="60" fill="#DFF2C8" />
      <g transform="translate(12 8.8) scale(0.8)">
        <QuinnFace />
      </g>
    </svg>
  );
}

function QuinnFace() {
  return (
    <>
      <ellipse cx="60" cy="64" rx="40" ry="38" fill="#7DC242" stroke="#2C5A1B" strokeWidth="4" />
      <ellipse cx="46" cy="31" rx="8" ry="3.5" fill="#A8DC6E" />
      <line x1="50" y1="52" x2="70" y2="52" stroke="#2C5A1B" strokeWidth="5" />
      <rect x="6" y="40" width="44" height="36" rx="10" fill="#CDEFA9" stroke="#2C5A1B" strokeWidth="5" />
      <rect x="70" y="40" width="44" height="36" rx="10" fill="#CDEFA9" stroke="#2C5A1B" strokeWidth="5" />
      <ellipse cx="30" cy="59" rx="7" ry="9" fill="#1B1B1F" />
      <circle cx="32.5" cy="55" r="2.6" fill="#FFFFFF" />
      <ellipse cx="90" cy="59" rx="7" ry="9" fill="#1B1B1F" />
      <circle cx="92.5" cy="55" r="2.6" fill="#FFFFFF" />
      <path
        d="M51 88 Q60 102 69 88 Z"
        fill="#3A1830"
        stroke="#2C5A1B"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <ellipse cx="60" cy="92.5" rx="4.5" ry="2.2" fill="#F08FA5" />
    </>
  );
}

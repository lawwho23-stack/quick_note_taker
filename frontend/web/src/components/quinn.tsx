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
 * Quinn running to the right in side view, writing in a notepad as he goes.
 * Pure SVG + CSS animation (the `qr-*` classes in globals.css); he stands
 * still for reduced-motion users.
 */
export function QuinnRunning({ size = 160 }: { size?: number }) {
  return (
    <svg
      className="quinn-running"
      width={size}
      height={Math.round((size * 150) / 160)}
      viewBox="0 0 160 150"
      aria-hidden="true"
    >
      <ellipse className="qr-shadow" cx="80" cy="143" rx="34" ry="5" fill="#14161C" fillOpacity="0.12" />

      {/* Speed lines trail behind him. */}
      <g stroke="#7DC242" strokeWidth="3.5" strokeLinecap="round">
        <line className="qr-speed" x1="6" y1="52" x2="24" y2="52" />
        <line className="qr-speed qr-speed-2" x1="2" y1="76" x2="26" y2="76" />
        <line className="qr-speed qr-speed-3" x1="8" y1="100" x2="24" y2="100" />
      </g>

      <g transform="rotate(8 80 140)">
        <g className="qr-bob">
          {/* Far leg: darker, swings opposite the near leg. */}
          <g className="qr-swing qr-swing-far">
            <line x1="76" y1="98" x2="76" y2="126" stroke="#1F3B14" strokeWidth="4" strokeLinecap="round" />
            <ellipse cx="82" cy="131" rx="12" ry="6" fill="#B8363A" stroke="#1F3B14" strokeWidth="2.5" />
            <ellipse cx="89" cy="132" rx="4.5" ry="3.5" fill="#E9E9EC" />
          </g>

          {/* Far arm holds the notepad up in front. */}
          <path d="M82 90 Q96 92 108 100" fill="none" stroke="#1F3B14" strokeWidth="4" strokeLinecap="round" />
          <g transform="rotate(-14 116 96)">
            <rect x="100" y="80" width="32" height="32" rx="4" fill="#FFFFFF" stroke="#2C5A1B" strokeWidth="2.5" />
            <rect x="100" y="80" width="32" height="6" rx="3" fill="#CDEFA9" />
            <g stroke="#8CB86B" strokeWidth="2.5" strokeLinecap="round">
              <line className="qr-line qr-line-1" x1="105" y1="93" x2="127" y2="93" />
              <line className="qr-line qr-line-2" x1="105" y1="99" x2="125" y2="99" />
              <line className="qr-line qr-line-3" x1="105" y1="105" x2="118" y2="105" />
            </g>
          </g>
          <circle cx="108" cy="102" r="5" fill="#FFFFFF" stroke="#1F3B14" strokeWidth="2.5" />

          <ellipse cx="78" cy="92" rx="12" ry="9" fill="#5FA02E" stroke="#2C5A1B" strokeWidth="3" />

          {/* Near leg. */}
          <g className="qr-swing">
            <line x1="80" y1="98" x2="80" y2="126" stroke="#2C5A1B" strokeWidth="4" strokeLinecap="round" />
            <ellipse cx="86" cy="131" rx="12" ry="6" fill="#E5484D" stroke="#2C5A1B" strokeWidth="2.5" />
            <ellipse cx="93" cy="132" rx="4.5" ry="3.5" fill="#FFFFFF" />
          </g>

          {/* Head in profile, facing right. */}
          <ellipse cx="76" cy="50" rx="38" ry="36" fill="#7DC242" stroke="#2C5A1B" strokeWidth="4" />
          <ellipse cx="66" cy="19" rx="8" ry="3.5" fill="#A8DC6E" />
          <line x1="86" y1="50" x2="54" y2="48" stroke="#2C5A1B" strokeWidth="4" strokeLinecap="round" />
          <circle cx="52" cy="50" r="5" fill="#5FA02E" stroke="#2C5A1B" strokeWidth="3" />
          <rect x="86" y="34" width="30" height="32" rx="9" fill="#CDEFA9" stroke="#2C5A1B" strokeWidth="5" />
          <ellipse cx="104" cy="51" rx="6" ry="8.5" fill="#1B1B1F" />
          <circle cx="106" cy="47" r="2.4" fill="#FFFFFF" />
          <path
            d="M96 72 Q104 84 112 70 Z"
            fill="#3A1830"
            stroke="#2C5A1B"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />

          {/* Near arm scribbles with the pencil. */}
          <g className="qr-scribble">
            <path d="M74 92 Q84 108 102 104" fill="none" stroke="#2C5A1B" strokeWidth="4" strokeLinecap="round" />
            <g transform="rotate(-35 108 96)">
              <rect x="105" y="82" width="6" height="16" rx="1.5" fill="#F5C542" stroke="#2C5A1B" strokeWidth="1.8" />
              <path d="M105 98 L108 103 L111 98 Z" fill="#2C5A1B" />
            </g>
            <circle cx="102" cy="104" r="5.5" fill="#FFFFFF" stroke="#2C5A1B" strokeWidth="2.5" />
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

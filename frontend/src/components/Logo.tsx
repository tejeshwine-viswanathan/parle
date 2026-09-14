const NAVY = '#0A2540';

const wordStyle: React.CSSProperties = {
  color: '#ffffff',
  WebkitTextStroke: `2px ${NAVY}`,
  paintOrder: 'stroke fill',
} as React.CSSProperties;

const barStyle: React.CSSProperties = {
  boxSizing: 'border-box',
  border: `1.5px solid ${NAVY}`,
  borderRadius: 1.5,
  display: 'inline-block',
};

export default function Logo({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center ${className}`} role="img" aria-label="Parlé">
      <svg
        aria-hidden="true"
        width={45}
        height={45}
        viewBox="0 4 58 64"
        style={{ flexShrink: 0, marginRight: -5 }}
      >
        <path
          d="M22 6h22a16 16 0 0 1 16 16v4a16 16 0 0 1 -16 16H24l-12 14V28l0 -6A16 16 0 0 1 22 6Z"
          fill="#0055A4"
          stroke={NAVY}
          strokeWidth={4}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <text
          x={30}
          y={35}
          fontSize={30}
          fontWeight={800}
          fill="#ffffff"
          stroke={NAVY}
          strokeWidth={2}
          style={{ paintOrder: 'stroke fill' }}
          textAnchor="middle"
          fontFamily="system-ui, sans-serif"
        >
          P
        </text>
      </svg>
      <div
        aria-hidden="true"
        className="flex items-baseline"
        style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-0.01em' }}
      >
        <span style={wordStyle}>arl</span>
        <span style={{ ...wordStyle, position: 'relative', display: 'inline-block', lineHeight: 1 }}>
          e
          <span
            style={{
              position: 'absolute',
              left: '50%',
              transform: 'translateX(-50%)',
              bottom: '100%',
              marginBottom: -12,
              display: 'flex',
              alignItems: 'flex-end',
              gap: 2,
            }}
          >
            <span style={{ ...barStyle, width: 5, height: 8, background: '#EF4135' }} />
            <span style={{ ...barStyle, width: 5, height: 12, background: '#ffffff' }} />
            <span style={{ ...barStyle, width: 5, height: 16, background: '#0055A4' }} />
          </span>
        </span>
      </div>
    </div>
  );
}

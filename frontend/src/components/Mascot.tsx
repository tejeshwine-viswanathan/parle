import { useEffect, useState, type CSSProperties } from 'react';

const NAVY = '#0A2540';
const BLACK = '#161616';

type Phase = 'walk' | 'whistle' | 'bite' | 'yawn' | 'sleep';

const WALKS_BEFORE_NAP = 2;

const PHASE_DURATION: Record<Phase, () => number> = {
  walk: () => 9000 + Math.random() * 6000,
  whistle: () => 2800 + Math.random() * 1600,
  bite: () => 1400 + Math.random() * 800,
  yawn: () => 1300 + Math.random() * 600,
  sleep: () => 6000 + Math.random() * 5000,
};

// walk → (whistle | bite) → walk → yawn → sleep → walk …
function pickNext(phase: Phase, walksSinceNap: number): Phase {
  switch (phase) {
    case 'walk':
      if (walksSinceNap >= WALKS_BEFORE_NAP) return 'yawn';
      return Math.random() < 0.5 ? 'whistle' : 'bite';
    case 'yawn':
      return 'sleep';
    default:
      return 'walk';
  }
}

type Props = {
  /** True while the tutor is generating a reply — swaps the mascot to nibbling its baguette. */
  thinking?: boolean;
};

export default function Mascot({ thinking = false }: Props) {
  const [phase, setPhase] = useState<Phase>('walk');

  useEffect(() => {
    if (thinking) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let walksSinceNap = 0;
    const run = (next: Phase) => {
      setPhase(next);
      if (next === 'walk') walksSinceNap += 1;
      if (next === 'sleep') walksSinceNap = 0;
      timer = setTimeout(() => {
        if (!cancelled) run(pickNext(next, walksSinceNap));
      }, PHASE_DURATION[next]());
    };
    run('walk');
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [thinking]);

  const pose = thinking ? 'eat' : phase;
  const isChewing = pose === 'eat' || pose === 'bite';
  const isStill = pose === 'yawn' || pose === 'sleep';
  const isAsleep = pose === 'sleep';
  const eyeMode = isAsleep ? 'closed' : pose === 'yawn' ? 'squint' : 'open';

  const pausedIfStill: CSSProperties = { animationPlayState: isStill ? 'paused' : 'running' };

  return (
    <div
      aria-hidden="true"
      className="relative h-16 shrink-0 overflow-hidden border-t border-slate-100 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-800/30"
    >
      <div
        className="absolute bottom-1 left-0 h-14 w-14 animate-[mascot-patrol_70s_linear_infinite]"
        style={pausedIfStill}
      >
        <svg viewBox="0 0 64 64" className="h-full w-full overflow-visible">
          <defs>
            <linearGradient id="mascot-tricolor" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="#0055A4" />
              <stop offset="0.333" stopColor="#0055A4" />
              <stop offset="0.334" stopColor="#ffffff" />
              <stop offset="0.666" stopColor="#ffffff" />
              <stop offset="0.667" stopColor="#EF4135" />
              <stop offset="1" stopColor="#EF4135" />
            </linearGradient>
          </defs>

          {/* legs (hidden under the blanket while asleep) */}
          {!isAsleep && (
            <>
              <g
                style={{ transformOrigin: '24px 52px', ...pausedIfStill }}
                className="animate-[mascot-step_1.2s_ease-in-out_infinite]"
              >
                <rect x={20} y={50} width={8} height={10} rx={4} fill={NAVY} />
              </g>
              <g
                style={{ transformOrigin: '40px 52px', animationDelay: '0.6s', ...pausedIfStill }}
                className="animate-[mascot-step_1.2s_ease-in-out_infinite]"
              >
                <rect x={36} y={50} width={8} height={10} rx={4} fill={NAVY} />
              </g>
            </>
          )}

          {/* body */}
          <g
            className={
              isAsleep
                ? 'animate-[mascot-sleep-breathe_2.4s_ease-in-out_infinite]'
                : 'animate-[mascot-bob_1.2s_ease-in-out_infinite]'
            }
            style={{ transformOrigin: '32px 40px', ...(isAsleep ? {} : pausedIfStill) }}
          >
            <ellipse cx={32} cy={38} rx={17} ry={19} fill="url(#mascot-tricolor)" stroke={NAVY} strokeWidth={2} />

            {/* arm + baguette (tucked away while asleep) */}
            {!isAsleep && (
              <g
                className={isChewing ? 'animate-[mascot-chew_1.1s_ease-in-out_infinite]' : ''}
                style={{ transformOrigin: '46px 42px' }}
              >
                <circle cx={46} cy={42} r={4} fill={NAVY} />
                <rect
                  x={44}
                  y={16}
                  width={7}
                  height={30}
                  rx={3.5}
                  fill="#E8C78A"
                  stroke="#B9884F"
                  strokeWidth={1}
                  transform="rotate(18 46 42)"
                />
                <line x1={46} y1={22} x2={51} y2={22} stroke="#B9884F" strokeWidth={1} transform="rotate(18 46 42)" />
                <line x1={46} y1={28} x2={51} y2={28} stroke="#B9884F" strokeWidth={1} transform="rotate(18 46 42)" />
                <line x1={46} y1={34} x2={51} y2={34} stroke="#B9884F" strokeWidth={1} transform="rotate(18 46 42)" />
              </g>
            )}

            {/* doe eyes, Bambi lashes */}
            {eyeMode === 'open' ? (
              <>
                <ellipse cx={25} cy={33} rx={5.5} ry={6.5} fill="#ffffff" stroke={NAVY} strokeWidth={1} />
                <ellipse cx={38} cy={33} rx={5.5} ry={6.5} fill="#ffffff" stroke={NAVY} strokeWidth={1} />
                <circle cx={26} cy={34.5} r={2.6} fill="#3B2314" />
                <circle cx={39} cy={34.5} r={2.6} fill="#3B2314" />
                <circle cx={27} cy={33} r={0.8} fill="#ffffff" />
                <circle cx={40} cy={33} r={0.8} fill="#ffffff" />
                {/* left eye lash fan */}
                <line x1={21} y1={28} x2={17.5} y2={25} stroke={NAVY} strokeWidth={1} strokeLinecap="round" />
                <line x1={23} y1={26.3} x2={20.5} y2={22.7} stroke={NAVY} strokeWidth={1} strokeLinecap="round" />
                <line x1={26} y1={25.8} x2={25} y2={21.8} stroke={NAVY} strokeWidth={1} strokeLinecap="round" />
                {/* right eye lash fan */}
                <line x1={42} y1={28} x2={45.5} y2={25} stroke={NAVY} strokeWidth={1} strokeLinecap="round" />
                <line x1={40} y1={26.3} x2={42.5} y2={22.7} stroke={NAVY} strokeWidth={1} strokeLinecap="round" />
                <line x1={37} y1={25.8} x2={38} y2={21.8} stroke={NAVY} strokeWidth={1} strokeLinecap="round" />
              </>
            ) : eyeMode === 'squint' ? (
              <>
                <line x1={20} y1={33} x2={30} y2={33} stroke={NAVY} strokeWidth={1.6} strokeLinecap="round" />
                <line x1={33} y1={33} x2={43} y2={33} stroke={NAVY} strokeWidth={1.6} strokeLinecap="round" />
              </>
            ) : (
              <>
                <path d="M20 33 q5 4 10 0" stroke={NAVY} strokeWidth={1.6} fill="none" strokeLinecap="round" />
                <path d="M33 33 q5 4 10 0" stroke={NAVY} strokeWidth={1.6} fill="none" strokeLinecap="round" />
              </>
            )}

            {/* mouth */}
            {pose === 'eat' || pose === 'bite' ? (
              <ellipse
                cx={32}
                cy={43}
                rx={2.2}
                ry={1.6}
                fill="#7A2E22"
                className="animate-[mascot-mouth-chew_1.1s_ease-in-out_infinite]"
                style={{ transformOrigin: '32px 43px' }}
              />
            ) : pose === 'whistle' ? (
              <circle cx={32} cy={43} r={1.8} fill="#7A2E22" />
            ) : pose === 'yawn' ? (
              <ellipse
                cx={32}
                cy={44}
                rx={3.2}
                ry={3.4}
                fill="#7A2E22"
                className="animate-[mascot-yawn-mouth_1.3s_ease-in-out_infinite]"
                style={{ transformOrigin: '32px 44px' }}
              />
            ) : pose === 'sleep' ? (
              <circle cx={32} cy={43} r={1.4} fill="#7A2E22" />
            ) : (
              <path d="M27 42 q5 5 10 0" stroke={NAVY} strokeWidth={1.4} fill="none" strokeLinecap="round" />
            )}

            {/* blanket, tucked up while asleep */}
            {isAsleep && (
              <path
                d="M14 47 q18 15 36 0 v11 q-18 11 -36 0 z"
                fill="#D64555"
                stroke={NAVY}
                strokeWidth={1.5}
              />
            )}
            {isAsleep && <line x1={17} y1={51.5} x2={47} y2={51.5} stroke="#ffffff" strokeWidth={1.5} opacity={0.85} />}

            {/* beret */}
            <ellipse cx={30} cy={19} rx={13} ry={5.5} fill={BLACK} stroke={NAVY} strokeWidth={1.5} />
            <circle cx={34} cy={13.5} r={2} fill={BLACK} stroke={NAVY} strokeWidth={1.2} />
          </g>

          {/* whistling notes */}
          {pose === 'whistle' && (
            <>
              <text x={14} y={20} fontSize={9} fill="#0055A4" className="animate-[mascot-note_1.6s_ease-out_infinite]">
                ♪
              </text>
              <text
                x={20}
                y={14}
                fontSize={7}
                fill="#EF4135"
                className="animate-[mascot-note_1.6s_ease-out_infinite]"
                style={{ animationDelay: '0.5s' }}
              >
                ♪
              </text>
            </>
          )}

          {/* snoring Zzz */}
          {isAsleep && (
            <>
              <text
                x={44}
                y={22}
                fontSize={10}
                fontWeight={700}
                fill={NAVY}
                className="animate-[mascot-zzz_2.4s_ease-out_infinite]"
              >
                z
              </text>
              <text
                x={49}
                y={15}
                fontSize={7}
                fontWeight={700}
                fill={NAVY}
                className="animate-[mascot-zzz_2.4s_ease-out_infinite]"
                style={{ animationDelay: '0.9s' }}
              >
                z
              </text>
            </>
          )}
        </svg>
      </div>
    </div>
  );
}

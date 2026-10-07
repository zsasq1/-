import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { C, Card, Heading, Rich, useEnter } from "./theme";
import { LEAD, Scene } from "./timeline";

// Пункты появляются по ходу речи: момент появления пропорционален доле текста до пункта
export const useReveal = (texts: string[], speech: number) => {
  const { fps } = useVideoConfig();
  const total = texts.reduce((a, t) => a + t.length, 0) || 1;
  let acc = 0;
  return texts.map((t) => {
    const at = LEAD + (acc / total) * speech * 0.85;
    acc += t.length;
    return Math.max(12, Math.round(at * fps));
  });
};

type P = { scene: Scene; speech: number };

const Bullet: React.FC<{ delay: number; text: string; size: number }> = ({ delay, text, size }) => (
  <li style={{ ...useEnter(delay), display: "flex", gap: 22, alignItems: "flex-start", fontSize: size, lineHeight: 1.32 }}>
    <span
      style={{
        flex: "none", width: 14, height: 14, borderRadius: 7, marginTop: size * 0.45,
        background: C.red, boxShadow: `0 0 18px ${C.red}`,
      }}
    />
    <span><Rich text={text} /></span>
  </li>
);

export const Bullets: React.FC<P> = ({ scene, speech }) => {
  const items = scene.bullets ?? [];
  const delays = useReveal(items, speech);
  const long = items.join("").length > 330 || items.length > 5;
  return (
    <>
      <Heading>{scene.heading}</Heading>
      <ul style={{ listStyle: "none", padding: 0, margin: "56px 0 0", display: "flex", flexDirection: "column", gap: long ? 22 : 30 }}>
        {items.map((t, i) => <Bullet key={i} delay={delays[i]} text={t} size={long ? 36 : 42} />)}
      </ul>
    </>
  );
};

export const TwoCol: React.FC<P> = ({ scene, speech }) => {
  const cols = scene.columns ?? [];
  const flat = cols.flatMap((c) => [c.title, ...c.items]);
  const delays = useReveal(flat, speech);
  let k = 0;
  const dense = flat.join("").length > 300;
  return (
    <>
      <Heading>{scene.heading}</Heading>
      <div style={{ display: "flex", gap: 40, marginTop: 52, alignItems: "stretch" }}>
        {cols.map((c, ci) => {
          const titleDelay = delays[k++];
          return (
            <Card key={ci} style={{ ...useEnter(titleDelay), flex: 1 }}>
              <div style={{ fontSize: 40, fontWeight: 800, color: ci === 0 ? C.gold : C.red, marginBottom: 22 }}>{c.title}</div>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: dense ? 16 : 22 }}>
                {c.items.map((t, i) => <Bullet key={i} delay={delays[k++]} text={t} size={dense ? 32 : 36} />)}
              </ul>
            </Card>
          );
        })}
      </div>
    </>
  );
};

export const Grid: React.FC<P> = ({ scene, speech }) => {
  const items = scene.bullets ?? [];
  const delays = useReveal(items, speech);
  const cols = items.length <= 4 ? 2 : items.length <= 6 ? 3 : 4;
  return (
    <>
      <Heading>{scene.heading}</Heading>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 28, marginTop: 52 }}>
        {items.map((t, i) => {
          const [head, ...rest] = t.split(" — ");
          return (
            <Card key={i} style={{ ...useEnter(delays[i]), minHeight: cols === 4 ? 250 : 200 }}>
              <div style={{ fontSize: 30, fontWeight: 800, color: C.red, marginBottom: 12 }}>{String(i + 1).padStart(2, "0")}</div>
              <div style={{ fontSize: cols === 4 ? 34 : 40, fontWeight: 800, color: C.gold, lineHeight: 1.15 }}>{head}</div>
              {rest.length > 0 && <div style={{ fontSize: cols === 4 ? 27 : 32, color: C.muted, marginTop: 12, lineHeight: 1.3 }}>{rest.join(" — ")}</div>}
            </Card>
          );
        })}
      </div>
    </>
  );
};

export const Steps: React.FC<P> = ({ scene, speech }) => {
  const items = scene.bullets ?? [];
  const delays = useReveal([scene.note ?? "", ...items], speech);
  return (
    <>
      <Heading>{scene.heading}</Heading>
      {scene.note && (
        <div style={{ ...useEnter(delays[0]), marginTop: 36, fontSize: 38, color: C.muted }}>
          <span style={{ color: C.red, fontWeight: 800 }}>▸ </span>{scene.note}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "stretch", gap: 0, marginTop: 64 }}>
        {items.map((t, i) => (
          <React.Fragment key={i}>
            <Card style={{ ...useEnter(delays[i + 1]), flex: 1, display: "flex", flexDirection: "column", gap: 18 }}>
              <div style={{
                width: 72, height: 72, borderRadius: 36, background: C.gold, color: C.bg0,
                fontSize: 40, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center",
              }}>{i + 1}</div>
              <div style={{ fontSize: 34, lineHeight: 1.28 }}>{t}</div>
            </Card>
            {i < items.length - 1 && (
              <div style={{ ...useEnter(delays[i + 2]), alignSelf: "center", fontSize: 54, color: C.red, padding: "0 14px" }}>→</div>
            )}
          </React.Fragment>
        ))}
      </div>
    </>
  );
};

// Схема смешанного тромба: головка (белый) — тело (слоистое) — хвост (красный)
export const Thrombus: React.FC<P> = ({ scene, speech }) => {
  const frame = useCurrentFrame();
  const items = scene.bullets ?? [];
  const delays = useReveal(items, speech);
  const grow = (d: number) => interpolate(frame, [d, d + 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const [gHead, gBody, gTail] = [grow(delays[1]), grow(delays[2]), grow(delays[3])];
  return (
    <>
      <Heading>{scene.heading}</Heading>
      <svg viewBox="0 0 1600 300" style={{ width: "100%", marginTop: 40 }}>
        <defs>
          <pattern id="layers" width="26" height="26" patternUnits="userSpaceOnUse">
            <rect width="13" height="26" fill="#f1dede" />
            <rect x="13" width="13" height="26" fill="#b32d3d" />
          </pattern>
        </defs>
        <rect x="0" y="40" width="1600" height="16" rx="8" fill="#7d2a35" />
        <rect x="0" y="244" width="1600" height="16" rx="8" fill="#7d2a35" />
        <text x="1580" y="30" fill={C.muted} fontSize="26" textAnchor="end">стенка сосуда · ток крови →</text>
        <g opacity={gHead}>
          <path d="M150 56 C 70 66, 70 205, 160 214 C 260 228, 362 196, 362 150 C 362 102, 300 56, 150 56 Z" fill="#f4eee8" />
          <text x="230" y="290" fill={C.gold} fontSize="32" fontWeight="800" textAnchor="middle">головка</text>
        </g>
        <g opacity={gBody}>
          <path d="M355 90 L 900 110 L 900 190 L 355 210 Z" fill="url(#layers)" />
          <text x="630" y="290" fill={C.gold} fontSize="32" fontWeight="800" textAnchor="middle">тело</text>
        </g>
        <g opacity={gTail}>
          <path d="M895 110 C 1100 120, 1300 135, 1480 150 C 1300 165, 1100 180, 895 190 Z" fill="#c0283b" />
          <text x="1180" y="290" fill={C.gold} fontSize="32" fontWeight="800" textAnchor="middle">хвост</text>
        </g>
      </svg>
      <ul style={{ listStyle: "none", padding: 0, margin: "36px 0 0", display: "flex", flexDirection: "column", gap: 18 }}>
        {items.map((t, i) => <Bullet key={i} delay={delays[i]} text={t} size={34} />)}
      </ul>
    </>
  );
};

const DIC = [
  { t: "Гиперкоагуляция и тромбообразование", d: "до 8–10 мин · шок" },
  { t: "Коагулопатия потребления", d: "↓ тромбоциты и фибриноген · фибрин в фагоцитах" },
  { t: "Глубокая гипокоагуляция, фибринолиз", d: "через 2–8 ч · несвёртываемость, кровотечения" },
  { t: "Восстановительная", d: "остаточные проявления · летальность до 50%" },
];

export const Dic: React.FC<P> = ({ scene, speech }) => {
  const active = scene.active ?? [];
  const delays = useReveal(DIC.filter((_, i) => active.includes(i + 1)).map((s) => s.t + s.d), speech);
  let k = 0;
  return (
    <>
      <Heading>{scene.heading}</Heading>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 24, marginTop: 70 }}>
        {DIC.map((s, i) => {
          const on = active.includes(i + 1);
          const enter = useEnter(on ? delays[k++] : 0);
          return (
            <Card
              key={i}
              style={{
                ...enter,
                minHeight: 470,
                opacity: (enter.opacity as number) * (on ? 1 : 0.32),
                border: on ? `2px solid ${C.gold}` : `1px solid ${C.cardBorder}`,
                background: on ? "rgba(244,199,112,0.08)" : C.card,
              }}
            >
              <div style={{ fontSize: 96, fontWeight: 900, color: on ? C.gold : C.muted, lineHeight: 1 }}>{i + 1}</div>
              <div style={{ fontSize: 34, fontWeight: 800, marginTop: 24, lineHeight: 1.18, hyphens: "auto" }} lang="ru">{s.t}</div>
              <div style={{ fontSize: 29, color: C.muted, marginTop: 20, lineHeight: 1.35 }}>{s.d}</div>
            </Card>
          );
        })}
      </div>
    </>
  );
};

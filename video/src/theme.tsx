import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export const C = {
  bg0: "#050b1c",
  bg1: "#0d1d42",
  text: "#eef2fb",
  muted: "#9fb0d3",
  gold: "#f4c770",
  red: "#e5566a",
  card: "rgba(255,255,255,0.055)",
  cardBorder: "rgba(255,255,255,0.11)",
};

export const FONT = 'Inter, "DejaVu Sans", Arial, sans-serif';

// Плавное появление снизу: delay в кадрах
export const useEnter = (delay: number) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: { damping: 200 }, durationInFrames: 18 });
  return {
    opacity: p,
    transform: `translateY(${interpolate(p, [0, 1], [28, 0])}px)`,
  } as React.CSSProperties;
};

// «Термин — пояснение»: термин выделяется; латинские слова — курсивом
export const Rich: React.FC<{ text: string; accent?: string }> = ({ text, accent = C.gold }) => {
  const dash = text.indexOf(" — ");
  const head = dash > 0 && dash < 60 ? text.slice(0, dash) : null;
  const rest = head ? text.slice(dash) : text;
  return (
    <>
      {head && <span style={{ color: accent, fontWeight: 700 }}>{latin(head)}</span>}
      {latin(rest)}
    </>
  );
};

const latin = (s: string) =>
  s.split(/((?:\b[a-z]{2,}\b[\s]*)+)/g).map((part, i) =>
    /^[a-z\s]+$/.test(part) && /[a-z]/.test(part) ? (
      <em key={i} style={{ fontFamily: '"DejaVu Serif", Georgia, serif', color: "#ffdca0" }}>{part}</em>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    ),
  );

export const Heading: React.FC<{ children: React.ReactNode; size?: number }> = ({ children, size = 66 }) => (
  <h1
    style={{
      ...useEnter(0),
      margin: 0,
      fontSize: size,
      lineHeight: 1.12,
      fontWeight: 800,
      letterSpacing: -1,
      color: C.text,
    }}
  >
    {children}
  </h1>
);

export const Card: React.FC<{ style?: React.CSSProperties; children: React.ReactNode }> = ({ style, children }) => (
  <div
    style={{
      background: C.card,
      border: `1px solid ${C.cardBorder}`,
      borderRadius: 24,
      padding: "28px 34px",
      ...style,
    }}
  >
    {children}
  </div>
);

import React from "react";
import { AbsoluteFill, Html5Audio, interpolate, Sequence, Series, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Bullets, Dic, Grid, Steps, Thrombus, TwoCol } from "./Layouts";
import { C, FONT, Heading, useEnter } from "./theme";
import { buildTimeline, FPS, Item, LEAD, Scene, scenes, sections } from "./timeline";

// Медленно плывущие «клетки» на фоне
const Backdrop: React.FC = () => {
  const frame = useCurrentFrame();
  const blobs = [
    { x: 12, y: 18, r: 340, c: "rgba(229,86,106,0.16)", s: 0.7 },
    { x: 86, y: 78, r: 420, c: "rgba(70,110,230,0.20)", s: 0.5 },
    { x: 72, y: 12, r: 220, c: "rgba(244,199,112,0.08)", s: 0.9 },
    { x: 30, y: 92, r: 260, c: "rgba(229,86,106,0.10)", s: 0.6 },
  ];
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at 30% 20%, ${C.bg1}, ${C.bg0} 70%)`, overflow: "hidden" }}>
      {blobs.map((b, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `calc(${b.x}% + ${Math.sin((frame / FPS) * 0.15 * b.s + i) * 60}px)`,
            top: `calc(${b.y}% + ${Math.cos((frame / FPS) * 0.12 * b.s + i) * 50}px)`,
            width: b.r * 2, height: b.r * 2, marginLeft: -b.r, marginTop: -b.r,
            borderRadius: "50%", background: `radial-gradient(circle, ${b.c}, transparent 70%)`,
          }}
        />
      ))}
    </AbsoluteFill>
  );
};

const SectionCard: React.FC<{ n: number; title: string }> = ({ n, title }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const out = interpolate(frame, [durationInFrames - 12, durationInFrames], [1, 0], { extrapolateLeft: "clamp" });
  const line = interpolate(frame, [6, 30], [0, 420], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ justifyContent: "center", padding: "0 160px", opacity: out }}>
      <div style={{ ...useEnter(0), fontSize: 40, fontWeight: 700, color: C.red, letterSpacing: 6 }}>
        ЧАСТЬ {String(n).padStart(2, "0")} / {String(sections.length).padStart(2, "0")}
      </div>
      <div style={{ height: 6, width: line, background: C.gold, borderRadius: 3, margin: "28px 0 36px" }} />
      <div style={{ ...useEnter(6), fontSize: 120, fontWeight: 900, color: C.text, letterSpacing: -3, lineHeight: 1.05 }}>{title}</div>
    </AbsoluteFill>
  );
};

const TitleScene: React.FC<{ scene: Scene }> = ({ scene }) => (
  <AbsoluteFill style={{ justifyContent: "center", padding: "0 160px" }}>
    <div style={{ ...useEnter(0), fontSize: 36, color: C.gold, fontWeight: 700, letterSpacing: 4, textTransform: "uppercase" }}>
      {scene.bullets?.[0]}
    </div>
    <div style={{ marginTop: 36 }}>
      <Heading size={92}>
        {scene.heading.split(". ").map((t, i, a) => (
          <span key={i} style={{ color: i % 2 ? C.text : "#ffffff" }}>{t}{i < a.length - 1 ? ". " : ""}</span>
        ))}
      </Heading>
    </div>
    <div style={{ ...useEnter(20), fontSize: 38, color: C.muted, marginTop: 56 }}>{scene.bullets?.[1]}</div>
  </AbsoluteFill>
);

const EndScene: React.FC<{ scene: Scene }> = ({ scene }) => (
  <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
    <Heading size={130}>{scene.heading}</Heading>
  </AbsoluteFill>
);

const ContentScene: React.FC<{ item: Extract<Item, { kind: "scene" }> }> = ({ item }) => {
  const { scene, speech } = item;
  const section = sections.find((s) => s.n === scene.section);
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const fade = interpolate(frame, [0, 8, durationInFrames - 8, durationInFrames], [0, 1, 1, 0]);
  const props = { scene, speech };
  const body =
    scene.layout === "two-col" ? <TwoCol {...props} /> :
    scene.layout === "grid" ? <Grid {...props} /> :
    scene.layout === "steps" ? <Steps {...props} /> :
    scene.layout === "thrombus" ? <Thrombus {...props} /> :
    scene.layout === "dic" ? <Dic {...props} /> :
    <Bullets {...props} />;
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <div style={{ position: "absolute", top: 54, left: 120, right: 120, display: "flex", justifyContent: "space-between", fontSize: 26, color: C.muted, letterSpacing: 2 }}>
        <span><b style={{ color: C.red }}>{String(scene.section).padStart(2, "0")}</b> · {section?.title.toUpperCase()}</span>
        <span>{item.id} / {String(scenes.length).padStart(2, "0")}</span>
      </div>
      <div style={{ position: "absolute", top: 150, left: 120, right: 120, bottom: 100 }}>{body}</div>
      <div style={{ position: "absolute", bottom: 46, right: 120, fontSize: 22, color: "rgba(159,176,211,0.6)" }}>
        слайд{scene.src.length > 1 ? "ы" : ""} {scene.src.join(", ")}
      </div>
    </AbsoluteFill>
  );
};

const Progress: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <div style={{ position: "absolute", left: 0, bottom: 0, height: 6, width: `${(frame / durationInFrames) * 100}%`, background: `linear-gradient(90deg, ${C.red}, ${C.gold})` }} />
  );
};

export const Lecture: React.FC = () => {
  const items = buildTimeline();
  return (
    <AbsoluteFill style={{ fontFamily: FONT, color: C.text }}>
      <Backdrop />
      <Series>
        {items.map((item, i) => (
          <Series.Sequence key={i} durationInFrames={item.frames}>
            {item.kind === "section" ? (
              <SectionCard n={item.n} title={item.title} />
            ) : (
              <>
                {item.scene.layout === "title" ? <TitleScene scene={item.scene} /> :
                 item.scene.layout === "end" ? <EndScene scene={item.scene} /> :
                 <ContentScene item={item} />}
                {item.hasVoice && (
                  <Sequence from={Math.round(LEAD * FPS)}>
                    <Html5Audio src={staticFile(`voice-processed/${item.id}.wav`)} />
                  </Sequence>
                )}
              </>
            )}
          </Series.Sequence>
        ))}
      </Series>
      <Progress />
    </AbsoluteFill>
  );
};

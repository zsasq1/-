import lecture from "./lecture.json";
import voice from "./voice.json";

export const FPS = 30;
export const LEAD = 0.5; // пауза перед голосом, с
export const TAIL = 0.9; // пауза после голоса, с
const SECTION_CARD = 3; // заставка раздела, с
const WORDS_PER_SEC = 2.2; // оценка темпа речи, пока нет записи

export type Column = { title: string; items: string[] };
export type Scene = {
  section: number;
  layout: "title" | "end" | "bullets" | "two-col" | "grid" | "steps" | "thrombus" | "dic";
  src: number[];
  heading: string;
  bullets?: string[];
  columns?: Column[];
  note?: string;
  active?: number[];
  narration: string;
};

export type Item =
  | { kind: "section"; n: number; title: string; frames: number }
  | { kind: "scene"; id: string; index: number; scene: Scene; frames: number; speech: number; hasVoice: boolean };

const voiceMap = voice as Record<string, number>;
export const sections = lecture.sections;
export const scenes = lecture.scenes as Scene[];

export const buildTimeline = (): Item[] => {
  const items: Item[] = [];
  let current = -1;
  scenes.forEach((scene, i) => {
    if (scene.section !== current && scene.section > 0) {
      const s = sections.find((x) => x.n === scene.section)!;
      items.push({ kind: "section", n: s.n, title: s.title, frames: SECTION_CARD * FPS });
    }
    current = scene.section;
    const id = String(i + 1).padStart(2, "0");
    const recorded = voiceMap[id];
    const speech = recorded ?? scene.narration.split(/\s+/).length / WORDS_PER_SEC;
    items.push({
      kind: "scene", id, index: i, scene, speech, hasVoice: recorded !== undefined,
      frames: Math.ceil((LEAD + speech + TAIL) * FPS),
    });
  });
  return items;
};

export const totalFrames = (items: Item[]) => items.reduce((a, b) => a + b.frames, 0);

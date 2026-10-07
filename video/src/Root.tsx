import { Composition } from "remotion";
import { Lecture } from "./Lecture";
import { buildTimeline, FPS, totalFrames } from "./timeline";

export const Root = () => (
  <Composition
    id="Lecture"
    component={Lecture}
    durationInFrames={totalFrames(buildTimeline())}
    fps={FPS}
    width={1920}
    height={1080}
  />
);

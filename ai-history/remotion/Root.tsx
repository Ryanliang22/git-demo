import { AbsoluteFill, Composition, Series } from "remotion";
import type { RenderInput } from "@ai-history/schemas";
import { Preview, probeLayout, ShotFrame, type PreviewInput } from "@ai-history/components";

// The pipeline passes skeleton + timeline + captions + strings + bible as input props.
type Input = { input?: RenderInput; probe?: unknown };

const Shot: React.FC<Input> = ({ input }) => (input?.shotId ? <ShotFrame input={input} shotId={input.shotId} /> : <AbsoluteFill />);

const Episode: React.FC<Input> = ({ input }) => {
  if (!input) return <AbsoluteFill />;
  return (
    <Series>
      {input.timeline.selection.map((id) => {
        const [a, b] = input.timeline.shots[id];
        return (
          <Series.Sequence key={id} durationInFrames={b - a}>
            <ShotFrame input={input} shotId={id} />
          </Series.Sequence>
        );
      })}
    </Series>
  );
};

const canvas = (input?: RenderInput) => ({
  width: input?.bible.canvas.width ?? 1080,
  height: input?.bible.canvas.height ?? 1920,
  fps: input?.bible.canvas.fps ?? 30,
});

export const Root: React.FC = () => (
  <>
    <Composition
      id="Shot"
      component={Shot}
      defaultProps={{} as Input}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={1}
      calculateMetadata={({ props }) => {
        const input = (props as Input).input;
        const range = input?.shotId ? input.timeline.shots[input.shotId] : undefined;
        return { ...canvas(input), durationInFrames: range ? range[1] - range[0] : 1 };
      }}
    />
    <Composition
      id="Episode"
      component={Episode}
      defaultProps={{} as Input}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={1}
      calculateMetadata={({ props }) => {
        const input = (props as Input).input;
        return { ...canvas(input), durationInFrames: input?.timeline.totalFrames ?? 1 };
      }}
    />
    <Composition
      id="LayoutProbe"
      component={AbsoluteFill}
      defaultProps={{} as Input}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={1}
      calculateMetadata={async ({ props }) => {
        const input = (props as Input).input;
        return { props: { ...props, probe: input ? await probeLayout(input) : [] } };
      }}
    />
    <Composition
      id="Preview"
      component={Preview}
      defaultProps={{} as { preview?: PreviewInput }}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={1}
      calculateMetadata={({ props }) => {
        const preview = (props as { preview?: PreviewInput }).preview;
        return { ...canvas(preview ? ({ bible: preview.bible } as RenderInput) : undefined), durationInFrames: preview?.duration ?? 1 };
      }}
    />
  </>
);

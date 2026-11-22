import { useEffect, useRef, useState } from "react";
import { backdrop } from "./backdrop";
import { DECOR, DESK, DOGS, LOUNGE_SEATS } from "./decor";
import { FLOOR, type FloorModel } from "./model";
import { loadSkin, placeholderSkin, type CharacterSheet, type Clip, type FloorSkin, type Prop } from "./skin";

/** Folder under `public/skins/` that is used when present. */
const INSTALLED_SKIN = "office";

/**
 * Everything drawn from the skin's art: set dressing, characters at their
 * desks, off-duty peritos in the lounge, and the pets. It is a canvas lying
 * under the SVG floor, so desks hide the legs of whoever stands behind them.
 */
export function SpriteLayer({ model }: { model: FloorModel }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const latest = useRef(model);
  latest.current = model;
  const [skin, setSkin] = useState<FloorSkin | null>(null);

  useEffect(() => {
    let alive = true;
    loadSkin(INSTALLED_SKIN).then((installed) => {
      if (alive) setSkin(installed ?? placeholderSkin());
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const element = canvas.current;
    if (!element || !skin) return;
    const ctx = element.getContext("2d")!;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scale = skin.scale;
    const shell = element.closest<HTMLElement>(".lp");
    let frame = 0;

    /** Draw a prop with its bottom centre at (x, y), optionally mirrored. */
    const prop = (item: Prop | undefined, x: number, y: number, mirror = false) => {
      if (!item) return;
      const width = item.width * scale;
      const height = item.height * scale;
      ctx.save();
      ctx.translate(Math.round(x), Math.round(y - height));
      if (mirror) ctx.scale(-1, 1);
      ctx.drawImage(item.image, item.x, item.y, item.width, item.height, -width / 2, 0, width, height);
      ctx.restore();
    };

    /** Draw the current frame of a clip with the figure's feet at (x, y). */
    const figure = (sheet: CharacterSheet, clip: Clip, seconds: number, x: number, y: number) => {
      const step = still ? 0 : Math.floor(seconds / clip.secondsPerFrame) % clip.frames.length;
      const width = sheet.frameWidth * scale;
      const height = sheet.frameHeight * scale;
      ctx.drawImage(
        sheet.image,
        clip.frames[step]! * sheet.frameWidth,
        clip.row * sheet.frameHeight,
        sheet.frameWidth,
        sheet.frameHeight,
        Math.round(x - width / 2),
        Math.round(y - height),
        width,
        height,
      );
    };

    const draw = (time: number) => {
      const seconds = time / 1000;
      ctx.clearRect(0, 0, FLOOR.width, FLOOR.height);
      ctx.imageSmoothingEnabled = false;
      // A skin with a furnished office gets the room painted behind it.
      const furnished = !!skin.props.desk;
      const dark = shell?.dataset.theme === "dark";
      if (furnished) ctx.drawImage(backdrop(skin, dark), 0, 0);

      for (const item of DECOR) prop(skin.props[item.prop], item.x, item.y);

      // A skin with desk art draws the whole desk; otherwise the SVG outline is the desk.
      const pixelDesks = !!skin.props.desk;
      let lounging = 0;
      latest.current.actors.forEach((actor, index) => {
        const sheet = skin.characters[index % skin.characters.length]!;
        const clip = sheet.clips[actor.pose];
        const { x, y } = actor.seat;
        if (pixelDesks) {
          prop(skin.props.partitionLeft, x + DESK.partitionLeft.x, y + DESK.partitionLeft.y);
          prop(skin.props.partitionRight, x + DESK.partitionRight.x, y + DESK.partitionRight.y);
          if (clip) figure(sheet, clip, seconds, x + DESK.figure.x, y + DESK.figure.y);
          prop(skin.props.desk, x + DESK.desk.x, y + DESK.desk.y);
          prop(skin.props.computer, x + DESK.computer.x, y + DESK.computer.y);
        } else if (clip) {
          // Behind the SVG desk: a seated figure rests on its far edge.
          figure(sheet, clip, seconds, x, y - 22);
        }
        if (clip) return;
        if (skin.props.sofaWarm && sheet.clips.idle && lounging < LOUNGE_SEATS.length) {
          // Off duty: on a sofa in the lounge, if the skin has one.
          const seat = LOUNGE_SEATS[lounging++]!;
          figure(sheet, sheet.clips.idle, seconds + index, seat.x, seat.y);
        }
      });

      // Each dog walks out, rests, walks back, rests.
      ctx.font = '600 13px ui-monospace, "SF Mono", Menlo, monospace';
      ctx.textAlign = "center";
      // Over the planks the label needs fixed colours; otherwise it follows the theme's text.
      ctx.fillStyle = furnished ? (dark ? "#e7e7ea" : "#2b2b2d") : getComputedStyle(element).color;
      for (const dog of DOGS) {
        const sheet = skin.pets[dog.kind];
        if (!sheet) continue;
        const walk = (dog.secondsPerLap - 2 * dog.restSeconds) / 2;
        const t = still ? walk : seconds % dog.secondsPerLap;
        const outbound = t < walk + dog.restSeconds;
        const sinceTurn = outbound ? t : t - walk - dog.restSeconds;
        const moving = sinceTurn < walk;
        const progress = outbound ? Math.min(1, t / walk) : 1 - Math.min(1, sinceTurn / walk);
        const frames = moving ? sheet.walk : sheet.rest;
        const frameIndex = frames[Math.floor(seconds / sheet.secondsPerFrame) % frames.length]!;
        const width = sheet.frameWidth * scale;
        const height = sheet.frameHeight * scale;
        const x = Math.round(dog.from + (dog.to - dog.from) * progress);
        ctx.save();
        ctx.translate(x, dog.y - height);
        // The drawing faces left, so it is mirrored while heading right.
        if (outbound) ctx.scale(-1, 1);
        ctx.drawImage(sheet.image, frameIndex * sheet.frameWidth, 0, sheet.frameWidth, sheet.frameHeight, -width / 2, 0, width, height);
        ctx.restore();
        ctx.fillText(dog.name, x, dog.y - height - 5);
      }

      if (!still) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    // With motion reduced there is no loop, so redraw when the floor changes.
    const redraw = still ? setInterval(() => draw(0), 500) : undefined;
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(redraw);
    };
  }, [skin]);

  return (
    <canvas
      ref={canvas}
      className="sprite-layer"
      // Lets the stylesheet hide the SVG desk drawings the art replaces.
      data-desks={skin?.props.desk ? "pixel" : "outline"}
      width={FLOOR.width}
      height={FLOOR.height}
      aria-hidden
    />
  );
}

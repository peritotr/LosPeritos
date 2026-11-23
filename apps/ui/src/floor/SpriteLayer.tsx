import { floorEffects, type Treat } from "./effects";
import { useEffect, useRef, useState } from "react";
import { backdrop } from "./backdrop";
import { DECOR, DESK, DOGS, LOUNGE_SEATS } from "./decor";
import { FLOOR, type Actor, type FloorModel, type Point, type Pose } from "./model";
import { WALK_SPEED, pointAlong, routeLength, routeToQueue } from "./routes";
import { loadSkin, placeholderSkin, type CharacterSheet, type Clip, type FloorSkin, type Prop } from "./skin";

/** Folder under `public/skins/` that is used when present. */
const INSTALLED_SKIN = "office";

/** A perito in one of these poses needs you, and comes to your desk to say so. */
const NEEDS_YOU: Pose[] = ["asking", "awaiting_seal"];
/** Going from one of these to rest means a piece of work just ended. */
const AT_WORK: Pose[] = ["working", "asking", "awaiting_seal"];
const CELEBRATION_SECONDS = 1.8;
const CONFETTI = ["#416180", "#c9795f", "#e0a84a", "#3f6b52", "#f5f2ea"];

/** What the layer remembers about one perito between frames. */
interface Walker {
  /** From the desk to the queue; walked forwards to go, backwards to return. */
  route: Point[];
  /** How far along the route the perito is. */
  travelled: number;
  pose: Pose;
  /** Until when (in seconds of animation time) it is celebrating. */
  cheerUntil: number;
}

/** Where the sıra gecesi gathers: the middle of the floor, in a wide ring. */
const SIRA = { x: 600, y: 400, rx: 200, ry: 86 };
/** The dog that sees to faulty work, and how long each part of its errand takes, in seconds. */
const BITER = "Berlin";
const BITE = { out: 1.4, hold: 2.6, back: 1.8 };
/** How long a treat stays above a perito's head. */
const TREAT_SECONDS = 4.5;

/**
 * Everything drawn from the skin's art: the room, set dressing, characters,
 * and the dogs. It is a canvas lying under the SVG floor.
 *
 * Characters are not pinned to their desks: one that has a question or wants
 * your seal walks to your desk and waits there, and one whose work just ended
 * cheers before it leaves.
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
    const furnished = !!skin.props.desk;
    const walkers = new Map<string, Walker>();
    const sealed = new Set<string>();
    /** Bursts of confetti: where, and when they started. */
    const bursts: Array<{ at: Point; start: number }> = [];
    let frame = 0;
    let previous: number | null = null;
    let primed = false;
    /** How far the sıra gecesi has gathered everyone: 0 at their desks, 1 in the circle. */
    let sira = floorEffects.sira ? 1 : 0;
    /** Berlin's errand: whose desk, and when it set off. */
    let bite: { at: Point; start: number } | null = null;
    /** Where each perito was last drawn, for what is shown above their head. */
    const where = new Map<string, Point>();

    /** A coffee cup or a doughnut, a few pixels of each, with its bottom centre at (x, y). */
    const treat = (kind: Treat, x: number, y: number, seconds: number) => {
      const s = scale;
      const left = Math.round(x - 3 * s);
      const top = Math.round(y - 6 * s);
      if (kind === "coffee") {
        ctx.fillStyle = "#f4f1ea";
        ctx.fillRect(left, top + s, 6 * s, 5 * s);
        ctx.fillRect(left + 6 * s, top + 2 * s, s, 3 * s);
        ctx.fillStyle = "#6b4423";
        ctx.fillRect(left + s, top + s, 4 * s, s);
        // Steam, swaying.
        ctx.fillStyle = "rgba(255,255,255,0.8)";
        const sway = Math.floor(seconds * 3) % 2;
        ctx.fillRect(left + (1 + sway) * s, top - s, s, s);
        ctx.fillRect(left + (4 - sway) * s, top - 2 * s, s, s);
      } else {
        ctx.fillStyle = "#e58fb1";
        ctx.fillRect(left + s, top, 4 * s, 6 * s);
        ctx.fillRect(left, top + s, 6 * s, 4 * s);
        ctx.fillStyle = "#c98a4b";
        ctx.fillRect(left + s, top + 5 * s, 4 * s, s);
        ctx.fillStyle = "#5a3a22";
        ctx.fillRect(left + 2 * s, top + 2 * s, 2 * s, 2 * s);
        ctx.fillStyle = "#fff6c2";
        ctx.fillRect(left + s, top + s, s, s);
        ctx.fillRect(left + 4 * s, top + 3 * s, s, s);
      }
    };

    /** Draw a prop with its bottom centre at (x, y). */
    const prop = (item: Prop | undefined, x: number, y: number) => {
      if (!item) return;
      const width = item.width * scale;
      const height = item.height * scale;
      ctx.drawImage(item.image, item.x, item.y, item.width, item.height, Math.round(x - width / 2), Math.round(y - height), width, height);
    };

    /** Draw one frame of a clip with the figure's feet at (x, y). */
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

    /** The little sign a waiting perito holds up: a question mark, or a stamp. */
    const sign = (pose: Pose, x: number, y: number, dark: boolean) => {
      const size = 8 * scale;
      const left = Math.round(x - size / 2);
      const top = Math.round(y - size);
      ctx.fillStyle = dark ? "#b5d9fd" : "#416180";
      ctx.fillRect(left, top, size, size);
      ctx.fillStyle = dark ? "#1d2d3d" : "#f2f2f3";
      if (pose === "asking") {
        ctx.font = `700 ${6 * scale}px ui-monospace, Menlo, monospace`;
        ctx.textAlign = "center";
        ctx.fillText("?", x, top + size - 2 * scale);
      } else {
        // A stamp: handle on a base.
        ctx.fillRect(left + 3 * scale, top + scale, 2 * scale, 3 * scale);
        ctx.fillRect(left + scale, top + 4 * scale, 6 * scale, 2 * scale);
      }
    };

    const confetti = (seconds: number) => {
      for (let i = bursts.length - 1; i >= 0; i--) {
        const age = seconds - bursts[i]!.start;
        if (age > CELEBRATION_SECONDS) {
          bursts.splice(i, 1);
          continue;
        }
        const { at } = bursts[i]!;
        for (let piece = 0; piece < 18; piece++) {
          // Each piece flies out at its own angle and falls back under gravity.
          const angle = (piece / 18) * Math.PI * 2 + piece;
          const speed = 60 + ((piece * 37) % 50);
          const x = at.x + Math.cos(angle) * speed * age;
          const y = at.y - 30 + Math.sin(angle) * speed * age * 0.6 - 90 * age + 150 * age * age;
          ctx.globalAlpha = Math.max(0, 1 - age / CELEBRATION_SECONDS);
          ctx.fillStyle = CONFETTI[piece % CONFETTI.length]!;
          ctx.fillRect(Math.round(x / scale) * scale, Math.round(y / scale) * scale, scale * 2, scale * 2);
        }
        ctx.globalAlpha = 1;
      }
    };

    /** Where a perito stands at its own desk. */
    const standAt = (actor: Actor): Point =>
      furnished ? { x: actor.seat.x + DESK.figure.x, y: actor.seat.y + DESK.figure.y } : { x: actor.seat.x, y: actor.seat.y - 22 };

    const draw = (time: number) => {
      const seconds = time / 1000;
      const elapsed = previous === null ? 0 : Math.min(0.1, seconds - previous);
      previous = seconds;
      const current = latest.current;
      const dark = shell?.dataset.theme === "dark";

      // The night gathers and breaks up over a couple of seconds.
      const wanted = floorEffects.sira ? 1 : 0;
      sira = still ? wanted : sira + Math.max(-elapsed / 2.2, Math.min(elapsed / 2.2, wanted - sira));
      const gathered = sira * sira * (3 - 2 * sira);
      where.clear();

      ctx.clearRect(0, 0, FLOOR.width, FLOOR.height);
      ctx.imageSmoothingEnabled = false;
      if (furnished) ctx.drawImage(backdrop(skin, dark), 0, 0);
      for (const item of DECOR) prop(skin.props[item.prop], item.x, item.y);

      // Update every perito: who is queueing, who is walking, who just finished.
      const queueing = current.actors.filter((actor) => NEEDS_YOU.includes(actor.pose));
      for (const actor of current.actors) {
        const stand = standAt(actor);
        const place = queueing.indexOf(actor);
        let walker = walkers.get(actor.agent.id);
        if (!walker) {
          walker = { route: [stand], travelled: 0, pose: actor.pose, cheerUntil: 0 };
          walkers.set(actor.agent.id, walker);
          // Whoever is already waiting when the floor opens is found at your desk, not on the way.
          if (place !== -1 && !primed) {
            walker.route = routeToQueue(stand, actor.seat, place);
            walker.travelled = routeLength(walker.route);
          }
        }
        if (place !== -1) walker.route = routeToQueue(stand, actor.seat, place);
        const goal = place === -1 ? 0 : routeLength(walker.route);
        const step = still ? Infinity : WALK_SPEED * elapsed;
        walker.travelled += Math.max(-step, Math.min(step, goal - walker.travelled));

        // Work that ends (not in an error) earns a cheer.
        if (primed && AT_WORK.includes(walker.pose) && (actor.pose === "idle" || actor.pose === "off_duty") && !still) {
          walker.cheerUntil = seconds + CELEBRATION_SECONDS;
          bursts.push({ at: stand, start: seconds });
        }
        if (floorEffects.sendBerlin === actor.agent.id) {
          floorEffects.sendBerlin = null;
          if (!still) bite = { at: stand, start: seconds };
        }
        // Work that goes wrong earns a visit from Berlin.
        if (primed && walker.pose !== "error" && actor.pose === "error" && !still && !bite) bite = { at: stand, start: seconds };
        walker.pose = actor.pose;
      }
      for (const id of walkers.keys()) if (!current.actors.some((actor) => actor.agent.id === id)) walkers.delete(id);

      // A fresh seal gets confetti at your desk.
      for (const stamp of current.stamps) {
        if (sealed.has(stamp.id)) continue;
        sealed.add(stamp.id);
        if (primed && stamp.approved && !still) bursts.push({ at: { x: FLOOR.seal.x, y: FLOOR.seal.y - 20 }, start: seconds });
        // Work the user sent back: Berlin goes to whoever handed it in.
        const refused = !stamp.approved && stamp.taskId ? current.actors.find((actor) => actor.agent.taskId === stamp.taskId) : undefined;
        if (primed && refused && !still && !bite) bite = { at: standAt(refused), start: seconds };
      }
      primed = true;

      // Desks, with whoever is sitting at them tucked behind.
      const afoot: Array<{ actor: Actor; sheet: CharacterSheet; at: Point; moving: boolean; dancing?: boolean }> = [];
      const party = sira > 0.01;
      let lounging = 0;
      current.actors.forEach((actor, index) => {
        const sheet = (actor.agent.role === "lead" && skin.lead) || skin.characters[index % skin.characters.length]!;
        const walker = walkers.get(actor.agent.id)!;
        const cheering = seconds < walker.cheerUntil;
        const away = walker.travelled > 0.5;
        const clip = sheet.clips[actor.pose];
        const { x, y } = actor.seat;
        const stand = standAt(actor);
        const seated = !party && !away && (clip || cheering);
        if (furnished) {
          prop(skin.props.partitionLeft, x + DESK.partitionLeft.x, y + DESK.partitionLeft.y);
          prop(skin.props.partitionRight, x + DESK.partitionRight.x, y + DESK.partitionRight.y);
        }
        if (seated) {
          // Cheering: quick hops on the spot.
          const hop = cheering ? Math.abs(Math.sin(seconds * 14)) * 5 * scale : 0;
          figure(sheet, cheering ? sheet.clips.asking! : clip!, seconds, stand.x, stand.y - hop);
          where.set(actor.agent.id, { x: stand.x, y: stand.y - sheet.frameHeight * scale });
        }
        if (furnished) {
          prop(skin.props.desk, x + DESK.desk.x, y + DESK.desk.y);
          prop(skin.props.computer, x + DESK.computer.x, y + DESK.computer.y);
        }
        if (party) {
          // Everyone leaves the desk for a place in the circle.
          const angle = (index / Math.max(1, current.actors.length)) * Math.PI * 2 - Math.PI / 2;
          const spot = { x: SIRA.x + Math.cos(angle) * SIRA.rx, y: SIRA.y + Math.sin(angle) * SIRA.ry };
          const from = away ? pointAlong(walker.route, walker.travelled) : stand;
          const at = { x: from.x + (spot.x - from.x) * gathered, y: from.y + (spot.y - from.y) * gathered };
          afoot.push({ actor, sheet, at, moving: Math.abs(wanted - sira) > 0.01, dancing: sira > 0.99 });
        } else if (away) {
          const at = pointAlong(walker.route, walker.travelled);
          const goal = NEEDS_YOU.includes(actor.pose) ? routeLength(walker.route) : 0;
          afoot.push({ actor, sheet, at, moving: Math.abs(goal - walker.travelled) > 0.5 });
        } else if (!seated && skin.props.sofaWarm && sheet.clips.idle && lounging < LOUNGE_SEATS.length) {
          // Off duty: on a sofa in the lounge, if the skin has one.
          const seat = LOUNGE_SEATS[lounging++]!;
          figure(sheet, sheet.clips.idle, seconds + index, seat.x, seat.y);
          where.set(actor.agent.id, { x: seat.x, y: seat.y - sheet.frameHeight * scale });
        }
      });

      // Whoever is on their feet, nearest last so they overlap correctly.
      if (party) {
        // The carpet everyone sits around.
        ctx.globalAlpha = gathered;
        ctx.fillStyle = "#7a1f2b";
        ctx.fillRect(SIRA.x - 120, SIRA.y - 34, 240, 68);
        ctx.fillStyle = "#d9a441";
        for (let i = 0; i < 12; i++) ctx.fillRect(SIRA.x - 114 + i * 20, SIRA.y - 30, 8, 4), ctx.fillRect(SIRA.x - 114 + i * 20, SIRA.y + 26, 8, 4);
        ctx.fillStyle = "#f2e2b8";
        ctx.fillRect(SIRA.x - 40, SIRA.y - 8, 80, 16);
        ctx.fillStyle = "#7a1f2b";
        ctx.fillRect(SIRA.x - 30, SIRA.y - 4, 60, 8);
        ctx.globalAlpha = 1;
      }
      afoot.sort((a, b) => a.at.y - b.at.y);
      afoot.forEach(({ actor, sheet, at, moving, dancing }, index) => {
        const clip = dancing ? (sheet.clips.asking ?? sheet.clips.idle) : ((moving ? (sheet.walk ?? sheet.clips.asking) : sheet.clips.awaiting_seal) ?? sheet.clips.idle);
        if (!clip) return;
        // In the circle everyone claps along: small hops, each in their own time.
        const hop = dancing && !still ? Math.abs(Math.sin(seconds * 5 + index * 1.3)) * 3 * scale : 0;
        figure(sheet, clip, seconds, at.x, at.y - hop);
        where.set(actor.agent.id, { x: at.x, y: at.y - hop - sheet.frameHeight * scale });
        if (!party && NEEDS_YOU.includes(actor.pose)) sign(actor.pose, at.x, at.y - sheet.frameHeight * scale - scale, dark);
      });

      // What was brought to a desk floats above its perito for a few seconds, with a heart.
      const now = performance.now();
      for (const gift of floorEffects.treats) {
        const age = (now - gift.at) / 1000;
        const head = where.get(gift.agentId);
        if (age < 0 || age > TREAT_SECONDS || !head) continue;
        const rise = still ? 0 : Math.min(1, age / 0.5) * 6 * scale;
        ctx.globalAlpha = age > TREAT_SECONDS - 1 ? Math.max(0, TREAT_SECONDS - age) : 1;
        treat(gift.kind, head.x, head.y - 2 * scale - rise, seconds);
        ctx.fillStyle = "#e5484d";
        const hx = Math.round(head.x + 6 * scale);
        const hy = Math.round(head.y - 10 * scale - rise - (still ? 0 : (age * 10) % (6 * scale)));
        ctx.fillRect(hx, hy, scale, scale);
        ctx.fillRect(hx + 2 * scale, hy, scale, scale);
        ctx.fillRect(hx, hy + scale, 3 * scale, scale);
        ctx.fillRect(hx + scale, hy + 2 * scale, scale, scale);
        ctx.globalAlpha = 1;
      }

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
        let x = Math.round(dog.from + (dog.to - dog.from) * progress);
        let y = dog.y;
        let facingRight = outbound;
        let frameAt = frameIndex;
        // Berlin has an errand: out to the desk, a bite, and back.
        const errand = dog.name === BITER && bite ? seconds - bite.start : -1;
        if (errand >= 0 && errand < BITE.out + BITE.hold + BITE.back) {
          const target = { x: bite!.at.x + 34, y: bite!.at.y + 6 };
          const away = errand < BITE.out ? errand / BITE.out : errand < BITE.out + BITE.hold ? 1 : 1 - (errand - BITE.out - BITE.hold) / BITE.back;
          const biting = errand >= BITE.out && errand < BITE.out + BITE.hold;
          facingRight = biting ? false : errand < BITE.out ? target.x > x : target.x < x;
          x = Math.round(x + (target.x - x) * away + (biting ? Math.sin(seconds * 40) * 2 : 0));
          y = Math.round(y + (target.y - y) * away);
          frameAt = sheet.walk[Math.floor(seconds / (sheet.secondsPerFrame / 2)) % sheet.walk.length]!;
          if (biting) {
            ctx.save();
            ctx.fillStyle = "#e5484d";
            ctx.font = '700 15px ui-monospace, "SF Mono", Menlo, monospace';
            ctx.fillText("HAV!", x, y - height - 20);
            // The one who is bitten jumps.
            ctx.fillRect(Math.round(bite!.at.x - scale), Math.round(bite!.at.y - 34 * scale - Math.abs(Math.sin(seconds * 12)) * 4 * scale), 2 * scale, 5 * scale);
            ctx.fillRect(Math.round(bite!.at.x - scale), Math.round(bite!.at.y - 27 * scale - Math.abs(Math.sin(seconds * 12)) * 4 * scale), 2 * scale, 2 * scale);
            ctx.restore();
          }
        } else if (dog.name === BITER && bite && errand >= 0) {
          bite = null;
        }
        if (party) {
          // The dogs come and lie by the carpet.
          const spot = { x: SIRA.x + (dog.from < SIRA.x ? -150 : 150), y: SIRA.y + 70 };
          x = Math.round(x + (spot.x - x) * gathered);
          y = Math.round(y + (spot.y - y) * gathered);
          if (sira > 0.99) frameAt = sheet.rest[Math.floor(seconds / sheet.secondsPerFrame) % sheet.rest.length]!;
          facingRight = spot.x < SIRA.x;
        }
        ctx.save();
        ctx.translate(x, y - height);
        // The drawing faces left, so it is mirrored while heading right.
        if (facingRight) ctx.scale(-1, 1);
        ctx.drawImage(sheet.image, frameAt * sheet.frameWidth, 0, sheet.frameWidth, sheet.frameHeight, -width / 2, 0, width, height);
        ctx.restore();
        ctx.fillText(dog.name, x, y - height - 5);
      }

      confetti(seconds);
      if (party) {
        // Evening falls on the floor, and the music rises from the carpet.
        ctx.fillStyle = `rgba(24, 16, 44, ${0.34 * gathered})`;
        ctx.fillRect(0, 0, FLOOR.width, FLOOR.height);
        ctx.textAlign = "center";
        for (let i = 0; i < 7; i++) {
          const life = still ? 0.4 : (seconds * 0.35 + i / 7) % 1;
          ctx.globalAlpha = gathered * (1 - life);
          ctx.fillStyle = ["#ffd166", "#f2e2b8", "#ff9f6e"][i % 3]!;
          ctx.font = `700 ${18 + (i % 3) * 5}px ui-monospace, Menlo, monospace`;
          ctx.fillText(i % 2 ? "♪" : "♫", SIRA.x + Math.sin(i * 2.4 + life * 4) * (60 + i * 14), SIRA.y - 40 - life * 190);
        }
        ctx.globalAlpha = gathered;
        ctx.fillStyle = "#ffd166";
        ctx.font = '700 20px "Barlow Condensed", ui-monospace, Menlo, monospace';
        ctx.fillText("SIRA GECESİ", SIRA.x, 34);
        ctx.globalAlpha = 1;
      }
      if (!still) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    // With motion reduced there is no loop, so redraw when the floor changes.
    const redraw = still ? setInterval(() => draw(performance.now()), 500) : undefined;
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

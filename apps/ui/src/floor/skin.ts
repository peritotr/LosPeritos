import type { Pose } from "./model";

/**
 * A skin is the art the floor's characters are drawn with: sprite sheets plus
 * a description of which frames play for which pose. Art lives outside the
 * code, in `public/skins/<name>/`, so a pack can be swapped without a rebuild
 * and its licence stays next to its files.
 *
 * Until a pack is installed the floor uses a placeholder drawn in code.
 */

/** Which frames of a sheet play for one pose. */
export interface Clip {
  /** Row of the sheet, counted from 0. */
  row: number;
  /** Frame columns, counted from 0, in playing order. */
  frames: number[];
  secondsPerFrame: number;
}

export interface CharacterSheet {
  image: CanvasImageSource;
  frameWidth: number;
  frameHeight: number;
  /** A pose mapped to null is not drawn (the perito has left the desk). */
  clips: Record<Pose, Clip | null>;
}

export interface FloorSkin {
  name: string;
  /** Licence of the art, shown in Settings; e.g. "CC0". */
  license: string;
  /** One sheet per look; peritos are spread across them. */
  characters: CharacterSheet[];
  /** The Lead Perito's own look, when the skin has one. */
  lead?: CharacterSheet;
  /** How many screen pixels one art pixel covers on the 1200-unit floor. */
  scale: number;
  /** Furniture and plants by name. The floor draws the ones it knows and a skin has. */
  props: Record<string, Prop>;
  /** Animals that wander the floor, by kind (e.g. "frenchBulldog"). */
  pets: Record<string, PetSheet>;
}

/** A strip of frames for one animal, drawn facing left. */
export interface PetSheet {
  image: CanvasImageSource;
  frameWidth: number;
  frameHeight: number;
  /** Frame columns played while walking, and shown while resting. */
  walk: number[];
  rest: number[];
  secondsPerFrame: number;
}

/** A still drawing: a rectangle of a sheet. */
export interface Prop {
  image: CanvasImageSource;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The on-disk form: `public/skins/<name>/skin.json`. Paths are relative to that file. */
interface SkinFile {
  name: string;
  license: string;
  source?: string;
  scale?: number;
  characters: Array<{ src: string; frameWidth: number; frameHeight: number; clips: Record<Pose, Clip | null> }>;
  lead?: { src: string; frameWidth: number; frameHeight: number; clips: Record<Pose, Clip | null> };
  /** Optional. `items` maps a prop name to [x, y, width, height] on `sheet`. */
  props?: { sheet: string; items: Record<string, [number, number, number, number]> };
  pets?: Record<string, Omit<PetSheet, "image"> & { src: string }>;
}

const POSES: Pose[] = ["idle", "working", "asking", "awaiting_seal", "error", "off_duty"];

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Cannot load ${src}`));
    image.src = src;
  });
}

/**
 * Load the skin installed at `public/skins/<name>/`. Resolves to null when
 * there is none or it is malformed, so the caller can fall back.
 */
export async function loadSkin(name: string): Promise<FloorSkin | null> {
  const base = `${import.meta.env.BASE_URL}skins/${name}/`;
  try {
    const response = await fetch(base + "skin.json");
    // A dev server answers unknown paths with its HTML page.
    if (!response.ok || !response.headers.get("content-type")?.includes("json")) return null;
    const file = (await response.json()) as SkinFile;
    if (!file.characters?.length) return null;
    for (const sheet of [...file.characters, ...(file.lead ? [file.lead] : [])]) {
      const missing = POSES.filter((pose) => !(pose in sheet.clips));
      if (missing.length) throw new Error(`skin "${name}": ${sheet.src} has no clip for ${missing.join(", ")}`);
    }
    const characters = await Promise.all(
      file.characters.map(async (sheet) => ({ ...sheet, image: await loadImage(base + sheet.src) })),
    );
    const props: Record<string, Prop> = {};
    if (file.props) {
      const image = await loadImage(base + file.props.sheet);
      for (const [name, [x, y, width, height]] of Object.entries(file.props.items)) {
        props[name] = { image, x, y, width, height };
      }
    }
    const pets: Record<string, PetSheet> = {};
    for (const [kind, pet] of Object.entries(file.pets ?? {})) {
      pets[kind] = { ...pet, image: await loadImage(base + pet.src) };
    }
    const lead = file.lead && { ...file.lead, image: await loadImage(base + file.lead.src) };
    return { name: file.name, license: file.license, characters, lead, scale: file.scale ?? 3, props, pets };
  } catch (err) {
    console.warn(err);
    return null;
  }
}

// ── Placeholder ────────────────────────────────────────────────────────────

const SHIRTS = ["#416180", "#7a5c3e", "#3f6b52", "#7a3f4c", "#5a4a7c", "#6b6b2f", "#2f6b6b", "#804c2c"];
const HAIR = ["#2b2b2d", "#5a3a22", "#8a6a3a", "#3b3b55", "#6b2f2f", "#2b2b2d", "#a0a0a8", "#5a3a22"];
const SKIN = ["#e8c3a0", "#c99a6e", "#f0d2b6", "#a9764a", "#e8c3a0", "#8a5a34", "#f0d2b6", "#c99a6e"];

/** Frame columns of the placeholder sheet; a real pack declares its own in skin.json. */
const FRAME = { standA: 0, standB: 1, typeA: 2, typeB: 3, seated: 4, wave: 5 };

/**
 * One 16×32 figure. Deliberately plain: it proves the pipeline and shows the
 * poses until real art is installed.
 */
function drawFigure(ctx: CanvasRenderingContext2D, x: number, look: number, frame: number) {
  const px = (dx: number, dy: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x + dx, dy, w, h);
  };
  const bob = frame === FRAME.standB || frame === FRAME.typeB ? 1 : 0;
  const seated = frame === FRAME.typeA || frame === FRAME.typeB || frame === FRAME.seated;
  const top = (seated ? 9 : 5) + bob;

  px(4, top, 8, 3, HAIR[look]!); // hair
  px(4, top + 3, 8, 6, SKIN[look]!); // face
  px(5, top + 5, 2, 1, "#1d1f20"); // eyes
  px(9, top + 5, 2, 1, "#1d1f20");
  px(3, top + 9, 10, 8, SHIRTS[look]!); // torso

  if (frame === FRAME.typeA || frame === FRAME.typeB) {
    // Arms forward on the keys, alternating.
    px(2, top + 12 + (frame === FRAME.typeA ? 0 : 1), 3, 2, SKIN[look]!);
    px(11, top + 12 + (frame === FRAME.typeA ? 1 : 0), 3, 2, SKIN[look]!);
  } else if (frame === FRAME.wave) {
    px(1, top + 10, 2, 6, SHIRTS[look]!);
    px(13, top + 3, 2, 7, SHIRTS[look]!); // raised arm
    px(13, top + 1, 2, 2, SKIN[look]!);
  } else {
    px(1, top + 10, 2, 7, SHIRTS[look]!);
    px(13, top + 10, 2, 7, SHIRTS[look]!);
  }
  if (!seated) {
    px(4, top + 17, 3, 9, "#2b2b2d"); // legs
    px(9, top + 17, 3, 9, "#2b2b2d");
  }
}

/** A skin drawn at load time, so the floor has characters before any art is installed. */
export function placeholderSkin(): FloorSkin {
  const frameWidth = 16;
  const frameHeight = 32;
  const columns = Object.keys(FRAME).length;
  const clips: Record<Pose, Clip | null> = {
    idle: { row: 0, frames: [FRAME.seated], secondsPerFrame: 1 },
    working: { row: 0, frames: [FRAME.typeA, FRAME.typeB], secondsPerFrame: 0.3 },
    asking: { row: 0, frames: [FRAME.standA, FRAME.wave, FRAME.standA, FRAME.wave, FRAME.standB], secondsPerFrame: 0.35 },
    awaiting_seal: { row: 0, frames: [FRAME.standA, FRAME.standB], secondsPerFrame: 0.7 },
    error: { row: 0, frames: [FRAME.standA], secondsPerFrame: 1 },
    off_duty: null,
  };
  const characters = SHIRTS.map((_, look) => {
    const canvas = document.createElement("canvas");
    canvas.width = frameWidth * columns;
    canvas.height = frameHeight;
    const ctx = canvas.getContext("2d")!;
    for (let frame = 0; frame < columns; frame++) drawFigure(ctx, frame * frameWidth, look, frame);
    return { image: canvas, frameWidth, frameHeight, clips };
  });
  return { name: "placeholder", license: "MIT (drawn in code)", characters, scale: 3, props: {}, pets: {} };
}

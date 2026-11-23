/**
 * Things that happen on the floor for their own sake: a coffee or a doughnut
 * brought to a desk, and the sıra gecesi, when everyone leaves their desk and
 * gathers in the middle. The sprite layer reads this each frame; screens write it.
 */
export type Treat = "coffee" | "donut";

export const floorEffects = {
  /** What was brought to whom, and when (performance.now()). */
  treats: [] as Array<{ agentId: string; kind: Treat; at: number }>,
  /** Whether the sıra gecesi is on. */
  sira: false,
  /** Whose desk Berlin has been sent to; taken up by the floor and cleared. */
  sendBerlin: null as string | null,
};

export function sendBerlin(agentId: string): void {
  floorEffects.sendBerlin = agentId;
}

export function bringTreat(agentId: string, kind: Treat): void {
  floorEffects.treats.push({ agentId, kind, at: performance.now() });
  // Old ones are of no use to anyone.
  while (floorEffects.treats.length > 40) floorEffects.treats.shift();
}

export function setSira(on: boolean): void {
  floorEffects.sira = on;
}

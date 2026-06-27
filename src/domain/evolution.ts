/**
 * Avatar evolution — the pure progression mechanic (see
 * docs/adr/0004-avatar-evolution-mechanic-build.md).
 *
 * The companion evolves as the user's net worth GROWS over their own baseline
 * (fair across income levels), and never devolves: stage is derived from the
 * high-water growth ever reached. Framework-free and side-effect-free so it is
 * exhaustively BDD-tested; persistence + net-worth wiring live in the feature
 * layer (src/features/progression), never here.
 *
 * All amounts are integer minor units (cents) in the single app currency.
 */

export interface EvolutionStage {
  /** 0-based stage index. */
  stage: number;
  label: string;
  /** Growth-over-baseline (minor units) required to reach this stage. */
  growthThreshold: number;
}

/** Stage ladder. Thresholds are growth over the user's baseline net worth.
 *  Tunable data — see ADR 0004. (≈ +$0 / +$500 / +$2k / +$10k / +$50k.) */
export const EVOLUTION_STAGES: EvolutionStage[] = [
  { stage: 0, label: 'Spark', growthThreshold: 0 },
  { stage: 1, label: 'Sprout', growthThreshold: 50_000 },
  { stage: 2, label: 'Glimmer', growthThreshold: 200_000 },
  { stage: 3, label: 'Radiant', growthThreshold: 1_000_000 },
  { stage: 4, label: 'Luminary', growthThreshold: 5_000_000 },
];

/** The highest stage whose threshold is met by `growthMinor`. */
export function stageForGrowth(growthMinor: number): EvolutionStage {
  let result = EVOLUTION_STAGES[0]!;
  for (const s of EVOLUTION_STAGES) {
    if (growthMinor >= s.growthThreshold) result = s;
    else break;
  }
  return result;
}

export interface EvolutionProgress {
  stage: EvolutionStage;
  /** The next stage, or null when already at the top. */
  next: EvolutionStage | null;
  /** 0..1 fraction toward the next stage; 1 when maxed. */
  fraction: number;
  /** Growth still needed to reach the next stage (minor units); 0 when maxed. */
  remaining: number;
}

/** Current stage plus progress toward the next one, from high-water growth. */
export function progressToNext(growthMinor: number): EvolutionProgress {
  const stage = stageForGrowth(growthMinor);
  const next = EVOLUTION_STAGES[stage.stage + 1] ?? null;
  if (!next) return { stage, next: null, fraction: 1, remaining: 0 };
  const span = next.growthThreshold - stage.growthThreshold;
  const into = growthMinor - stage.growthThreshold;
  const fraction = span > 0 ? Math.min(1, Math.max(0, into / span)) : 1;
  return {
    stage,
    next,
    fraction,
    remaining: Math.max(0, next.growthThreshold - growthMinor),
  };
}

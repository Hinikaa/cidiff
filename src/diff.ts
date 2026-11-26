import type {
  BaselineSnapshot,
  DeltaStatus,
  DiffSummary,
  DiffThresholds,
  DockerLayer,
  DockerLayerDelta,
  StepDelta,
  StepTiming,
  TestDelta,
  TestTiming,
} from "./types.js";

function roundSec(val: number): number {
  return Math.round(val * 1000) / 1000;
}

function calcPct(baseSec: number, deltaSec: number): number | null {
  if (baseSec <= 0) {
    return null;
  }
  return Math.round((deltaSec / baseSec) * 1000) / 10;
}

function keyWithOccurrences<T>(
  items: T[],
  keyFn: (item: T) => string
): Map<string, T> {
  const counts = new Map<string, number>();
  const map = new Map<string, T>();
  for (const item of items) {
    const baseKey = keyFn(item);
    const n = (counts.get(baseKey) ?? 0) + 1;
    counts.set(baseKey, n);
    const fullKey = n === 1 ? baseKey : `${baseKey}\0#${n}`;
    map.set(fullKey, item);
  }
  return map;
}

function diffSteps(
  baseSteps: StepTiming[],
  headSteps: StepTiming[],
  stepThresholdSec: number
): StepDelta[] {
  const stepKey = (s: StepTiming) => `${s.job ?? ""}\0${s.name}`;
  const baseMap = keyWithOccurrences(baseSteps, stepKey);
  const headMap = keyWithOccurrences(headSteps, stepKey);

  const orderedKeys: string[] = [];
  const seen = new Set<string>();
  for (const k of headMap.keys()) {
    orderedKeys.push(k);
    seen.add(k);
  }
  for (const k of baseMap.keys()) {
    if (!seen.has(k)) {
      orderedKeys.push(k);
    }
  }

  const deltas: StepDelta[] = [];
  for (const key of orderedKeys) {
    const b = baseMap.get(key);
    const h = headMap.get(key);
    const baseSec = roundSec(b?.durationSec ?? 0);
    const headSec = roundSec(h?.durationSec ?? 0);
    const deltaSec = roundSec(headSec - baseSec);
    const deltaPct = calcPct(baseSec, deltaSec);

    let status: DeltaStatus;
    let regressed = false;

    if (!b && h) {
      status = "added";
      regressed = headSec > stepThresholdSec;
    } else if (b && !h) {
      status = "removed";
    } else if (deltaSec > stepThresholdSec) {
      status = "regressed";
      regressed = true;
    } else if (deltaSec < -stepThresholdSec) {
      status = "improved";
    } else {
      status = "unchanged";
    }

    const ref = h ?? b!;
    const out: StepDelta = {
      name: ref.name,
      baseSec,
      headSec,
      deltaSec,
      deltaPct,
      status,
      regressed,
    };
    if (ref.job !== undefined) {
      out.job = ref.job;
    }
    deltas.push(out);
  }

  return deltas;
}

function normalizeInstruction(instruction: string): string {
  return instruction
    .trim()
    .replace(/\s+/g, " ")
    .replace(/--mount=[^\s]+/g, "--mount=*");
}

function diffDockerLayers(
  baseLayers: DockerLayer[],
  headLayers: DockerLayer[],
  layerThresholdSec: number
): DockerLayerDelta[] {
  const unmatchedBase = new Set<number>(baseLayers.map((_, i) => i));
  const pairs: Array<{ base: DockerLayer | null; head: DockerLayer }> = [];
  const unmatchedHeads: number[] = [];

  // Pass 1: exact (stage, instruction) match in order.
  for (let hi = 0; hi < headLayers.length; hi += 1) {
    const h = headLayers[hi];
    let matchedIdx = -1;
    for (const bi of unmatchedBase) {
      const b = baseLayers[bi];
      if (b.stage === h.stage && b.instruction === h.instruction) {
        matchedIdx = bi;
        break;
      }
    }
    if (matchedIdx !== -1) {
      unmatchedBase.delete(matchedIdx);
      pairs.push({ base: baseLayers[matchedIdx], head: h });
    } else {
      unmatchedHeads.push(hi);
    }
  }

  // Pass 2: fallback match by (stage, normalized instruction), then normalized instruction.
  for (const hi of unmatchedHeads) {
    const h = headLayers[hi];
    const hNorm = normalizeInstruction(h.instruction);
    let matchedIdx = -1;

    for (const bi of unmatchedBase) {
      const b = baseLayers[bi];
      if (b.stage === h.stage && normalizeInstruction(b.instruction) === hNorm) {
        matchedIdx = bi;
        break;
      }
    }

    if (matchedIdx === -1) {
      for (const bi of unmatchedBase) {
        const b = baseLayers[bi];
        if (normalizeInstruction(b.instruction) === hNorm) {
          matchedIdx = bi;
          break;
        }
      }
    }

    if (matchedIdx !== -1) {
      unmatchedBase.delete(matchedIdx);
      pairs.push({ base: baseLayers[matchedIdx], head: h });
    } else {
      pairs.push({ base: null, head: h });
    }
  }

  const headIndexOrder = new Map<DockerLayer, number>();
  headLayers.forEach((l, idx) => headIndexOrder.set(l, idx));
  pairs.sort((a, b) => (headIndexOrder.get(a.head) ?? 0) - (headIndexOrder.get(b.head) ?? 0));

  return pairs.map(({ base, head }) => {
    const baseSec = roundSec(base?.durationSec ?? 0);
    const headSec = roundSec(head.durationSec);
    const deltaSec = roundSec(headSec - baseSec);
    const baseCached = base ? base.cached : null;
    const headCached = head.cached;

    let cacheFlip: DockerLayerDelta["cacheFlip"] = "NONE";
    if (baseCached === true && headCached === false) {
      cacheFlip = "CACHED_TO_MISS";
    } else if (baseCached === false && headCached === true) {
      cacheFlip = "MISS_TO_CACHED";
    }

    const regressed =
      cacheFlip === "CACHED_TO_MISS" ||
      (!headCached && deltaSec > layerThresholdSec);

    return {
      stage: head.stage,
      instruction: head.instruction,
      baseCached,
      headCached,
      baseSec,
      headSec,
      deltaSec,
      cacheFlip,
      regressed,
    };
  });
}

function diffTests(
  baseTests: TestTiming[],
  headTests: TestTiming[],
  testThresholdSec: number
): TestDelta[] {
  const testKey = (t: TestTiming) => `${t.suite}\0${t.name}`;
  const baseMap = keyWithOccurrences(baseTests, testKey);
  const headMap = keyWithOccurrences(headTests, testKey);

  const orderedKeys: string[] = [];
  const seen = new Set<string>();
  for (const k of headMap.keys()) {
    orderedKeys.push(k);
    seen.add(k);
  }
  for (const k of baseMap.keys()) {
    if (!seen.has(k)) {
      orderedKeys.push(k);
    }
  }

  const deltas: TestDelta[] = [];
  for (const key of orderedKeys) {
    const b = baseMap.get(key);
    const h = headMap.get(key);
    const baseSec = b ? roundSec(b.durationSec) : null;
    const headSec = h ? roundSec(h.durationSec) : null;
    const deltaSec = roundSec((headSec ?? 0) - (baseSec ?? 0));
    const deltaPct = baseSec !== null ? calcPct(baseSec, deltaSec) : null;

    let status: DeltaStatus;
    let regressed = false;
    let slowNew = false;

    if (baseSec === null && headSec !== null) {
      status = "added";
      if (headSec > testThresholdSec) {
        slowNew = true;
      }
    } else if (baseSec !== null && headSec === null) {
      status = "removed";
    } else if (deltaSec > testThresholdSec) {
      status = "regressed";
      regressed = true;
    } else if (deltaSec < -testThresholdSec) {
      status = "improved";
    } else {
      status = "unchanged";
    }

    const ref = h ?? b!;
    deltas.push({
      suite: ref.suite,
      name: ref.name,
      baseSec,
      headSec,
      deltaSec,
      deltaPct,
      status,
      regressed,
      slowNew,
    });
  }

  return deltas;
}

function sumDurations(items: Array<{ durationSec: number }>): number {
  let total = 0;
  for (const item of items) {
    total += item.durationSec;
  }
  return total;
}

export function computeDiff(
  base: BaselineSnapshot,
  head: BaselineSnapshot,
  thresholds: DiffThresholds
): DiffSummary {
  const layerThreshold = thresholds.layerThresholdSec ?? thresholds.stepThresholdSec;
  const stepDeltas = diffSteps(base.steps, head.steps, thresholds.stepThresholdSec);
  const dockerDeltas = diffDockerLayers(base.dockerLayers, head.dockerLayers, layerThreshold);
  const testDeltas = diffTests(base.tests, head.tests, thresholds.testThresholdSec);

  const regressedSteps = stepDeltas
    .filter((d) => d.regressed)
    .sort((a, b) => b.deltaSec - a.deltaSec);

  const cacheMisses = dockerDeltas
    .filter((d) => d.cacheFlip === "CACHED_TO_MISS")
    .sort((a, b) => b.deltaSec - a.deltaSec);

  const extraDockerRegressions = dockerDeltas.filter(
    (d) => d.regressed && d.cacheFlip !== "CACHED_TO_MISS"
  );

  const regressedTests = testDeltas
    .filter((d) => d.regressed)
    .sort((a, b) => b.deltaSec - a.deltaSec);

  const slowNewTests = testDeltas
    .filter((d) => d.slowNew)
    .sort((a, b) => (b.headSec ?? 0) - (a.headSec ?? 0));

  const fastestImprovements = testDeltas
    .filter((d) => d.baseSec !== null && d.headSec !== null && d.deltaSec < -0.001)
    .sort((a, b) => a.deltaSec - b.deltaSec);

  // Use workflow steps as total CI duration when present to avoid double-counting sub-phases.
  const hasSteps = base.steps.length > 0 || head.steps.length > 0;
  const totalBaseSec = roundSec(
    hasSteps
      ? sumDurations(base.steps)
      : sumDurations(base.dockerLayers) + sumDurations(base.tests)
  );
  const totalHeadSec = roundSec(
    hasSteps
      ? sumDurations(head.steps)
      : sumDurations(head.dockerLayers) + sumDurations(head.tests)
  );
  const totalDeltaSec = roundSec(totalHeadSec - totalBaseSec);
  const totalDeltaPct = calcPct(totalBaseSec, totalDeltaSec);

  const regressionCount =
    regressedSteps.length +
    cacheMisses.length +
    extraDockerRegressions.length +
    regressedTests.length +
    slowNewTests.length;

  return {
    totalBaseSec,
    totalHeadSec,
    totalDeltaSec,
    totalDeltaPct,
    stepDeltas,
    dockerDeltas,
    testDeltas,
    regressedSteps,
    cacheMisses,
    regressedTests,
    slowNewTests,
    fastestImprovements,
    regressionCount,
    hasRegressions: regressionCount > 0,
    thresholds,
  };
}

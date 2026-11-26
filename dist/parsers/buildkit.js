function parseBuildkitDuration(raw) {
    const full = raw.trim();
    const minMatch = /^(?:(\d+)h)?(?:(\d+)m)?(\d+(?:\.\d+)?)s$/i.exec(full);
    if (!minMatch) {
        return 0;
    }
    const hours = minMatch[1] ? Number.parseFloat(minMatch[1]) : 0;
    const mins = minMatch[2] ? Number.parseFloat(minMatch[2]) : 0;
    const secs = Number.parseFloat(minMatch[3]);
    const total = hours * 3600 + mins * 60 + secs;
    return Number.isFinite(total) && total >= 0 ? total : 0;
}
export function parseBuildkitLog(content) {
    const layers = new Map();
    const lines = content.split(/\r?\n/);
    let orderCounter = 0;
    const headerRe = /^#(\d+)\s+\[([^\]]+)\]\s+(.+)$/;
    const stageStepRe = /^(?:(.+?)\s+)?(\d+\/\d+)$/;
    const cachedRe = /^#(\d+)\s+CACHED\s*$/;
    const doneRe = /^#(\d+)\s+DONE\s+([0-9hms.]+)\s*$/i;
    const errorRe = /^#(\d+)\s+ERROR:\s*(.+)$/;
    const logTimeRe = /^#(\d+)\s+(\d+(?:\.\d+)?)\s+/;
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("#")) {
            continue;
        }
        const headerMatch = headerRe.exec(line);
        if (headerMatch) {
            const index = Number.parseInt(headerMatch[1], 10);
            const bracket = headerMatch[2].trim();
            const instruction = headerMatch[3].trim();
            const stageMatch = stageStepRe.exec(bracket);
            if (!stageMatch) {
                continue;
            }
            const stage = stageMatch[1] ? stageMatch[1].trim() : "default";
            if (!layers.has(index)) {
                layers.set(index, {
                    index,
                    order: orderCounter++,
                    stage,
                    instruction,
                    cached: false,
                    durationSec: 0,
                    maxLogSec: 0,
                });
            }
            continue;
        }
        const cachedMatch = cachedRe.exec(line);
        if (cachedMatch) {
            const index = Number.parseInt(cachedMatch[1], 10);
            const layer = layers.get(index);
            if (layer) {
                layer.cached = true;
                layer.durationSec = 0;
            }
            continue;
        }
        const doneMatch = doneRe.exec(line);
        if (doneMatch) {
            const index = Number.parseInt(doneMatch[1], 10);
            const layer = layers.get(index);
            if (layer && !layer.cached) {
                layer.durationSec = parseBuildkitDuration(doneMatch[2]);
            }
            continue;
        }
        const errorMatch = errorRe.exec(line);
        if (errorMatch) {
            const index = Number.parseInt(errorMatch[1], 10);
            const layer = layers.get(index);
            if (layer) {
                layer.error = errorMatch[2].trim();
                if (layer.durationSec === 0 && layer.maxLogSec > 0) {
                    layer.durationSec = layer.maxLogSec;
                }
            }
            continue;
        }
        const logTimeMatch = logTimeRe.exec(line);
        if (logTimeMatch) {
            const index = Number.parseInt(logTimeMatch[1], 10);
            const layer = layers.get(index);
            if (layer) {
                const sec = Number.parseFloat(logTimeMatch[2]);
                if (Number.isFinite(sec) && sec > layer.maxLogSec) {
                    layer.maxLogSec = sec;
                }
            }
        }
    }
    return Array.from(layers.values())
        .sort((a, b) => a.order - b.order)
        .map(({ index, stage, instruction, cached, durationSec, error }) => {
        const out = { index, stage, instruction, cached, durationSec };
        if (error !== undefined) {
            out.error = error;
        }
        return out;
    });
}

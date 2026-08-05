const adjectives = [
  "snowy",
  "bright",
  "quiet",
  "rapid",
  "silver",
  "clear",
  "steady",
  "bold",
  "lucky",
  "fresh",
  "golden",
  "nimble",
  "calm",
  "brisk",
  "sharp",
  "sunny",
] as const;

const nouns = [
  "ridge",
  "harbor",
  "signal",
  "orbit",
  "bridge",
  "summit",
  "field",
  "grove",
  "spark",
  "stone",
  "valley",
  "meadow",
  "trail",
  "cove",
  "anchor",
  "beacon",
] as const;

export function generateWorkspaceName(
  existingNames: Iterable<string> = [],
  random: () => number = Math.random,
): string {
  const existing = new Set(existingNames);

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const name = `${pick(adjectives, random)}-${pick(nouns, random)}`;
    if (!existing.has(name)) return name;
  }

  return `workspace-${Date.now().toString(36)}-${Math.floor(random() * 10_000).toString(36)}`;
}

function pick<const Values extends readonly string[]>(
  values: Values,
  random: () => number,
): Values[number] {
  const index = Math.min(values.length - 1, Math.floor(random() * values.length));
  return values[index]!;
}

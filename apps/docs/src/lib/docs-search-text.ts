// Low-level text primitives shared by the search indexer and the ranker. Pure
// string helpers only — no scoring policy lives here (see docs-search-ranking).

export type DocsSearchBlockKind = "text" | "code";

export type DocsSearchBlock = {
  kind: DocsSearchBlockKind;
  text: string;
  markdown?: string;
  language?: string;
};

export type DocsSearchSectionIntent =
  | {
      mode: "intent";
      id: string;
    }
  | {
      mode: "auto";
    }
  | {
      mode: "ignore";
      reason?: string;
    };

export type DocsSearchSection = {
  title: string;
  anchor?: string;
  searchIntent?: DocsSearchSectionIntent;
  blocks: DocsSearchBlock[];
};

export type DocsSearchDocument = {
  id: string;
  path: string;
  title: string;
  description: string;
  body: string;
  // Position in the docs navigation (0 = first). Lower is more central, used as
  // a gentle importance signal so core pages win near-ties over peripheral ones.
  order?: number;
  sections?: DocsSearchSection[];
};

export type PreparedDocsSearchBlock = DocsSearchBlock & {
  normalizedText: string;
};

export type PreparedDocsSearchSection = {
  title: string;
  anchor?: string;
  searchIntent?: DocsSearchSectionIntent;
  normalizedSearchIntentAliases: string[];
  searchIntentPriority: number;
  normalizedTitle: string;
  isOverview: boolean;
  blocks: PreparedDocsSearchBlock[];
};

export type PreparedDocsSearchDocument = Omit<DocsSearchDocument, "sections"> & {
  normalizedPath: string;
  normalizedTitle: string;
  normalizedDescription: string;
  normalizedBody: string;
  sections: PreparedDocsSearchSection[];
};

export type DocsSearchResult = {
  path: string;
  title: string;
  description: string;
  sectionTitle?: string;
  snippet: string;
  previewMarkdown: string;
  previewKind: DocsSearchBlockKind;
  previewLanguage?: string;
  highlightTerms: string[];
  highlightPhraseTerms: string[];
};

export type DocsSearchPayload = {
  query: string;
  results: DocsSearchResult[];
};

// Strip Markdown down to readable prose so the index stores words, not syntax.
export function compactSearchText(value: string) {
  return value
    .replace(/```[^\n]*\n/g, "\n")
    .replace(/```/g, "\n")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\\([\\`*_[\]{}()#+\-.!>])/g, "$1")
    .replace(/[#>_~|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Fold to lowercase, space-separated alphanumeric words. Matching happens on
// this form so "VmSpec", "vm-spec" and "vm spec" all reduce to "vm spec".
export function normalizeForSearch(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Common words that shouldn't drive relevance or be required for a match. A
// query like "create a vm" must still match a doc that never says the word "a".
export const SEARCH_STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "do", "for",
  "from", "how", "in", "into", "is", "it", "its", "of", "on", "or", "the",
  "their", "this", "to", "use", "using", "via", "with", "you", "your",
]);

export type SearchQuery = {
  raw: string;
  phrase: string;
  // `phrase` with stopwords dropped, so phrase matching is stopword-insensitive:
  // "create vm" and "create a vm" both reduce to the required phrase "create vm".
  requiredPhrase: string;
  tokens: string[];
  required: string[];
  optional: string[];
};

// Drop stopwords (and single chars) from a normalized string so a heading like
// "create a vm" compares as "create vm" — the words that actually carry meaning.
export function stripStopwords(normalized: string) {
  return normalized
    .split(" ")
    .filter((word) => word.length >= 2 && !SEARCH_STOPWORDS.has(word))
    .join(" ");
}

// Split a query into its scoring inputs. `required` drops stopwords and single
// characters so they neither gate results nor inflate scores; `optional` keeps
// them around to break ties when they do appear. If a query is *only* stopwords
// (e.g. "how to") we fall back to treating every token as required.
export function parseSearchQuery(raw: string): SearchQuery {
  const tokens = Array.from(new Set(normalizeForSearch(raw).split(" ").filter(Boolean)));
  const phrase = normalizeForSearch(raw);
  const required = tokens.filter((token) => token.length >= 2 && !SEARCH_STOPWORDS.has(token));
  const optional = tokens.filter((token) => !required.includes(token));

  if (required.length === 0) {
    return { raw, phrase, requiredPhrase: phrase, tokens, required: tokens, optional: [] };
  }

  return { raw, phrase, requiredPhrase: required.join(" "), tokens, required, optional };
}

export type WordMatch = { whole: number; prefix: number; fuzzy: number };

function adjacentTranspositionDistance(value: string, candidate: string) {
  if (value.length !== candidate.length) return Number.POSITIVE_INFINITY;

  const differences: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== candidate[index]) differences.push(index);
    if (differences.length > 2) return Number.POSITIVE_INFINITY;
  }

  if (differences.length !== 2) return Number.POSITIVE_INFINITY;
  const [first, second] = differences;
  if (second !== first + 1) return Number.POSITIVE_INFINITY;
  return value[first] === candidate[second] && value[second] === candidate[first]
    ? 1
    : Number.POSITIVE_INFINITY;
}

function editDistanceWithin(value: string, candidate: string, maxDistance: number) {
  if (Math.abs(value.length - candidate.length) > maxDistance) return maxDistance + 1;

  const transpositionDistance = adjacentTranspositionDistance(value, candidate);
  if (transpositionDistance <= maxDistance) return transpositionDistance;

  let previous = Array.from({ length: candidate.length + 1 }, (_value, index) => index);
  let current = Array.from({ length: candidate.length + 1 }, () => 0);

  for (let valueIndex = 1; valueIndex <= value.length; valueIndex += 1) {
    current[0] = valueIndex;
    let rowBest = current[0];

    for (let candidateIndex = 1; candidateIndex <= candidate.length; candidateIndex += 1) {
      const substitutionCost =
        value[valueIndex - 1] === candidate[candidateIndex - 1] ? 0 : 1;
      current[candidateIndex] = Math.min(
        previous[candidateIndex] + 1,
        current[candidateIndex - 1] + 1,
        previous[candidateIndex - 1] + substitutionCost,
      );
      rowBest = Math.min(rowBest, current[candidateIndex]);
    }

    if (rowBest > maxDistance) return maxDistance + 1;
    [previous, current] = [current, previous];
  }

  return previous[candidate.length] ?? maxDistance + 1;
}

function fuzzyDistanceFor(token: string, word: string) {
  if (token.length < 3 || word.length < 3) return 0;
  if (token[0] !== word[0]) return 0;
  return Math.max(token.length, word.length) >= 9 ? 2 : 1;
}

// How a token meets a normalized field, counted by word rather than substring
// so "a" can't hide inside "domains" and "vm" can't smear across "vmware logs".
// `whole` = exact word equality; `prefix` = either side is a >=2-char prefix of
// the other, which forgives plurals and stems (vm↔vms, token↔tokens).
export function wordMatch(
  normalizedField: string,
  token: string,
  options: { fuzzy?: boolean } = {},
): WordMatch {
  if (!normalizedField || !token) return { whole: 0, prefix: 0, fuzzy: 0 };

  let whole = 0;
  let prefix = 0;
  let fuzzy = 0;
  for (const word of normalizedField.split(" ")) {
    if (!word) continue;
    if (word === token) {
      whole += 1;
    } else if (
      token.length >= 2 &&
      word.length >= 2 &&
      (word.startsWith(token) || (token.startsWith(word) && token.length - word.length <= 1))
    ) {
      prefix += 1;
    } else if (options.fuzzy) {
      const maxDistance = fuzzyDistanceFor(token, word);
      if (maxDistance > 0 && editDistanceWithin(token, word, maxDistance) <= maxDistance) {
        fuzzy += 1;
      }
    }
  }

  return { whole, prefix, fuzzy };
}

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

// Earliest position of the query in a source string: the full phrase if present,
// otherwise the earliest of any token. Used only to center excerpts.
export function matchIndex(source: string, query: SearchQuery) {
  const lower = source.toLowerCase();
  const phraseIndex = query.phrase.length > 1 ? lower.indexOf(query.phrase) : -1;
  if (phraseIndex !== -1) return phraseIndex;

  return query.tokens.reduce((best, token) => {
    const index = lower.indexOf(token);
    if (index === -1) return best;
    return best === -1 ? index : Math.min(best, index);
  }, -1);
}

// Snap an index to the nearest word boundary so excerpts never start or end
// mid-word. `direction` "start" rounds up to the next word, "end" rounds down.
function snapToWord(text: string, index: number, direction: "start" | "end") {
  if (index <= 0) return 0;
  if (index >= text.length) return text.length;
  if (text[index] === " ") return index;

  if (direction === "start") {
    const next = text.indexOf(" ", index);
    return next === -1 ? index : next + 1;
  }

  const prev = text.lastIndexOf(" ", index);
  return prev === -1 ? index : prev;
}

// A word-snapped window of prose centered on the match, with leading/trailing
// ellipses when text is clipped.
export function textExcerpt(source: string, index: number, maxLength = 180) {
  const compact = collapseWhitespace(source);
  if (!compact) return "";
  if (compact.length <= maxLength) return compact;

  if (index < 0) {
    const end = snapToWord(compact, maxLength, "end");
    return `${compact.slice(0, end).trim()} …`;
  }

  let start = snapToWord(compact, Math.max(0, index - 64), "start");
  let end = snapToWord(compact, Math.min(compact.length, start + maxLength), "end");
  if (end <= start) end = Math.min(compact.length, start + maxLength);

  const prefix = start > 0 ? "… " : "";
  const suffix = end < compact.length ? " …" : "";
  return `${prefix}${compact.slice(start, end).trim()}${suffix}`;
}

// Like textExcerpt but preserves the raw Markdown so the preview can still
// render inline code/links. Snaps to word boundaries to avoid shredding syntax.
export function markdownExcerpt(source: string, index: number, maxLength = 240) {
  const trimmed = source.trim();
  if (!trimmed || trimmed.length <= maxLength) return trimmed;

  if (index < 0) {
    const end = snapToWord(trimmed, maxLength, "end");
    return `${trimmed.slice(0, end).trim()} …`;
  }

  let start = snapToWord(trimmed, Math.max(0, index - 80), "start");
  let end = snapToWord(trimmed, Math.min(trimmed.length, start + maxLength), "end");
  if (end <= start) end = Math.min(trimmed.length, start + maxLength);

  const prefix = start > 0 ? "… " : "";
  const suffix = end < trimmed.length ? " …" : "";
  return `${prefix}${trimmed.slice(start, end).trim()}${suffix}`;
}

// A short, contextual window of code centered on the matching line.
export function codeExcerpt(source: string, query: SearchQuery, maxLines = 4) {
  const lines = source.replace(/\s+$/g, "").split(/\r?\n/);
  const matchLineIndex = lines.findIndex((line) => matchIndex(line, query) !== -1);
  const firstMeaningfulLine = lines.findIndex((line) => line.trim());
  const center = matchLineIndex !== -1 ? matchLineIndex : Math.max(0, firstMeaningfulLine);
  const start = Math.max(0, Math.min(center - 1, Math.max(0, lines.length - maxLines)));
  const selected = lines.slice(start, start + maxLines).join("\n").trim();
  const prefix = start > 0 ? "…\n" : "";
  const suffix = start + maxLines < lines.length ? "\n…" : "";
  return `${prefix}${selected}${suffix}`;
}

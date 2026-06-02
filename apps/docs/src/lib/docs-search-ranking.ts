import {
  codeExcerpt,
  markdownExcerpt,
  matchIndex,
  parseSearchQuery,
  SEARCH_STOPWORDS,
  stripStopwords,
  textExcerpt,
  wordMatch,
  type DocsSearchBlockKind,
  type DocsSearchPayload,
  type DocsSearchResult,
  type PreparedDocsSearchBlock,
  type PreparedDocsSearchDocument,
  type PreparedDocsSearchSection,
  type SearchQuery,
} from "./docs-search-text";

type SearchCandidate = {
  document: PreparedDocsSearchDocument;
  section: PreparedDocsSearchSection;
  score: number;
};

function looksLikeCodeQuery(query: SearchQuery) {
  return (
    /[._()[\]{}=*"'/:\\-]/.test(query.raw) ||
    /[a-z][A-Z]/.test(query.raw) ||
    query.required.some((token) => token.length > 12)
  );
}

function compactIncludesPhrase(normalizedField: string, query: SearchQuery) {
  return query.required.length > 1 && stripStopwords(normalizedField).includes(query.requiredPhrase);
}

function phrasePrefix(normalizedField: string, query: SearchQuery) {
  return query.phrase.length > 1 && normalizedField.startsWith(query.phrase);
}

function priorityBonus(order: number | undefined) {
  if (order === undefined) return 0;
  return Math.max(0, 30 - order) * 2;
}

function tokenScore(
  normalizedField: string,
  query: SearchQuery,
  weights: { whole: number; prefix: number; fuzzy: number },
) {
  let score = 0;
  let covered = 0;

  for (const token of query.required) {
    const match = wordMatch(normalizedField, token, { fuzzy: true });
    if (match.whole || match.prefix || match.fuzzy) covered += 1;
    score += match.whole * weights.whole;
    score += match.prefix * weights.prefix;
    score += match.fuzzy * weights.fuzzy;
  }

  return { score, covered };
}

function aliasScore(section: PreparedDocsSearchSection, query: SearchQuery) {
  if (section.normalizedSearchIntentAliases.length === 0) {
    return { score: 0, covered: 0 };
  }

  let score = 0;
  const aliases = section.normalizedSearchIntentAliases;
  const aliasText = aliases.join(" ");
  const match =
    query.required.length > 1
      ? tokenScore(aliasText, query, { whole: 16, prefix: 8, fuzzy: 6 })
      : tokenScore(aliasText, query, { whole: 0, prefix: 0, fuzzy: 8 });

  score += match.score;
  if (query.required.length === 1 && match.score > 0) {
    score += section.searchIntentPriority * 0.5;
  }

  for (const alias of aliases) {
    const compactAlias = stripStopwords(alias);

    if (alias === query.phrase || compactAlias === query.requiredPhrase) {
      score += 180 + section.searchIntentPriority * 1.3;
    } else if (
      query.phrase.includes(" ") &&
      (alias.startsWith(query.phrase) ||
        (query.required.length > 1 && compactAlias.startsWith(query.requiredPhrase)))
    ) {
      score += 90 + section.searchIntentPriority * 0.5;
    }
  }

  return {
    score,
    covered:
      match.covered ||
      (aliases.some((alias) => alias === query.phrase || stripStopwords(alias) === query.requiredPhrase)
        ? query.required.length
        : 0),
  };
}

function scoreSection(
  document: PreparedDocsSearchDocument,
  section: PreparedDocsSearchSection,
  query: SearchQuery,
) {
  const codeQuery = looksLikeCodeQuery(query);
  const aliases = aliasScore(section, query);
  const title = tokenScore(section.normalizedTitle, query, {
    whole: 32,
    prefix: 18,
    fuzzy: 12,
  });
  const pageTitle = tokenScore(document.normalizedTitle, query, {
    whole: 22,
    prefix: 12,
    fuzzy: 8,
  });
  const description = tokenScore(document.normalizedDescription, query, {
    whole: 10,
    prefix: 5,
    fuzzy: 3,
  });
  const path = tokenScore(document.normalizedPath, query, {
    whole: 8,
    prefix: 4,
    fuzzy: 2,
  });

  let score = aliases.score + title.score + pageTitle.score + description.score + path.score;
  let covered = Math.max(
    aliases.covered,
    title.covered,
    pageTitle.covered,
    description.covered,
    path.covered,
  );

  if (compactIncludesPhrase(section.normalizedTitle, query)) score += 240;
  if (query.required.length > 1 && stripStopwords(section.normalizedTitle) === query.requiredPhrase) {
    score += 260;
  }
  if (compactIncludesPhrase(document.normalizedTitle, query)) score += 320;
  if (phrasePrefix(section.normalizedTitle, query)) score += 260;
  if (phrasePrefix(document.normalizedTitle, query)) score += 160;

  for (const block of section.blocks) {
    const blockScore = tokenScore(block.normalizedText, query, {
      whole: block.kind === "code" ? (codeQuery ? 18 : 4) : 12,
      prefix: block.kind === "code" ? (codeQuery ? 12 : 3) : 6,
      fuzzy: block.kind === "code" ? (codeQuery ? 8 : 1) : 4,
    });

    covered = Math.max(covered, blockScore.covered);
    score += blockScore.score;

    if (compactIncludesPhrase(block.normalizedText, query)) {
      score += block.kind === "code" ? (codeQuery ? 180 : 40) : 280;
    }
  }

  if (query.required.length > 1 && covered < query.required.length) return 0;
  if (covered === 0) return 0;

  score += section.searchIntentPriority * 0.25;
  score += priorityBonus(document.order);
  return score;
}

function coveredRequiredTerms(
  normalizedField: string,
  query: SearchQuery,
  options: { fuzzy?: boolean } = {},
) {
  return query.required.filter((token) => {
    const { whole, prefix, fuzzy } = wordMatch(normalizedField, token, options);
    return whole > 0 || prefix > 0 || fuzzy > 0;
  }).length;
}

function scoreBlockForSnippet(
  block: PreparedDocsSearchBlock,
  query: SearchQuery,
  options: { codeQuery: boolean },
) {
  let score = 0;
  if (compactIncludesPhrase(block.normalizedText, query)) score += 120;

  const covered = coveredRequiredTerms(block.normalizedText, query);
  score += covered * 18;
  if (query.required.length > 1 && covered === query.required.length) score += 50;

  if (block.kind === "text") score += options.codeQuery ? 0 : 10;
  if (block.kind === "code") score += options.codeQuery ? 14 : -12;
  return score;
}

function representativeBlock(section: PreparedDocsSearchSection) {
  return (
    section.blocks.find((block) => block.kind === "text") ??
    section.blocks.find((block) => block.kind === "code") ??
    section.blocks[0]
  );
}

function bestSnippetBlock(section: PreparedDocsSearchSection, query: SearchQuery) {
  let best: PreparedDocsSearchBlock | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  const codeQuery = looksLikeCodeQuery(query);

  for (const block of section.blocks) {
    const score = scoreBlockForSnippet(block, query, { codeQuery });
    if (score > bestScore || !best) {
      best = block;
      bestScore = score;
    }
  }

  return bestScore > 0 ? best : representativeBlock(section);
}

function searchSections(
  index: PreparedDocsSearchDocument[],
  query: SearchQuery,
  limit: number,
) {
  const candidates: SearchCandidate[] = [];

  for (const document of index) {
    for (const section of document.sections) {
      const score = scoreSection(document, section, query);
      if (score > 0) candidates.push({ document, section, score });
    }
  }

  return candidates
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      if ((a.document.order ?? Number.MAX_SAFE_INTEGER) !== (b.document.order ?? Number.MAX_SAFE_INTEGER)) {
        return (a.document.order ?? Number.MAX_SAFE_INTEGER) - (b.document.order ?? Number.MAX_SAFE_INTEGER);
      }
      return a.document.title.localeCompare(b.document.title);
    })
    .slice(0, limit);
}

function codeFenceFor(value: string) {
  const longestRun = Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length));
  return "`".repeat(Math.max(3, longestRun + 1));
}

function safePreviewLanguage(language: string | undefined) {
  return language && /^[A-Za-z0-9_-]+$/.test(language) ? language : "";
}

function buildSnippet(
  block: PreparedDocsSearchBlock | undefined,
  document: PreparedDocsSearchDocument,
  query: SearchQuery,
) {
  if (block?.kind === "code") return codeExcerpt(block.text, query);
  if (block) return textExcerpt(block.text, matchIndex(block.text, query));

  const descriptionIndex = matchIndex(document.description, query);
  if (descriptionIndex !== -1) return textExcerpt(document.description, descriptionIndex);
  return textExcerpt(document.body || document.description, -1);
}

function buildPreviewMarkdown(
  block: PreparedDocsSearchBlock | undefined,
  document: PreparedDocsSearchDocument,
  snippet: string,
  query: SearchQuery,
) {
  if (block?.kind === "code") {
    const fence = codeFenceFor(snippet);
    const language = safePreviewLanguage(block.language);
    return `${fence}${language}\n${snippet}\n${fence}`;
  }

  const source = block?.markdown ?? block?.text ?? document.description;
  return markdownExcerpt(source, matchIndex(source, query));
}

export function searchDocs(
  index: PreparedDocsSearchDocument[],
  rawQuery: string,
  options: { limit?: number } = {},
): DocsSearchPayload {
  const query = parseSearchQuery(rawQuery);
  const trimmedQuery = rawQuery.trim();
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 25);

  if (query.tokens.length === 0) {
    return { query: trimmedQuery, results: [] };
  }

  const highlightTerms = query.required.filter(
    (token) => token.length > 1 && !SEARCH_STOPWORDS.has(token),
  );
  const highlightPhraseTerms = query.tokens.length > 1 ? query.tokens : [];

  const results: DocsSearchResult[] = searchSections(index, query, limit).map(({ document, section }) => {
    const block = bestSnippetBlock(section, query);
    const previewKind: DocsSearchBlockKind = block?.kind ?? "text";
    const snippet = buildSnippet(block, document, query);
    const path = !section.isOverview && section.anchor
      ? `${document.path}#${section.anchor}`
      : document.path;

    return {
      path,
      title: document.title,
      description: document.description,
      sectionTitle: section.isOverview ? undefined : section.title,
      snippet,
      previewMarkdown: buildPreviewMarkdown(block, document, snippet, query),
      previewKind,
      previewLanguage: safePreviewLanguage(block?.language) || undefined,
      highlightTerms,
      highlightPhraseTerms,
    };
  });

  return { query: trimmedQuery, results };
}

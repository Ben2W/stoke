// Public entry point for docs search. Splits into three files:
//   docs-search-text     — pure text primitives + shared types
//   docs-search-ranking  — relevance scoring + snippet selection
//   docs-search (here)    — turning Markdown into a searchable index
//
// Consumers import everything from this module.

import {
  compactSearchText,
  normalizeForSearch,
  type DocsSearchDocument,
  type DocsSearchSectionIntent,
  type DocsSearchSection,
  type PreparedDocsSearchDocument,
} from "./docs-search-text";
import {
  docsSearchIntentFor,
  isDocsSearchIntentName,
} from "./docs-search-intents";

export {
  compactSearchText,
  type DocsSearchBlock,
  type DocsSearchBlockKind,
  type DocsSearchDocument,
  type DocsSearchPayload,
  type DocsSearchResult,
  type DocsSearchSection,
  type DocsSearchSectionIntent,
  type PreparedDocsSearchDocument,
} from "./docs-search-text";

export { searchDocs } from "./docs-search-ranking";

export function stripSearchIntentTags(value: string) {
  return value.replace(/^[ \t]*<SearchIntent\b[^>\n]*\/>[ \t]*\n?/gm, "");
}

function slugifyHeading(value: string) {
  return compactSearchText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function pushTextBlock(section: DocsSearchSection, lines: string[]) {
  const markdown = lines.join("\n").trim();
  const text = compactSearchText(markdown);
  if (text) section.blocks.push({ kind: "text", text, markdown });
  lines.length = 0;
}

function pushCodeBlock(section: DocsSearchSection, text: string, language?: string) {
  const trimmed = text.trim();
  if (trimmed) section.blocks.push({ kind: "code", text: trimmed, language });
}

type ExtractSearchSectionsOptions = {
  source?: string;
  validateSearchIntents?: boolean;
};

function searchIntentError(message: string, source: string | undefined, lineNumber: number) {
  const location = source ? `${source}:${lineNumber}` : `line ${lineNumber}`;
  return new Error(`${location}: ${message}`);
}

function stringAttr(attrs: string, name: string) {
  const pattern = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|\\{\\s*"([^"]*)"\\s*\\}|\\{\\s*'([^']*)'\\s*\\})`,
  );
  const match = attrs.match(pattern);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? match?.[4];
}

function booleanAttr(attrs: string, name: string) {
  const pattern = new RegExp(
    `(?:^|\\s)${name}(?:\\s*=\\s*(\\{\\s*true\\s*\\}|\\{\\s*false\\s*\\}|"true"|"false"|'true'|'false'))?(?=\\s|$)`,
  );
  const match = attrs.match(pattern);
  if (!match) return false;
  const value = match[1]?.replace(/[{}"'\s]/g, "");
  return value !== "false";
}

function parseSearchIntent(
  attrs: string,
  source: string | undefined,
  lineNumber: number,
): DocsSearchSectionIntent {
  const id = stringAttr(attrs, "id");
  const auto = booleanAttr(attrs, "auto");
  const ignore = booleanAttr(attrs, "ignore");
  const modeCount = [id !== undefined, auto, ignore].filter(Boolean).length;

  if (modeCount !== 1) {
    throw searchIntentError(
      "SearchIntent must set exactly one of id, auto, or ignore",
      source,
      lineNumber,
    );
  }

  if (id !== undefined) {
    if (!isDocsSearchIntentName(id)) {
      throw searchIntentError(`Unknown SearchIntent id: ${id}`, source, lineNumber);
    }
    return { mode: "intent", id };
  }

  if (ignore) {
    const reason = stringAttr(attrs, "reason");
    return reason ? { mode: "ignore", reason } : { mode: "ignore" };
  }

  return { mode: "auto" };
}

// Split a Markdown document into sections keyed on its h2–h4 headings, with each
// section's prose and fenced code captured as separate blocks. Content before
// the first heading lands in a synthetic "Overview" lead section.
export function extractSearchSections(
  markdown: string,
  options: ExtractSearchSectionsOptions = {},
): DocsSearchSection[] {
  const sections: DocsSearchSection[] = [{ title: "Overview", blocks: [] }];
  const textLines: string[] = [];
  const codeLines: string[] = [];
  let codeFence: { marker: string; length: number; language?: string } | undefined;
  let pendingSearchIntent: DocsSearchSectionIntent | undefined;
  let parentSearchIntent: DocsSearchSectionIntent | undefined;

  const lines = markdown.split(/\r?\n/);
  for (const [lineIndex, line] of lines.entries()) {
    const lineNumber = lineIndex + 1;
    const fenceMatch = line.match(/^([`~]{3,})(.*)$/);

    if (codeFence) {
      if (
        fenceMatch &&
        fenceMatch[1]?.[0] === codeFence.marker &&
        fenceMatch[1].length >= codeFence.length
      ) {
        pushCodeBlock(sections[sections.length - 1], codeLines.join("\n"), codeFence.language);
        codeLines.length = 0;
        codeFence = undefined;
      } else {
        codeLines.push(line);
      }
      continue;
    }

    const searchIntentMatch = line.match(/^[ \t]*<SearchIntent\b([^>\n]*)\/>[ \t]*$/);
    if (searchIntentMatch) {
      pushTextBlock(sections[sections.length - 1], textLines);
      if (pendingSearchIntent) {
        throw searchIntentError(
          "SearchIntent must be followed by a heading before another SearchIntent",
          options.source,
          lineNumber,
        );
      }
      pendingSearchIntent = parseSearchIntent(
        searchIntentMatch[1] ?? "",
        options.source,
        lineNumber,
      );
      continue;
    }

    if (line.includes("<SearchIntent")) {
      throw searchIntentError(
        "SearchIntent must be a single-line self-closing tag",
        options.source,
        lineNumber,
      );
    }

    if (fenceMatch) {
      pushTextBlock(sections[sections.length - 1], textLines);
      const meta = fenceMatch[2]?.trim() ?? "";
      codeFence = {
        marker: fenceMatch[1][0] ?? "`",
        length: fenceMatch[1].length,
        language: meta.split(/\s+/, 1)[0] || undefined,
      };
      continue;
    }

    const heading = line.match(/^(#{2,4})\s+(.+)$/);
    if (heading) {
      pushTextBlock(sections[sections.length - 1], textLines);
      const title = compactSearchText(heading[2] ?? "");
      const level = heading[1]?.length ?? 0;
      let searchIntent = pendingSearchIntent;

      if (level === 2) {
        if (!searchIntent && options.validateSearchIntents !== false) {
          throw searchIntentError(
            `Missing SearchIntent before section heading: ${title}`,
            options.source,
            lineNumber,
          );
        }
        parentSearchIntent = searchIntent;
      } else {
        searchIntent ??= parentSearchIntent;
      }

      pendingSearchIntent = undefined;
      if (title) {
        sections.push({
          title,
          anchor: slugifyHeading(title),
          searchIntent,
          blocks: [],
        });
      }
      continue;
    }

    if (pendingSearchIntent && line.trim()) {
      throw searchIntentError(
        "SearchIntent must be placed immediately before a heading",
        options.source,
        lineNumber,
      );
    }

    if (!line.trim()) {
      pushTextBlock(sections[sections.length - 1], textLines);
      continue;
    }

    textLines.push(line);
  }

  if (codeFence) pushCodeBlock(sections[sections.length - 1], codeLines.join("\n"), codeFence.language);
  pushTextBlock(sections[sections.length - 1], textLines);
  if (pendingSearchIntent) {
    throw searchIntentError(
      "SearchIntent must be followed by a heading",
      options.source,
      lines.length,
    );
  }

  return sections.filter((section) => section.blocks.length > 0);
}

// Precompute normalized document/section forms used by the Worker at query time.
export function prepareDocsSearchIndex(
  documents: DocsSearchDocument[],
): PreparedDocsSearchDocument[] {
  return documents.map((document) => {
    const rawSections =
      document.sections && document.sections.length > 0
        ? document.sections
        : [{ title: "Overview", blocks: [{ kind: "text" as const, text: document.body }] }];

    const searchableSections = rawSections.filter(
      (section) => section.searchIntent?.mode !== "ignore",
    );

    const body =
      searchableSections.flatMap((section) => section.blocks).map((block) => block.text).join("\n") ||
      document.body;

    const sections = searchableSections.map((section) => {
      const intent = section.searchIntent;
      const intentDefinition =
        intent?.mode === "intent" && isDocsSearchIntentName(intent.id)
          ? docsSearchIntentFor(intent.id)
          : undefined;

      if (intent?.mode === "intent" && !intentDefinition) {
        throw new Error(`Unknown SearchIntent id: ${intent.id}`);
      }

      return {
        title: section.title,
        anchor: section.anchor,
        searchIntent: intent,
        normalizedSearchIntentAliases:
          intentDefinition?.aliases.map((alias) => normalizeForSearch(alias)) ?? [],
        searchIntentPriority: intentDefinition?.priority ?? 0,
        normalizedTitle: normalizeForSearch(section.title),
        // Only the synthetic lead section (no anchor) is treated as "overview"; a
        // real "## Overview" heading keeps its anchor and scores like any heading.
        isOverview: section.title === "Overview" && !section.anchor,
        blocks: section.blocks.map((block) => ({
          ...block,
          normalizedText: normalizeForSearch(block.text),
        })),
      };
    });

    return {
      id: document.id,
      path: document.path,
      title: document.title,
      description: document.description,
      body,
      order: document.order,
      normalizedPath: normalizeForSearch(document.path),
      normalizedTitle: normalizeForSearch(document.title),
      normalizedDescription: normalizeForSearch(document.description),
      normalizedBody: normalizeForSearch(body),
      sections,
    };
  });
}

import React, { Children, Fragment, cloneElement, isValidElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import ReactMarkdown, { type Components } from "react-markdown";
import { PrismLight as SyntaxHighlighter, createElement as createSyntaxElement } from "react-syntax-highlighter";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import ini from "react-syntax-highlighter/dist/esm/languages/prism/ini";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import oneLight from "react-syntax-highlighter/dist/esm/styles/prism/one-light";

export type SearchPreviewProps = {
  markdown: string;
  kind: "text" | "code";
  language?: string;
  highlightTerms: string[];
  highlightPhraseTerms?: string[];
};

type SyntaxNode = {
  type: "element" | "text";
  value?: string | number;
  tagName?: keyof React.JSX.IntrinsicElements | React.ComponentType<any>;
  properties?: { className?: string[]; [key: string]: unknown };
  children?: SyntaxNode[];
};

type SyntaxRendererProps = {
  rows: SyntaxNode[];
  stylesheet: { [key: string]: React.CSSProperties };
  useInlineStyles: boolean;
};

const previewRoots = new WeakMap<Element, Root>();

const languageAliases: Record<string, string> = {
  js: "javascript",
  jsx: "jsx",
  sh: "bash",
  shell: "bash",
  ts: "typescript",
  tsx: "tsx",
};

const highlightedLanguages = new Set(["bash", "ini", "javascript", "jsx", "tsx", "typescript"]);

SyntaxHighlighter.registerLanguage("bash", bash);
SyntaxHighlighter.registerLanguage("ini", ini);
SyntaxHighlighter.registerLanguage("javascript", javascript);
SyntaxHighlighter.registerLanguage("jsx", jsx);
SyntaxHighlighter.registerLanguage("tsx", tsx);
SyntaxHighlighter.registerLanguage("typescript", typescript);

function normalizeLanguage(value: string | undefined) {
  const language = value?.trim().toLowerCase() ?? "";
  return languageAliases[language] ?? language;
}

function normalizedTerms(terms: string[]) {
  return Array.from(new Set(terms.map((term) => term.toLowerCase()).filter((term) => term.length > 0))).sort(
    (a, b) => b.length - a.length,
  );
}

function normalizedPhraseTerms(terms: string[] | undefined) {
  return Array.from(new Set((terms ?? []).map((term) => term.toLowerCase()).filter((term) => term.length > 0)));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function contextualMatchRanges(value: string, terms: string[]) {
  if (terms.length < 2) return [];

  const phrasePattern = new RegExp(
    `(^|[^A-Za-z0-9])(${terms.map(escapeRegExp).join("[^A-Za-z0-9]+")})(?=$|[^A-Za-z0-9])`,
    "gi",
  );
  const ranges: Array<[number, number]> = [];

  for (const match of value.matchAll(phrasePattern)) {
    const phrase = match[2];
    if (!phrase || match.index === undefined) continue;

    const phraseStart = match.index + (match[1]?.length ?? 0);
    const termPattern = new RegExp(terms.map(escapeRegExp).join("|"), "gi");
    for (const termMatch of phrase.matchAll(termPattern)) {
      if (termMatch.index === undefined) continue;
      ranges.push([
        phraseStart + termMatch.index,
        phraseStart + termMatch.index + termMatch[0].length,
      ]);
    }
  }

  return ranges;
}

function matchRanges(value: string, terms: string[], phraseTerms: string[] = []) {
  const lowerValue = value.toLowerCase();
  const ranges: Array<[number, number]> = [];

  for (const term of terms) {
    let index = lowerValue.indexOf(term);
    while (index !== -1) {
      ranges.push([index, index + term.length]);
      index = lowerValue.indexOf(term, index + term.length);
    }
  }

  ranges.push(...contextualMatchRanges(value, phraseTerms));

  return ranges
    .sort((a, b) => a[0] - b[0])
    .reduce<Array<[number, number]>>((merged, range) => {
      const previous = merged[merged.length - 1];
      if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1]);
      else merged.push([...range]);
      return merged;
    }, []);
}

function highlightedText(
  value: string,
  terms: string[],
  keyPrefix: string,
  phraseTerms: string[] = [],
): ReactNode {
  const ranges = matchRanges(value, terms, phraseTerms);
  if (ranges.length === 0) return value;

  const nodes: ReactNode[] = [];
  let cursor = 0;

  ranges.forEach(([start, end], index) => {
    if (start > cursor) nodes.push(value.slice(cursor, start));
    nodes.push(<mark key={`${keyPrefix}-${index}`}>{value.slice(start, end)}</mark>);
    cursor = end;
  });

  if (cursor < value.length) nodes.push(value.slice(cursor));
  return nodes;
}

function highlightedChildren(
  children: ReactNode,
  terms: string[],
  keyPrefix = "text",
  phraseTerms: string[] = [],
): ReactNode {
  return Children.toArray(children).flatMap((child, index) => {
    const key = `${keyPrefix}-${index}`;
    if (typeof child === "string" || typeof child === "number") {
      return highlightedText(String(child), terms, key, phraseTerms);
    }

    if (isValidElement<{ children?: ReactNode }>(child) && child.props.children) {
      return cloneElement(child, {
        children: highlightedChildren(child.props.children, terms, key, phraseTerms),
      });
    }

    return child;
  });
}

function highlightedSyntaxText(value: string, terms: string[], phraseTerms: string[]): SyntaxNode[] {
  const ranges = matchRanges(value, terms, phraseTerms);
  if (ranges.length === 0) return [{ type: "text", value }];

  const nodes: SyntaxNode[] = [];
  let cursor = 0;

  for (const [start, end] of ranges) {
    if (start > cursor) nodes.push({ type: "text", value: value.slice(cursor, start) });
    nodes.push({
      type: "element",
      tagName: "mark",
      properties: { className: [] },
      children: [{ type: "text", value: value.slice(start, end) }],
    });
    cursor = end;
  }

  if (cursor < value.length) nodes.push({ type: "text", value: value.slice(cursor) });
  return nodes;
}

function highlightedSyntaxNode(node: SyntaxNode, terms: string[], phraseTerms: string[]): SyntaxNode[] {
  if (node.type === "text") return highlightedSyntaxText(String(node.value ?? ""), terms, phraseTerms);
  if (!node.children) return [node];

  return [
    {
      ...node,
      children: node.children.flatMap((child) => highlightedSyntaxNode(child, terms, phraseTerms)),
    },
  ];
}

function syntaxRenderer(terms: string[], phraseTerms: string[]) {
  return ({ rows, stylesheet, useInlineStyles }: SyntaxRendererProps) =>
    rows.flatMap((row, rowIndex) =>
      highlightedSyntaxNode(row, terms, phraseTerms).map((node, nodeIndex) =>
        createSyntaxElement({
          node: node as any,
          stylesheet,
          useInlineStyles,
          key: `${rowIndex}-${nodeIndex}`,
        }),
      ),
    );
}

function CodeBlock({
  children,
  className,
  fallbackLanguage,
  terms,
  phraseTerms,
}: {
  children: ReactNode;
  className?: string;
  fallbackLanguage?: string;
  terms: string[];
  phraseTerms: string[];
}) {
  const code = String(children).replace(/\n$/, "");
  const languageFromClass = className?.match(/language-([A-Za-z0-9_-]+)/)?.[1];
  const language = normalizeLanguage(languageFromClass ?? fallbackLanguage);

  if (!highlightedLanguages.has(language)) {
    return <code className={className}>{highlightedText(code, terms, "code", phraseTerms)}</code>;
  }

  return (
    <SyntaxHighlighter
      CodeTag="code"
      PreTag="span"
      codeTagProps={{ className: className ?? `language-${language}` }}
      customStyle={{
        background: "transparent",
        margin: 0,
        overflow: "visible",
        padding: 0,
      }}
      language={language}
      renderer={syntaxRenderer(terms, phraseTerms)}
      style={oneLight}
      wrapLongLines
    >
      {code}
    </SyntaxHighlighter>
  );
}

function SearchPreview({ markdown, kind, language, highlightTerms, highlightPhraseTerms }: SearchPreviewProps) {
  const terms = normalizedTerms(highlightTerms);
  const phraseTerms = normalizedPhraseTerms(highlightPhraseTerms);
  const heading = ({ children }: { children?: ReactNode }) => (
    <span className="cmdk__md-heading">{highlightedChildren(children, terms, "heading", phraseTerms)}</span>
  );
  const components: Components = {
    a({ children }) {
      return <span className="cmdk__md-link">{highlightedChildren(children, terms, "link", phraseTerms)}</span>;
    },
    h1: heading,
    h2: heading,
    h3: heading,
    h4: heading,
    h5: heading,
    h6: heading,
    blockquote({ children }) {
      return <span className="cmdk__md-quote">{highlightedChildren(children, terms, "quote", phraseTerms)}</span>;
    },
    code({ children, className }) {
      const isBlock = kind === "code" || Boolean(className?.includes("language-"));
      if (isBlock) {
        return (
          <CodeBlock className={className} fallbackLanguage={language} terms={terms} phraseTerms={phraseTerms}>
            {children}
          </CodeBlock>
        );
      }

      return <code className={className}>{highlightedChildren(children, terms, "inline-code", phraseTerms)}</code>;
    },
    em({ children }) {
      return <em>{highlightedChildren(children, terms, "em", phraseTerms)}</em>;
    },
    li({ children }) {
      return <span className="cmdk__md-li">{highlightedChildren(children, terms, "li", phraseTerms)}</span>;
    },
    ol({ children }) {
      return <span className="cmdk__md-list">{children}</span>;
    },
    p({ children }) {
      return <span className="cmdk__md-p">{highlightedChildren(children, terms, "p", phraseTerms)}</span>;
    },
    pre({ children }) {
      return <Fragment>{children}</Fragment>;
    },
    strong({ children }) {
      return <strong>{highlightedChildren(children, terms, "strong", phraseTerms)}</strong>;
    },
    ul({ children }) {
      return <span className="cmdk__md-list">{children}</span>;
    },
  };

  return (
    <ReactMarkdown
      allowedElements={["a", "blockquote", "br", "code", "em", "h1", "h2", "h3", "h4", "h5", "h6", "li", "ol", "p", "pre", "strong", "ul"]}
      components={components}
      unwrapDisallowed
    >
      {markdown}
    </ReactMarkdown>
  );
}

export function renderSearchPreview(container: Element, props: SearchPreviewProps) {
  let root = previewRoots.get(container);
  if (!root) {
    root = createRoot(container);
    previewRoots.set(container, root);
  }
  root.render(<SearchPreview {...props} />);
}

export function unmountSearchPreview(container: Element) {
  const root = previewRoots.get(container);
  if (!root) return;
  root.unmount();
  previewRoots.delete(container);
}

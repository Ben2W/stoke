// Minimal design system for the rig CLI.
// Mirrors apps/website/src/components/CliShowcase.tsx: bold black for the thing
// that matters, dim for muted, blue for prompts and active items, green for ok,
// red for fail. No spinners, no log-update, no boxes. Append-only output that
// looks the same in a TTY, a CI log, or an LLM transcript.

import chalk from "chalk";

const HEX_ACCENT = "#2d4df5";
const HEX_OK = "#1f8b4c";
const HEX_WARN = "#a36b00";
const HEX_ERR = "#b91c1c";

export const accent = (text: string) => chalk.hex(HEX_ACCENT)(text);
export const ok = (text: string) => chalk.hex(HEX_OK)(text);
export const warn = (text: string) => chalk.hex(HEX_WARN)(text);
export const err = (text: string) => chalk.hex(HEX_ERR)(text);
export const dim = (text: string) => chalk.dim(text);
export const bold = (text: string) => chalk.bold(text);

export const sym = {
  prompt: "$",
  arrow: "›",
  active: "▸",
  ok: "✓",
  err: "✗",
  dot: "·",
  ellipsis: "…",
} as const;

export function title(text: string): string {
  return bold(text);
}

export function heading(text: string): string {
  return bold(text);
}

export function muted(text: string): string {
  return dim(text);
}

export function prompt(command: string): string {
  return `${accent(sym.prompt)} ${command}`;
}

export function hint(text: string): string {
  return `${dim(sym.arrow)} ${text}`;
}

export type FileStatus = "created" | "updated" | "kept" | "failed" | "pinned";

const STATUS_WORD_WIDTH = "created".length;

export function fileStatus(kind: FileStatus, label: string): string {
  switch (kind) {
    case "created":
      return `${ok("+")} ${bold(pad("created", STATUS_WORD_WIDTH))}  ${label}`;
    case "updated":
      return `${warn("~")} ${bold(pad("updated", STATUS_WORD_WIDTH))}  ${label}`;
    case "kept":
      return `${dim(sym.dot)} ${dim(pad("kept", STATUS_WORD_WIDTH))}  ${dim(label)}`;
    case "pinned":
      return `${accent("·")} ${bold(pad("pinned", STATUS_WORD_WIDTH))}  ${label}`;
    case "failed":
      return `${err(sym.err)} ${err(pad("failed", STATUS_WORD_WIDTH))}  ${label}`;
  }
}

export type StepKind = "active" | "ok" | "cached" | "err";

export function stepLine(kind: StepKind, label: string, detail?: string): string {
  const tail = detail ? `  ${dim(detail)}` : "";
  switch (kind) {
    case "active":
      return `${accent(sym.active)} ${bold(label)}${tail}`;
    case "ok":
      return `${ok(sym.ok)} ${label}${tail}`;
    case "cached":
      return `${dim(sym.ok)} ${dim(label)}${tail ? `  ${dim("cached")}` : `  ${dim("cached")}`}`;
    case "err":
      return `${err(sym.err)} ${bold(label)}${tail}`;
  }
}

type Cell = { text: string; style?: (text: string) => string };
type Row = Array<string | Cell>;

function toCell(value: string | Cell): Cell {
  return typeof value === "string" ? { text: value } : value;
}

export type ColumnsOptions = {
  // Style the header row as a quiet secondary line. Default true.
  emphasizeHeader?: boolean;
  // Two-space indent in front of each row. Default true.
  indent?: boolean;
};

// Replacement for the old ASCII table. Aligned columns, dim header so the
// bold data underneath carries the eye. Cells may carry their own style.
export function columns(headers: string[], rows: Row[], options: ColumnsOptions = {}): string {
  const indent = options.indent === false ? "" : "  ";
  const emphasizeHeader = options.emphasizeHeader !== false;
  const widths = headers.map((header, index) =>
    Math.max(
      header.length,
      ...rows.map((row) => toCell(row[index] ?? "").text.length),
    ),
  );

  const renderRow = (cells: Cell[], styleFallback?: (text: string) => string): string => {
    const last = cells.length - 1;
    return indent + cells
      .map((cell, index) => {
        const width = widths[index] ?? cell.text.length;
        const style = cell.style ?? styleFallback;
        const styled = style ? style(cell.text) : cell.text;
        if (index === last) return styled;
        const padding = " ".repeat(Math.max(0, width - cell.text.length));
        return `${styled}${padding}  `;
      })
      .join("")
      .replace(/\s+$/u, "");
  };

  const headerCells = headers.map((text) => ({ text }));
  const lines: string[] = [];
  lines.push(renderRow(headerCells, emphasizeHeader ? dim : undefined));
  for (const row of rows) {
    lines.push(renderRow(row.map(toCell)));
  }
  return lines.join("\n");
}

// "key  value" pairs aligned by the longest key. Keys are bold.
export function kvList(pairs: Array<[string, string]>, options: { indent?: boolean } = {}): string {
  const indent = options.indent === false ? "" : "  ";
  const width = pairs.reduce((max, [key]) => Math.max(max, key.length), 0);
  return pairs
    .map(([key, value]) => `${indent}${bold(pad(key, width))}  ${value}`)
    .join("\n");
}

export function section(headingText: string, body: string): string {
  return `${heading(headingText)}\n${body}`;
}

export function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

export function termWidth(stream: NodeJS.WriteStream = process.stderr): number {
  return stream.columns || 80;
}

export function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1))}${sym.ellipsis}` : value;
}

export type DocsOgProps = {
  title: string;
  description: string;
  path: string;
  urlLabel: string;
  figure: {
    name: string;
    src: string;
    alt: string;
    backgroundColor: string;
    filePath: string;
    url: string;
  };
  figureDataUri?: string;
};

function titleSize(title: string) {
  if (title.length <= 18) return 78;
  if (title.length <= 32) return 66;
  if (title.length <= 48) return 56;
  return 48;
}

const GLYPH_WIDTH = 347;
const GLYPH_HEIGHT = 280;
const WATERMARK_VIEWBOX_PADDING_Y = 34;
const WATERMARK_VIEWBOX_HEIGHT = GLYPH_HEIGHT + WATERMARK_VIEWBOX_PADDING_Y * 2;
const WATERMARK_VIEWBOX_WIDTH =
  (WATERMARK_VIEWBOX_HEIGHT * GLYPH_WIDTH) / GLYPH_HEIGHT;
const WATERMARK_VIEWBOX_PADDING_X = (WATERMARK_VIEWBOX_WIDTH - GLYPH_WIDTH) / 2;

function FreestyleGlyph({
  color,
  size,
  padded = false,
}: {
  color: string;
  size: number;
  padded?: boolean;
}) {
  const stroke = Math.max(8, Math.round(size * 0.072));
  const viewBox = padded
    ? `${-WATERMARK_VIEWBOX_PADDING_X} ${-WATERMARK_VIEWBOX_PADDING_Y} ${WATERMARK_VIEWBOX_WIDTH} ${WATERMARK_VIEWBOX_HEIGHT}`
    : `0 0 ${GLYPH_WIDTH} ${GLYPH_HEIGHT}`;

  return (
    <svg
      width={size}
      height={(size * GLYPH_HEIGHT) / GLYPH_WIDTH}
      viewBox={viewBox}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M70 267V235.793C37.4932 229.296 13 200.594 13 166.177C13 134.93 33.1885 108.399 61.2324 98.9148C61.9277 51.3467 100.705 13 148.438 13C183.979 13 214.554 34.2582 228.143 64.7527C234.182 63.4301 240.454 62.733 246.89 62.733C295.058 62.733 334.105 101.781 334.105 149.949C334.105 182.845 315.893 211.488 289 226.343V267"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
      />
      <path
        d="M146 237V267"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
      />
      <path
        d="M215 237V267"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function DocsOgTemplate({
  title,
  description,
  urlLabel,
  figure,
  figureDataUri,
}: DocsOgProps) {
  const size = titleSize(title);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: figure.backgroundColor,
        color: "#071b3a",
        display: "flex",
        flexDirection: "row",
        fontFamily: "Inter",
        padding: 30,
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 30,
          border: "1px solid rgba(43, 126, 237, 0.18)",
          borderRadius: 22,
          display: "flex",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 56,
          top: 62,
          display: "flex",
          gap: 18,
          alignItems: "center",
        }}
      >
        <div
          style={{
            width: 64,
            height: 4,
            background: "rgba(43, 126, 237, 0.32)",
            borderRadius: 999,
            display: "flex",
          }}
        />
        <div
          style={{
            width: 7,
            height: 7,
            background: "rgba(43, 126, 237, 0.42)",
            borderRadius: 999,
            display: "flex",
          }}
        />
        <div
          style={{
            width: 7,
            height: 7,
            background: "rgba(43, 126, 237, 0.42)",
            borderRadius: 999,
            display: "flex",
          }}
        />
      </div>

      <div
        style={{
          width: 610,
          height: "100%",
          padding: "92px 0 48px 58px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          position: "relative",
        }}
      >
        <div
          style={{
            alignItems: "center",
            display: "flex",
            gap: 16,
          }}
        >
          <FreestyleGlyph color="#050f1f" size={40} />
          <div
            style={{
              color: "#082449",
              display: "flex",
              fontSize: 25,
              fontWeight: 600,
            }}
          >
            Rigkit Docs
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 24,
          }}
        >
          <div
            style={{
              color: "#071b3a",
              display: "flex",
              fontSize: size,
              fontWeight: 700,
              lineHeight: 1.02,
              maxWidth: 600,
            }}
          >
            {title}
          </div>
          <div
            style={{
              color: "#30465f",
              display: "flex",
              fontSize: 29,
              lineHeight: 1.38,
              maxWidth: 560,
            }}
          >
            {description}
          </div>
        </div>

        <div
          style={{
            alignItems: "center",
            color: "#07346f",
            display: "flex",
            gap: 18,
            fontSize: 24,
            fontWeight: 600,
          }}
        >
          <span
            style={{
              color: "#2b7eed",
              display: "flex",
              fontSize: 36,
              lineHeight: 1,
            }}
          >
            ↗
          </span>
          {urlLabel}
        </div>
      </div>

      <div
        style={{
          alignItems: "center",
          bottom: 38,
          display: "flex",
          justifyContent: "center",
          position: "absolute",
          right: 48,
          top: 38,
          width: 520,
        }}
      >
        {figureDataUri ? (
          <img
            src={figureDataUri}
            alt={figure.alt}
            style={{
              display: "flex",
              height: 500,
              objectFit: "contain",
              width: 500,
            }}
          />
        ) : null}
      </div>

      <div
        style={{
          bottom: 58,
          display: "flex",
          gap: 16,
          left: 56,
          position: "absolute",
        }}
      >
        {Array.from({ length: 12 }, (_, index) => (
          <div
            key={index}
            style={{
              width: 5,
              height: 5,
              background: "rgba(43, 126, 237, 0.32)",
              borderRadius: 999,
              display: "flex",
            }}
          />
        ))}
      </div>
    </div>
  );
}

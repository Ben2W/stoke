export const docsFigureNames = ["concepts", "configs", "providers"] as const;

export type DocsFigureName = (typeof docsFigureNames)[number];

export type DocsFigureDefinition = {
  src: string;
  backgroundColor: string;
};

export const docsFigures = {
  concepts: {
    src: "concepts.png",
    backgroundColor: "#fefaf7",
  },
  configs: {
    src: "write-config.png",
    backgroundColor: "#fdf6f4",
  },
  providers: {
    src: "providers.png",
    backgroundColor: "#fdf7f3",
  },
} as const satisfies Record<DocsFigureName, DocsFigureDefinition>;

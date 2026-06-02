export const docsFigureNames = ["rocket", "concepts", "configs", "providers"] as const;

export type DocsFigureName = (typeof docsFigureNames)[number];

export type DocsFigureDefinition = {
  src: string;
  backgroundColor: string;
};

export const docsFigures = {
  rocket: {
    src: "rocket.png",
    backgroundColor: "#fbf7f4",
  },
  concepts: {
    src: "rocket.png",
    backgroundColor: "#fefaf7",
  },
  configs: {
    src: "rocket.png",
    backgroundColor: "#fdf6f4",
  },
  providers: {
    src: "rocket.png",
    backgroundColor: "#fdf7f3",
  },
} as const satisfies Record<DocsFigureName, DocsFigureDefinition>;

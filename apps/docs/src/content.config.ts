import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { docsFigureNames } from "./lib/docs-figure-definitions";

const docs = defineCollection({
  loader: glob({
    base: "./src/content/docs",
    pattern: "**/*.{md,mdx}",
    generateId: ({ entry }) => entry.replace(/\.(md|mdx)$/, ""),
  }),
  schema: z.object({
    title: z.string().min(1),
    sidebarTitle: z.string().min(1).optional(),
    description: z.string().min(1),
    figure: z.enum(docsFigureNames),
    noindex: z.boolean().optional(),
  }),
});

export const collections = { docs };

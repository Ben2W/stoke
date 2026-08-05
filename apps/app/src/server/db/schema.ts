import type { ProjectSource } from "@stoke/managed";
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  serial,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("account_user_id_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const deviceCode = pgTable(
  "device_code",
  {
    id: text("id").primaryKey(),
    deviceCode: text("device_code").notNull(),
    userCode: text("user_code").notNull(),
    userId: text("user_id"),
    expiresAt: timestamp("expires_at").notNull(),
    status: text("status").notNull(),
    lastPolledAt: timestamp("last_polled_at"),
    pollingInterval: integer("polling_interval"),
    clientId: text("client_id"),
    scope: text("scope"),
  },
  (table) => [
    uniqueIndex("device_code_device_code_uidx").on(table.deviceCode),
    uniqueIndex("device_code_user_code_uidx").on(table.userCode),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    sourceKey: text("source_key").notNull(),
    source: jsonb("source").$type<ProjectSource>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("projects_user_slug_uidx").on(table.userId, table.slug),
    index("projects_user_source_key_idx").on(table.userId, table.sourceKey),
    index("projects_user_updated_at_idx").on(table.userId, table.updatedAt),
  ],
);

export const devices = pgTable(
  "devices",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("devices_user_last_seen_idx").on(table.userId, table.lastSeenAt)],
);

export const projectCheckouts = pgTable(
  "project_checkouts",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    deviceId: text("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    gitRemote: text("git_remote"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("project_checkouts_device_path_uidx").on(table.deviceId, table.path),
    index("project_checkouts_project_idx").on(table.projectId),
    index("project_checkouts_user_device_idx").on(table.userId, table.deviceId),
  ],
);

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    checkoutId: uuid("checkout_id")
      .notNull()
      .references(() => projectCheckouts.id, { onDelete: "cascade" }),
    deviceId: text("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    operation: text("operation").$type<"plan" | "apply">().notNull(),
    workflow: text("workflow").notNull(),
    fingerprint: text("fingerprint").notNull(),
    status: text("status").$type<"running" | "completed" | "failed" | "orphaned">().notNull(),
    nodeCount: integer("node_count"),
    cachedNodeCount: integer("cached_node_count"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("runs_active_fingerprint_uidx")
      .on(table.projectId, table.checkoutId, table.fingerprint)
      .where(sql`${table.status} = 'running'`),
    index("runs_user_started_at_idx").on(table.userId, table.startedAt),
    index("runs_project_started_at_idx").on(table.projectId, table.startedAt),
  ],
);

export const runEvents = pgTable(
  "run_events",
  {
    id: serial("id").primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("run_events_run_id_id_idx").on(table.runId, table.id)],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  projects: many(projects),
  devices: many(devices),
  projectCheckouts: many(projectCheckouts),
  runs: many(runs),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(user, { fields: [projects.userId], references: [user.id] }),
  checkouts: many(projectCheckouts),
  runs: many(runs),
}));

export const devicesRelations = relations(devices, ({ one, many }) => ({
  user: one(user, { fields: [devices.userId], references: [user.id] }),
  checkouts: many(projectCheckouts),
  runs: many(runs),
}));

export const projectCheckoutsRelations = relations(projectCheckouts, ({ one, many }) => ({
  user: one(user, { fields: [projectCheckouts.userId], references: [user.id] }),
  project: one(projects, { fields: [projectCheckouts.projectId], references: [projects.id] }),
  device: one(devices, { fields: [projectCheckouts.deviceId], references: [devices.id] }),
  runs: many(runs),
}));

export const runsRelations = relations(runs, ({ one, many }) => ({
  user: one(user, { fields: [runs.userId], references: [user.id] }),
  project: one(projects, { fields: [runs.projectId], references: [projects.id] }),
  checkout: one(projectCheckouts, { fields: [runs.checkoutId], references: [projectCheckouts.id] }),
  device: one(devices, { fields: [runs.deviceId], references: [devices.id] }),
  events: many(runEvents),
}));

export const runEventsRelations = relations(runEvents, ({ one }) => ({
  run: one(runs, { fields: [runEvents.runId], references: [runs.id] }),
}));

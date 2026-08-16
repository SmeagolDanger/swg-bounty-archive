import { z } from "zod";

const nullableText = z.string().nullable();
const isoTimestamp = z.iso.datetime({ offset: true });

export const boardSchema = z.object({
  id: z.string().min(1),
  trackerOid: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  valueType: z.enum(["RAW", "CREDITS", "PERCENT", "METERS"]),
  periodStartTime: z.number().int().nonnegative(),
  periodEndTime: z.number().int().positive(),
}).loose();

export const boardCatalogSchema = z.object({
  boards: z.array(boardSchema),
  fetchedAt: isoTimestamp,
}).loose();

export const leaderboardEntrySchema = z.object({
  rank: z.number().int().positive(),
  participantId: z.string().min(1),
  name: z.string(),
  score: z.number().finite(),
  // RAW/CREDITS boards send a decimal string; GCW (PERCENT) boards send the
  // share as a percent string like "7.8584846559953885%".
  scoreRaw: z.string().regex(/^-?\d+(?:\.\d+)?%?$/),
  guildAbbreviation: nullableText,
  faction: nullableText,
  planet: nullableText,
  cityName: nullableText,
}).loose();

export const leaderboardSchema = z.object({
  id: z.string().min(1),
  period: z.enum(["CURRENT", "PREVIOUS_1", "PREVIOUS_2"]),
  subject: z.enum(["player", "guild", "city"]),
  valueType: z.enum(["RAW", "CREDITS", "PERCENT", "METERS"]),
  totalScore: z.number().finite(),
  periodStartTime: z.number().int().nonnegative(),
  periodEndTime: z.number().int().positive(),
  entries: z.array(leaderboardEntrySchema),
  fetchedAt: isoTimestamp,
}).loose().superRefine((value, context) => {
  if (value.periodEndTime <= value.periodStartTime) {
    context.addIssue({ code: "custom", path: ["periodEndTime"], message: "Period must end after it starts" });
  }
  const ids = value.entries.map((entry) => entry.participantId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", path: ["entries"], message: "Duplicate participant in source response" });
  }
});

export const winEntrySchema = z.object({
  rank: z.number().int().positive(),
  participantId: z.string().min(1),
  name: z.string(),
  wins: z.number().int().nonnegative(),
  guildAbbreviation: nullableText,
  faction: nullableText,
  planet: nullableText,
}).loose();

export const winsSchema = z.object({
  id: z.string().min(1),
  cityWins: z.array(winEntrySchema),
  guildWins: z.array(winEntrySchema),
  fetchedAt: isoTimestamp,
}).loose();

export const officerEntrySchema = z.object({
  oid: z.string().min(1),
  name: z.string(),
  factionName: z.string().min(1),
  rankIndex: z.number().int().min(1),
  rankName: z.string().min(1),
  currentGcwPoints: z.number().int().nonnegative(),
  currentPvpKills: z.number().int().nonnegative(),
  lifetimeGcwPoints: z.number().int().nonnegative(),
  lifetimePvpKills: z.number().int().nonnegative(),
  profession: nullableText,
  guildName: nullableText,
  guildAbbreviation: nullableText,
  residentPlanet: nullableText,
  residentCityName: nullableText,
}).loose();

export const officersSchema = z.object({
  faction: z.enum(["IMPERIAL", "REBEL"]),
  officers: z.array(officerEntrySchema),
  totalResults: z.number().int().nonnegative(),
  fetchedAt: isoTimestamp,
}).loose().superRefine((value, context) => {
  const ids = value.officers.map((officer) => officer.oid);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", path: ["officers"], message: "Duplicate officer identity in source response" });
  }
});

export const encounterSchema = z.object({
  timestamp: isoTimestamp,
  outcome: z.enum(["KILL", "FAILED"]),
  hunterName: z.string().min(1),
  targetName: z.string().min(1),
  credits: z.number().int().nonnegative(),
}).loose().superRefine((value, context) => {
  if (value.outcome === "FAILED" && value.credits !== 0) {
    context.addIssue({ code: "custom", path: ["credits"], message: "A failed encounter must have zero source credits" });
  }
});

const hunterAggregateSchema = z.object({
  rank: z.number().int().positive(), name: z.string().min(1), kills: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(), encounters: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(1), creditsEarned: z.number().int().nonnegative(),
}).loose();

const targetAggregateSchema = z.object({
  rank: z.number().int().positive(), name: z.string().min(1), timesKilled: z.number().int().nonnegative(),
  timesSurvived: z.number().int().nonnegative(), encounters: z.number().int().nonnegative(),
  survivalRate: z.number().min(0).max(1),
}).loose();

export const bountySchema = z.object({
  windowDays: z.number().int().positive(),
  summary: z.object({
    kills: z.number().int().nonnegative(), failures: z.number().int().nonnegative(),
    encounters: z.number().int().nonnegative(), successRate: z.number().min(0).max(1),
    creditsPaid: z.number().int().nonnegative(), averageBounty: z.number().nonnegative(),
    distinctHunters: z.number().int().nonnegative(), distinctTargets: z.number().int().nonnegative(),
    largestBounty: encounterSchema.nullable(),
  }).loose(),
  hunters: z.array(hunterAggregateSchema),
  targets: z.array(targetAggregateSchema),
  survivors: z.array(targetAggregateSchema),
  recent: z.array(encounterSchema),
  fetchedAt: isoTimestamp,
}).loose().superRefine((value, context) => {
  if (value.summary.kills + value.summary.failures !== value.summary.encounters) {
    context.addIssue({ code: "custom", path: ["summary"], message: "Kills plus failures does not equal encounters" });
  }
});

// Structure paths whose parser explicitly declares null acceptable. A null
// observed on these paths is never news — young scopes should not alarm the
// first time a nullable field actually carries null.
export const PARSER_NULLABLE_PATHS = new Set([
  "$.entries[].guildAbbreviation", "$.entries[].faction", "$.entries[].planet", "$.entries[].cityName",
  "$.cityWins[].guildAbbreviation", "$.cityWins[].faction", "$.cityWins[].planet",
  "$.guildWins[].guildAbbreviation", "$.guildWins[].faction", "$.guildWins[].planet",
  "$.officers[].profession", "$.officers[].guildName", "$.officers[].guildAbbreviation",
  "$.officers[].residentPlanet", "$.officers[].residentCityName",
  "$.summary.largestBounty",
]);

export type BoardCatalog = z.infer<typeof boardCatalogSchema>;
export type LeaderboardPayload = z.infer<typeof leaderboardSchema>;
export type WinsPayload = z.infer<typeof winsSchema>;
export type BountyPayload = z.infer<typeof bountySchema>;
export type Encounter = z.infer<typeof encounterSchema>;

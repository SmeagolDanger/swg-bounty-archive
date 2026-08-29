import type { EncounterFilters } from "@/lib/data";
import {
  type DossierData, type FeedFilters, type FeedRow, feedEmbed, hunterDossierEmbed, hunterLiteEmbed, notFoundEmbed,
} from "./embeds";
import {
  EPHEMERAL, type Interaction, type InteractionOption, type InteractionResponse, InteractionResponseType, InteractionType, type MessageBody,
} from "./interactions";

// Slash-command definitions and dispatch. The definitions are shared by the
// registration script and the handler so they cannot drift apart. Data access
// is injected so the handler is unit-testable without PostgreSQL.

const STRING = 3, INTEGER = 4;

export const COMMAND_DEFINITIONS = [
  {
    name: "feed",
    description: "Latest bounty encounters from the Outer Rim Ledger archive",
    options: [
      { name: "count", description: "How many encounters (1–15, default 10)", type: INTEGER, min_value: 1, max_value: 15 },
      { name: "hunter", description: "Only encounters involving this name (hunter or target)", type: STRING, max_length: 100 },
      { name: "outcome", description: "Claims or failures only", type: STRING, choices: [{ name: "Claims", value: "KILL" }, { name: "Failures", value: "FAILED" }] },
      { name: "min_credits", description: "Minimum payout in credits", type: INTEGER, min_value: 0 },
    ],
  },
  {
    name: "hunter",
    description: "Hunter dossier: record, boards, rivalries, and recent encounters",
    options: [
      { name: "name", description: "Hunter name (start typing for suggestions)", type: STRING, required: true, autocomplete: true, max_length: 100 },
    ],
  },
];

export interface SearchResult { id: string; participant_type: string; current_name: string }

export interface CommandDeps {
  siteUrl: string;
  searchEntities(q: string, limit?: number): Promise<SearchResult[]>;
  getEncounters(filters: EncounterFilters): Promise<{ rows: FeedRow[]; total: number }>;
  getParticipant(id: string, type: "player"): Promise<DossierData | null>;
  now?: () => Date;
}

export interface HandledInteraction {
  immediate: InteractionResponse;
  // Present when the command was deferred; resolves to the message that
  // replaces Discord's "thinking…" placeholder.
  deferred?: () => Promise<MessageBody>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function optionMap(options: InteractionOption[] | undefined): Map<string, InteractionOption> {
  return new Map((options ?? []).map((option) => [option.name, option]));
}

// searchEntities also matches guild abbreviations and city names; for a
// hunter picker, names that start with or contain the typed text come first.
export function rankByName<T extends { current_name: string }>(rows: T[], query: string): T[] {
  const q = query.toLowerCase();
  const tier = (row: T) => {
    const name = row.current_name.toLowerCase();
    return name.startsWith(q) ? 0 : name.includes(q) ? 1 : 2;
  };
  return rows.map((row, index) => ({ row, index, tier: tier(row) }))
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .map((entry) => entry.row);
}

const ephemeral = (content: string): InteractionResponse => ({ type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, data: { content, flags: EPHEMERAL } });
const deferred = (): InteractionResponse => ({ type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE });

export async function handleInteraction(interaction: Interaction, deps: CommandDeps): Promise<HandledInteraction> {
  if (interaction.type === InteractionType.PING) return { immediate: { type: InteractionResponseType.PONG } };

  if (interaction.type === InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE) {
    const focused = (interaction.data?.options ?? []).find((option) => option.focused);
    const query = String(focused?.value ?? "").trim();
    const results = query ? await deps.searchEntities(query, 50) : [];
    const players = rankByName(results.filter((row) => row.participant_type === "player"), query).slice(0, 25);
    return {
      immediate: {
        type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
        data: { choices: players.map((row) => ({ name: row.current_name.slice(0, 100), value: row.id })) },
      },
    };
  }

  if (interaction.type !== InteractionType.APPLICATION_COMMAND) return { immediate: ephemeral("Unsupported interaction.") };

  const options = optionMap(interaction.data?.options);
  switch (interaction.data?.name) {
    case "feed": return { immediate: deferred(), deferred: () => feedCommand(options, deps) };
    case "hunter": return { immediate: deferred(), deferred: () => hunterCommand(String(options.get("name")?.value ?? ""), deps) };
    default: return { immediate: ephemeral(`Unknown command “${interaction.data?.name ?? "?"}”.`) };
  }
}

async function feedCommand(options: Map<string, InteractionOption>, deps: CommandDeps): Promise<MessageBody> {
  const count = Math.min(15, Math.max(1, Number(options.get("count")?.value ?? 10) || 10));
  const outcomeValue = options.get("outcome")?.value;
  const minCredits = Number(options.get("min_credits")?.value);
  const filters: EncounterFilters & FeedFilters = {
    q: String(options.get("hunter")?.value ?? "").trim().slice(0, 100) || undefined,
    outcome: outcomeValue === "KILL" || outcomeValue === "FAILED" ? outcomeValue : undefined,
    minCredits: Number.isFinite(minCredits) && minCredits > 0 ? Math.floor(minCredits) : undefined,
    page: 1,
    pageSize: 25,
  };
  const result = await deps.getEncounters(filters);
  return { embeds: [feedEmbed(result.rows.slice(0, count), { filters, total: result.total, siteUrl: deps.siteUrl, now: deps.now?.() })] };
}

async function hunterCommand(raw: string, deps: CommandDeps): Promise<MessageBody> {
  const name = raw.trim();
  if (!name) return { content: "Give me a hunter name.", flags: EPHEMERAL };

  let participantId: string | null = UUID.test(name) ? name : null;
  let suggestions: string[] = [];
  if (!participantId) {
    const players = (await deps.searchEntities(name, 50)).filter((row) => row.participant_type === "player");
    const exact = players.find((row) => row.current_name.toLowerCase() === name.toLowerCase());
    participantId = exact?.id ?? null;
    suggestions = players.filter((row) => row !== exact).slice(0, 5).map((row) => row.current_name);
  }

  const dossier = participantId ? await deps.getParticipant(participantId, "player") : null;
  if (dossier) return { embeds: [hunterDossierEmbed(dossier, { siteUrl: deps.siteUrl, now: deps.now?.() })] };
  if (UUID.test(name)) return { embeds: [notFoundEmbed("that selection", [])] };

  // Encounter-only hunters: exact-name match in the log, no board presence.
  const encounters = await deps.getEncounters({ q: name, page: 1, pageSize: 25 });
  const exactRows = encounters.rows.filter((row) => row.hunter_name.toLowerCase() === name.toLowerCase() || row.target_name.toLowerCase() === name.toLowerCase());
  if (exactRows.length) {
    const canonical = exactRows[0].hunter_name.toLowerCase() === name.toLowerCase() ? exactRows[0].hunter_name : exactRows[0].target_name;
    return { embeds: [hunterLiteEmbed(canonical, exactRows, { siteUrl: deps.siteUrl, now: deps.now?.() })] };
  }
  return { embeds: [notFoundEmbed(name, suggestions)] };
}

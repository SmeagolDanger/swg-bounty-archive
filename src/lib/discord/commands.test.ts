import { describe, expect, it, vi } from "vitest";
import { COMMAND_DEFINITIONS, type CommandDeps, handleInteraction } from "./commands";
import { type DossierData, type FeedRow, stripAnsi } from "./embeds";
import { EPHEMERAL, type Interaction, InteractionResponseType, InteractionType } from "./interactions";

const kill: FeedRow = { event_at: "2026-08-13T00:10:09Z", outcome: "KILL", hunter_name: "Bossk", target_name: "Eahi", credits: 29549 };
const dossier: DossierData = {
  participant: { id: "11111111-2222-4333-8444-555555555555", current_name: "Bossk" },
  history: [], encounters: [kill], rivalries: [],
  hunterSummary: { encounters: 1, wins: 1, losses: 0, win_rate: 1, credits: 29549, average_bounty: 29549, highest_bounty: 29549, unique_targets: 1, active_days: 1, first_active_at: kill.event_at, last_active_at: kill.event_at },
  targetSummary: null,
};

function deps(overrides: Partial<CommandDeps> = {}): CommandDeps {
  return {
    siteUrl: "https://jawatracks.com",
    searchEntities: vi.fn(async (q: string) => q.toLowerCase().startsWith("bo")
      ? [{ id: dossier.participant.id, participant_type: "player", current_name: "Bossk" }, { id: "g", participant_type: "guild", current_name: "BOUNTY" }, { id: "2", participant_type: "player", current_name: "Boba" }]
      : []),
    getEncounters: vi.fn(async () => ({ rows: [kill], total: 1 })),
    getParticipant: vi.fn(async (id: string) => id === dossier.participant.id ? dossier : null),
    ...overrides,
  };
}

const command = (name: string, options: Array<{ name: string; value: string | number; focused?: boolean }>, type: number = InteractionType.APPLICATION_COMMAND): Interaction =>
  ({ id: "i", application_id: "app", token: "tok", type, data: { name, options: options.map((o) => ({ ...o, type: typeof o.value === "number" ? 4 : 3 })) } });

describe("slash command handling", () => {
  it("answers Discord's ping", async () => {
    const result = await handleInteraction({ id: "i", application_id: "app", token: "t", type: InteractionType.PING }, deps());
    expect(result).toEqual({ immediate: { type: InteractionResponseType.PONG } });
  });

  it("autocompletes hunter names with players only, using the participant id as the value", async () => {
    const result = await handleInteraction(command("hunter", [{ name: "name", value: "bo", focused: true }], InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE), deps());
    expect(result.immediate.type).toBe(InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT);
    expect(result.immediate.data).toEqual({ choices: [{ name: "Bossk", value: dossier.participant.id }, { name: "Boba", value: "2" }] });
    expect(result.deferred).toBeUndefined();
  });

  it("defers /feed then delivers an embed built from the archive filters", async () => {
    const d = deps();
    const result = await handleInteraction(command("feed", [{ name: "count", value: 5 }, { name: "hunter", value: "Bossk" }, { name: "outcome", value: "KILL" }, { name: "min_credits", value: 1000 }]), d);
    expect(result.immediate.type).toBe(InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE);
    const message = await result.deferred!();
    expect(d.getEncounters).toHaveBeenCalledWith({ q: "Bossk", outcome: "KILL", minCredits: 1000, page: 1, pageSize: 25 });
    expect(message.embeds?.[0].title).toBe("📡 Live feed · last 1 contract · “Bossk” · collected only · ≥ 1,000 cr");
    expect(stripAnsi(message.embeds?.[0].description ?? "")).toMatch(/Bossk +COLLECTED +Eahi +29,549/);
  });

  it("clamps /feed count into 1–15", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ ...kill, target_name: `T${i}` }));
    const d = deps({ getEncounters: vi.fn(async () => ({ rows, total: 25 })) });
    const message = await (await handleInteraction(command("feed", [{ name: "count", value: 99 }]), d)).deferred!();
    expect(stripAnsi(message.embeds?.[0].description ?? "").split("\n").filter((line) => /^\d\d:\d\d  /.test(line))).toHaveLength(15);
  });

  it("resolves /hunter from an autocomplete id", async () => {
    const message = await (await handleInteraction(command("hunter", [{ name: "name", value: dossier.participant.id }]), deps())).deferred!();
    expect(message.embeds?.[0].title).toBe("Bossk");
  });

  it("resolves /hunter from a typed name via exact case-insensitive match", async () => {
    const d = deps();
    const message = await (await handleInteraction(command("hunter", [{ name: "name", value: "bossk" }]), d)).deferred!();
    expect(d.getParticipant).toHaveBeenCalledWith(dossier.participant.id, "player");
    expect(message.embeds?.[0].url).toContain(`/hunter/${dossier.participant.id}`);
  });

  it("falls back to an encounter-derived dossier for hunters missing from the boards", async () => {
    const d = deps({ searchEntities: vi.fn(async () => []) });
    const message = await (await handleInteraction(command("hunter", [{ name: "name", value: "eahi" }]), d)).deferred!();
    expect(message.embeds?.[0].title).toBe("Eahi");
    expect(message.embeds?.[0].description).toMatch(/Off the boards/);
  });

  it("suggests near matches when nothing fits", async () => {
    const d = deps({ getEncounters: vi.fn(async () => ({ rows: [], total: 0 })) });
    const message = await (await handleInteraction(command("hunter", [{ name: "name", value: "Bo" }]), d)).deferred!();
    expect(message.embeds?.[0].title).toBe("No such hunter on file");
    expect(message.embeds?.[0].description).toContain("**Bossk**, **Boba**");
  });

  it("rejects unknown commands ephemerally", async () => {
    const result = await handleInteraction(command("nope", []), deps());
    expect(result.immediate.data).toMatchObject({ flags: EPHEMERAL });
    expect(result.deferred).toBeUndefined();
  });

  it("ranks autocomplete by name match ahead of guild/city trigram hits", async () => {
    const d = deps({ searchEntities: vi.fn(async () => [
      { id: "1", participant_type: "player", current_name: "Apestosa" },
      { id: "2", participant_type: "player", current_name: "Bosslucy" },
      { id: "3", participant_type: "player", current_name: "Lucey Butler" },
    ]) });
    const result = await handleInteraction(command("hunter", [{ name: "name", value: "luc", focused: true }], InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE), d);
    expect((result.immediate.data as { choices: Array<{ name: string }> }).choices.map((c) => c.name)).toEqual(["Lucey Butler", "Bosslucy", "Apestosa"]);
  });

  it("registers exactly the commands it handles, installable to servers and users alike", () => {
    expect(COMMAND_DEFINITIONS.map((c) => c.name).sort()).toEqual(["feed", "hunter"]);
    for (const command of COMMAND_DEFINITIONS) {
      expect(command.integration_types).toEqual([0, 1]);
      expect(command.contexts).toEqual([0, 1, 2]);
    }
  });
});

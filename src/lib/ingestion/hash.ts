import { createHash } from "node:crypto";
import type { Encounter } from "./schemas";

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function sha256(value: string | unknown): string {
  const data = typeof value === "string" ? value : canonicalJson(value);
  return createHash("sha256").update(data).digest("hex");
}

export function encounterFingerprint(encounter: Encounter): string {
  return sha256([
    "swg-legends:bounty-hunting",
    new Date(encounter.timestamp).toISOString(),
    encounter.outcome,
    encounter.hunterName,
    encounter.targetName,
    encounter.credits,
  ]);
}

function visitSchema(value: unknown, path: string, paths: Set<string>): void {
  paths.add(path || "$");
  if (Array.isArray(value)) {
    return;
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      visitSchema(child, path ? `${path}.${key}` : key, paths);
    }
  }
}

export function schemaShape(value: unknown): string[] {
  const paths = new Set<string>();
  visitSchema(value, "", paths);
  return [...paths].sort();
}

export function schemaSignature(value: unknown): { signature: string; paths: string[] } {
  const paths = schemaShape(value);
  return { signature: sha256(paths), paths };
}

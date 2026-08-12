import { createHash } from "node:crypto";
import type { Encounter } from "./schemas";

export type SchemaValueType = "array" | "boolean" | "null" | "number" | "object" | "string";
export type SchemaStructure = Record<string, SchemaValueType[]>;

export interface SchemaTypeChange {
  path: string;
  from: SchemaValueType[];
  to: SchemaValueType[];
}

export interface SchemaDiff {
  addedPaths: string[];
  removedPaths: string[];
  changedTypes: SchemaTypeChange[];
}

const TYPE_ORDER: SchemaValueType[] = ["array", "boolean", "null", "number", "object", "string"];

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

function valueType(value: unknown): SchemaValueType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  return "object";
}

function visitSchema(value: unknown, path: string, structure: Map<string, Set<SchemaValueType>>): void {
  const types = structure.get(path) ?? new Set<SchemaValueType>();
  types.add(valueType(value));
  structure.set(path, types);
  if (Array.isArray(value)) {
    for (const member of value) visitSchema(member, `${path}[]`, structure);
  } else if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record).sort()) {
      visitSchema(record[key], `${path}.${key}`, structure);
    }
  }
}

export function schemaStructure(value: unknown): SchemaStructure {
  const observed = new Map<string, Set<SchemaValueType>>();
  visitSchema(value, "$", observed);
  return Object.fromEntries([...observed.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, types]) => [path, TYPE_ORDER.filter((type) => types.has(type))]));
}

export function schemaShape(value: unknown): string[] {
  return Object.entries(schemaStructure(value)).map(([path, types]) => `${path}:${types.join("|")}`);
}

export function schemaSignature(value: unknown): { signature: string; paths: string[]; structure: SchemaStructure } {
  const structure = schemaStructure(value);
  const paths = Object.entries(structure).map(([path, types]) => `${path}:${types.join("|")}`);
  return { signature: sha256(paths), paths, structure };
}

export function hasUnobservedArrayMembers(structure: SchemaStructure): boolean {
  const paths = Object.keys(structure);
  return Object.entries(structure).some(([path, types]) =>
    types.includes("array") && !paths.some((candidate) => candidate.startsWith(`${path}[]`)),
  );
}

export function diffSchema(previous: SchemaStructure, next: SchemaStructure): SchemaDiff {
  const previousPaths = new Set(Object.keys(previous));
  const nextPaths = new Set(Object.keys(next));
  const unobservedInPrevious = Object.entries(previous)
    .filter(([path, types]) => types.includes("array") && ![...previousPaths].some((candidate) => candidate.startsWith(`${path}[]`)))
    .map(([path]) => `${path}[]`);
  const unobservedInNext = Object.entries(next)
    .filter(([path, types]) => types.includes("array") && ![...nextPaths].some((candidate) => candidate.startsWith(`${path}[]`)))
    .map(([path]) => `${path}[]`);
  const sharedPaths = [...nextPaths].filter((path) => previousPaths.has(path)).sort();
  return {
    addedPaths: [...nextPaths]
      .filter((path) => !previousPaths.has(path) && !unobservedInPrevious.some((prefix) => path.startsWith(prefix)))
      .sort(),
    removedPaths: [...previousPaths]
      .filter((path) => !nextPaths.has(path) && !unobservedInNext.some((prefix) => path.startsWith(prefix)))
      .sort(),
    changedTypes: sharedPaths.flatMap((path) => {
      const from = [...previous[path]].sort((a, b) => TYPE_ORDER.indexOf(a) - TYPE_ORDER.indexOf(b));
      const to = [...next[path]].sort((a, b) => TYPE_ORDER.indexOf(a) - TYPE_ORDER.indexOf(b));
      return from.join("|") === to.join("|") ? [] : [{ path, from, to }];
    }),
  };
}

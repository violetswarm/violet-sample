import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

export interface Entry {
  id: number;
  date: string;
  project: string;
  seconds: number;
  note: string;
}

export type NewEntry = Omit<Entry, "id">;

export function formatDuration(seconds: number): string {
  if (!Number.isSafeInteger(seconds) || seconds < 0) {
    throw new RangeError("seconds must be a nonnegative safe integer");
  }
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function validateEntry(entry: NewEntry): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
    throw new RangeError("date must be a real YYYY-MM-DD calendar date");
  }
  const year = Number(entry.date.slice(0, 4));
  const month = Number(entry.date.slice(5, 7));
  const day = Number(entry.date.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]!) {
    throw new RangeError("date must be a real YYYY-MM-DD calendar date");
  }
  if (typeof entry.project !== "string" || !entry.project.trim() || /[\t\r\n]/.test(entry.project)) {
    throw new RangeError("project must be nonempty and contain no tabs or line breaks");
  }
  if (typeof entry.note !== "string" || !entry.note.trim() || /[\t\r\n]/.test(entry.note)) {
    throw new RangeError("note must be nonempty and contain no tabs or line breaks");
  }
  formatDuration(entry.seconds);
}

export async function loadEntries(file: string): Promise<Entry[]> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`Invalid entries file: ${file}`);
  }
  if (!Array.isArray(value)) {
    throw new Error(`Invalid entries file: ${file}`);
  }
  const seen = new Set<number>();
  for (const item of value) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Invalid entries file: ${file}`);
    }
    const entry = item as Record<string, unknown>;
    if (
      Object.keys(entry).sort().join(",") !== "date,id,note,project,seconds" ||
      typeof entry.id !== "number" || !Number.isSafeInteger(entry.id) || entry.id < 1 ||
      seen.has(entry.id)
    ) {
      throw new Error(`Invalid entries file: ${file}`);
    }
    try {
      validateEntry(entry as unknown as NewEntry);
    } catch {
      throw new Error(`Invalid entries file: ${file}`);
    }
    seen.add(entry.id as number);
  }
  return value as Entry[];
}

export async function addEntry(file: string, input: NewEntry): Promise<Entry> {
  validateEntry(input);
  const path = resolve(file);
  const lock = `${path}.lock`;
  try {
    await mkdir(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`Another writer holds the entries lock: ${lock}`);
    }
    throw error;
  }
  try {
    const entries = await loadEntries(path);
    const id = entries.reduce((max, entry) => Math.max(max, entry.id), 0) + 1;
    if (!Number.isSafeInteger(id)) {
      throw new RangeError("entry IDs exhausted");
    }
    const entry = { id, ...input };
    const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify([...entries, entry], null, 2) + "\n", { flag: "wx" });
      await rename(temporary, path);
    } catch (error) {
      try {
        await unlink(temporary);
      } catch (cleanupError) {
        if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") {
          throw cleanupError;
        }
      }
      throw error;
    }
    return entry;
  } finally {
    await rmdir(lock);
  }
}

export function summarize(entries: readonly Entry[]): { project: string; seconds: number }[] {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    const total = (totals.get(entry.project) ?? 0) + entry.seconds;
    if (!Number.isSafeInteger(total)) {
      throw new RangeError("project duration exceeds safe integer range");
    }
    totals.set(entry.project, total);
  }
  return [...totals].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([project, seconds]) => ({ project, seconds }));
}

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addEntry, formatDuration, loadEntries, summarize, validateEntry } from "./entries.ts";
import { main } from "./cli.ts";

const directories: string[] = [];
async function fixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "violet-entries-"));
  directories.push(directory);
  return join(directory, "entries.json");
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const input = { date: "2024-02-29", project: "violet", seconds: 3600, note: "ship CLI" };

describe("duration and validation", () => {
  test("minutes-only boundaries and safe integer constraint", () => {
    expect(formatDuration(0)).toBe("0m 0s");
    expect(formatDuration(59)).toBe("0m 59s");
    expect(formatDuration(60)).toBe("1m 0s");
    expect(formatDuration(3600)).toBe("60m 0s");
    expect(formatDuration(Number.MAX_SAFE_INTEGER)).toBe("150119987579016m 31s");
    for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => formatDuration(value)).toThrow(RangeError);
    }
  });

  test("strict real date and nonempty text", () => {
    for (const date of ["2023-02-29", "2024-02-30", "2024-13-01", "2024-00-01", "2024-01-00", "2024-1-01", "0000-02-29", "2024-01-01T00:00:00Z"]) {
      expect(() => validateEntry({ ...input, date })).toThrow(RangeError);
    }
    expect(() => validateEntry({ ...input, date: "2000-02-29" })).not.toThrow();
    expect(() => validateEntry({ ...input, date: "1900-02-29" })).toThrow(RangeError);
    for (const project of ["", "   ", "bad\tproject", "bad\rproject", "bad\nproject"]) expect(() => validateEntry({ ...input, project })).toThrow(RangeError);
    for (const note of ["", "\t", "bad\tnote", "bad\rnote", "bad\nnote"]) expect(() => validateEntry({ ...input, note })).toThrow(RangeError);
  });
});

test("missing storage starts empty, saves monotonic IDs and deterministic totals", async () => {
  const file = await fixture();
  expect(await loadEntries(file)).toEqual([]);
  expect(await addEntry(file, input)).toEqual({ id: 1, ...input });
  expect(await addEntry(file, { ...input, project: "alpha", seconds: 59 })).toMatchObject({ id: 2 });
  expect(await addEntry(file, { ...input, seconds: 60 })).toMatchObject({ id: 3 });
  const entries = await loadEntries(file);
  expect(entries.map(({ id }) => id)).toEqual([1, 2, 3]);
  expect(summarize(entries)).toEqual([{ project: "alpha", seconds: 59 }, { project: "violet", seconds: 3660 }]);
  expect(await readdir(join(file, ".."))).toEqual(["entries.json"]);
});

test("corrupt storage rejects without overwrite or temp artifact", async () => {
  const file = await fixture();
  for (const corrupt of ["{", "{}", "[null]", '[{"id":1}]', JSON.stringify([{ id: 1, ...input }, { id: 1, ...input }])]) {
    await writeFile(file, corrupt);
    await expect(loadEntries(file)).rejects.toThrow("Invalid entries file");
    await expect(addEntry(file, input)).rejects.toThrow("Invalid entries file");
    expect(await readFile(file, "utf8")).toBe(corrupt);
    expect(await readdir(join(file, ".."))).toEqual(["entries.json"]);
  }
});

test("IDs advance from maximum even when records are out of order", async () => {
  const file = await fixture();
  await writeFile(file, JSON.stringify([{ id: 8, ...input }, { id: 2, ...input }]));
  expect((await addEntry(file, input)).id).toBe(9);
});

test("project totals reject overflow", () => {
  expect(() => summarize([
    { id: 1, ...input, seconds: Number.MAX_SAFE_INTEGER },
    { id: 2, ...input, seconds: 1 },
  ])).toThrow(RangeError);
});

test("CLI adds, lists by ID, and summarizes in project order", async () => {
  const file = await fixture();
  const lines: string[] = [];
  const log = spyOn(console, "log").mockImplementation((line: string) => { lines.push(line); });
  try {
    await main(["--file", file, "add", "2024-02-29", "zeta", "3600", "first"]);
    await main(["--file", file, "add", "2024-02-29", "alpha", "59", "second"]);
    expect(lines).toEqual([
      "1\t2024-02-29\tzeta\t60m 0s\tfirst",
      "2\t2024-02-29\talpha\t0m 59s\tsecond",
    ]);
    lines.length = 0;
    await main(["--file", file, "list"]);
    expect(lines).toEqual([
      "1\t2024-02-29\tzeta\t60m 0s\tfirst",
      "2\t2024-02-29\talpha\t0m 59s\tsecond",
    ]);
    lines.length = 0;
    await main(["--file", file, "summary"]);
    expect(lines).toEqual(["alpha\t0m 59s", "zeta\t60m 0s"]);
    for (const args of [
      ["--file", file, "add", "2024-02-30", "alpha", "1", "invalid date"],
      ["--file", file, "add", "2024-02-29", "alpha", "-1", "invalid seconds"],
      ["--file", file, "add", "2024-02-29", "alpha", "9007199254740992", "too large"],
      ["--file", file, "list", "extra"],
      ["--file", file, "unknown"],
    ]) {
      await expect(main(args)).rejects.toThrow();
    }
    expect((await loadEntries(file)).length).toBe(2);
  } finally {
    log.mockRestore();
  }
});

test("existing writer lock explicitly rejects a competing process without altering entries", async () => {
  const file = await fixture();
  await mkdir(`${file}.lock`);
  const competing = Bun.spawn([process.execPath, "run", "src/cli.ts", "--file", file, "add", "2024-02-29", "violet", "60", "contender"], {
    cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe",
  });
  const [exit, stderr] = await Promise.all([competing.exited, new Response(competing.stderr).text()]);
  expect(exit).not.toBe(0);
  expect(stderr).toContain("Another writer holds the entries lock");
  expect(await loadEntries(file)).toEqual([]);
  await rmdir(`${file}.lock`);
  const successful = Bun.spawn([process.execPath, "run", "src/cli.ts", "--file", file, "add", "2024-02-29", "violet", "60", "winner"], {
    cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe",
  });
  const [success, stdout] = await Promise.all([successful.exited, new Response(successful.stdout).text()]);
  expect(success).toBe(0);
  expect(stdout).toContain("1\t2024-02-29\tviolet\t1m 0s\twinner");
  expect((await loadEntries(file)).map(({ id, note }) => ({ id, note }))).toEqual([{ id: 1, note: "winner" }]);
});

test("simultaneous CLI writers never both report success without both entries", async () => {
  const file = await fixture();
  const run = (note: string) => Bun.spawn([process.execPath, "run", "src/cli.ts", "--file", file, "add", "2024-02-29", "violet", "1", note], {
    cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe",
  });
  const first = run("first");
  const second = run("second");
  const results = await Promise.all([first, second].map(async (process) => ({
    exit: await process.exited,
    stdout: await new Response(process.stdout).text(),
    stderr: await new Response(process.stderr).text(),
  })));
  const entries = await loadEntries(file);
  const successes = results.filter(({ exit }) => exit === 0);
  expect(entries).toHaveLength(successes.length);
  expect(entries.map(({ id }) => id)).toEqual(entries.length === 2 ? [1, 2] : [1]);
  expect(entries.map(({ note }) => note).sort()).toEqual(successes.map(({ stdout }) => stdout.trim().split("\t")[4]!).sort());
  for (const result of results.filter(({ exit }) => exit !== 0)) {
    expect(result.stderr).toContain("Another writer holds the entries lock");
  }
});

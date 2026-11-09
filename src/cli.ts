import { addEntry, formatDuration, loadEntries, summarize } from "./entries.ts";

function usage(): never {
  throw new Error("Usage: bun run src/cli.ts --file PATH add DATE PROJECT SECONDS NOTE | list | summary");
}

export async function main(args: string[]): Promise<void> {
  if (args.length < 3 || args[0] !== "--file" || !args[1]) {
    usage();
  }
  const [file, command, ...rest] = args.slice(1);
  if (command === "add") {
    if (rest.length !== 4 || !/^(0|[1-9]\d*)$/.test(rest[2]!)) {
      usage();
    }
    const entry = await addEntry(file!, {
      date: rest[0]!, project: rest[1]!, seconds: Number(rest[2]), note: rest[3]!,
    });
    console.log(`${entry.id}\t${entry.date}\t${entry.project}\t${formatDuration(entry.seconds)}\t${entry.note}`);
  } else if (command === "list") {
    if (rest.length) {
      usage();
    }
    for (const entry of (await loadEntries(file!)).sort((a, b) => a.id - b.id)) {
      console.log(`${entry.id}\t${entry.date}\t${entry.project}\t${formatDuration(entry.seconds)}\t${entry.note}`);
    }
  } else if (command === "summary") {
    if (rest.length) {
      usage();
    }
    for (const { project, seconds } of summarize(await loadEntries(file!))) {
      console.log(`${project}\t${formatDuration(seconds)}`);
    }
  } else {
    usage();
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

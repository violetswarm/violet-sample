# violet-sample

Public Bun fixture for testing Violet's agent and pull-request workflow.

`formatDuration(seconds)` accepts nonnegative safe integer seconds and returns
`<minutes>m <seconds>s` without an hour unit. For example, `formatDuration(3600)`
returns `60m 0s`. Invalid values throw `RangeError`.

## Run locally

Use Bun 1.4.4:

```sh
bun install --frozen-lockfile
bun run test
bun run typecheck
```

## Time entries

Each command requires an explicit JSON file path. Missing files start empty; `add`
creates or atomically replaces the file. An invalid existing file fails without
overwriting it. Entries retain ascending numeric IDs; `list` displays ID order,
and `summary` displays project totals in project-name order.

```sh
bun run src/cli.ts --file ./entries.json add 2024-02-29 violet 3600 "Ship CLI"
bun run src/cli.ts --file ./entries.json list
bun run src/cli.ts --file ./entries.json summary
```

Dates must be real calendar dates written `YYYY-MM-DD`; project and note must be
nonempty, and seconds must be a nonnegative safe integer. Each output row is
tab-separated. `add` and `list` emit `id date project duration note`; `summary`
emits `project duration`. Duration always uses minutes and seconds, even above
one hour. Invalid arguments or corrupt storage cause a nonzero exit.

## Future smoke change

A future agent task can request hour formatting (for example, `3600` as
`1h 0m 0s`). This is a requested future behavior, **not** supported now.

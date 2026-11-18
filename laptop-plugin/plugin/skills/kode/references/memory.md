# Project memory

The memory is the guide every task starts from. It says what the project is, where its code lives, how to run it, what it runs on and how work is laid out. Read it before anything else, and keep it true as the project changes: a task that changes the project updates the memory in the same session.

## The sections

Eight sections belong to the team, in reading order; `open-work` is yours alone. A section holds markdown of at most 16 KiB. When a project has several components or repositories, a section has one heading or one bullet for each.

| Section | Holds | Never holds |
|---|---|---|
| `architecture` | Each component: what it does, what it calls or listens to, where it runs (the environment service or the cluster), and which repository and path hold it. Where the data lives. | Design history, options that were rejected. |
| `sources` | Each repository: its URL, default branch, path in a workspace (`~/workspace/<repo>`), submodules, the components it holds, how a change leaves it (push or pull request) and the order in which repositories that depend on each other are changed. | Tokens, commit ids. |
| `run` | For each component: the packages, then the commands to build, test, run and ship it, the ports, and the traps (`export CC=gcc`). | Logs of one run. |
| `environments` | Each environment: the `volume@branch` it starts from, each service with its image, port and mounts, the seed data, what is safe to reset and how, and which services are usually intercepted. | Who is connected now; live state. |
| `volumes` | Each volume: what is inside, its packages, labels, the branch to start from (`shop-api@base`), the secrets its variables reference (by name), and how `base` is kept fresh. | Credentials, commit numbers. |
| `desks` | The layout of work: each kind of desk, the work it is for, the workspaces on it (`name` from `volume@branch`), the environment it connects to, and how work that spans components is placed. | Live desks, workspaces or ids. |
| `conventions` | The team's rules: names, branches, commits, reviews, migrations, how to ship, where credentials live, and what needs a yes from the person. | A decision about one task. |
| `plan` | The plan the team agreed: its goal, each step with its state (`todo`, `doing`, `done`) and owner, the decisions, and the open questions. Removed when the plan is done. | A proposal not yet agreed (that is `open-work`). |
| `open-work` (yours) | Each unfinished item: the branch to resume from (`shop-api@wip-auth`) and what is left; a proposal waiting for the person's yes. | Anything the team relies on. |

## Starting a task from the memory

1. `memory` `read`, all sections.
2. `architecture` and `sources`: which component the task touches, and which repository and path hold it.
3. `run`: the packages and the commands to build and test it.
4. `desks`, `volumes` and `environments`: which desk to use, which base to restore each workspace from, and which environment to connect.
5. `conventions`: the rules for names, branches, commits and what needs a yes.
6. `plan` and `open-work`: whether the task is a step of an agreed plan, and whether a `wip-` branch already holds part of it.

When a section the task needs is empty or wrong, fix the memory first: ask the person what is missing, then write it. That is step zero of the task, never a footnote at its end.

## When there is no memory: brainstorm, draft, then start

The memory is empty and `volume` `list` with the project label finds nothing. Make nothing yet.

1. **Brainstorm with the person.** Ask in one message, the questions grouped, and accept "not sure":
   - What the project is and its components.
   - The repositories: URL, default branch, which component each holds, and how changes are merged.
   - How each component is built, tested and run, and how it ships.
   - The services it needs (databases, queues, caches), which data must survive a reset, and what seed data a test needs.
   - How work should be laid out: which components get their own base, which desks, which environment each connects to.
   - The team's rules: commit author, branch policy, what needs approval, where secrets are kept.
2. **Check the answers against the code.** Read each repository's README, manifests, compose file and CI. Where the code and the answer disagree, ask.
3. **Write the initial draft.** Every section that has content, each with `if_version` 0. Write what is known; a line `unknown: <question>` marks what is not. `plan` holds the first steps: the volumes and environments to create.
4. **Show the draft to the person** and correct it. Nothing is created before they agree.
5. **Then start.** Create what the draft names (use case 13 in `use-cases.md`), and change `volumes`, `environments` and `plan` as each thing comes to exist.

## Keeping it current

At the end of every task, for each change the task made to the project, patch its section in the same session:

| The task | Patch |
|---|---|
| Added, removed or rewired a component | `architecture` |
| Added a repository, or changed a branch rule or the merge order | `sources` |
| Changed a command, a package or a port | `run` |
| Made, changed or removed an environment or its seed data | `environments` |
| Made a volume, moved `base`, changed what a base holds | `volumes` |
| Changed which desks or workspaces a kind of work uses | `desks` |
| Agreed a rule with the person | `conventions` |
| Finished, started or changed a step of the plan | `plan` |
| Left work unfinished | `open-work` |

A stale line is worse than a missing one: remove what no longer exists. Only the coordinator writes; a worker says in its `REPORT.md` what changed for the memory, and the coordinator patches it.

## Writing rules

- Present tense: what is, never what happened.
- Inside a section, headings are `###`: the merged read puts each section under its own `##`.
- What is not known yet is a line `unknown: <question>`, never a guess.
- Names, not ids. Branches, not commit numbers. Secrets by name, never a value.
- Patch with `edits` and the `if_version` of your read; full `content` only for a new section. On a `409`, merge with the current text and write again.
- Each tool answer carries `memory: {rev, changed}`; when `changed` is true, read again before you rely on it.

## Example: a complete memory

A shop with a Next.js storefront, a Go API and a Python worker, in two repositories. Each block is the content of one section.

**`architecture`**
```markdown
- `web`: the Next.js storefront. Calls `api` over HTTP (`API_URL`). Runs in `shop-dev` as `web:3000`. Repository `shop-web`.
- `api`: the Go API for products, carts and orders. Reads and writes `db`; publishes `order.created` to `queue`. Runs in `shop-dev` as `api:8080`. Repository `shop-api`, `cmd/api`.
- `worker`: consumes `order.created` and sends mail through `mail`. Runs in `shop-dev` as `worker`. Repository `shop-api`, `worker/`.
- Data: `db` (Postgres) holds products, carts and orders; `queue` (Redis streams) holds nothing that must survive a reset.
```

**`sources`**
```markdown
- `github.com/acme/shop-api` (`main`) at `~/workspace/shop-api`: `api` and `worker`. Pull requests into `main`, squash merge.
- `github.com/acme/shop-web` (`main`) at `~/workspace/shop-web`: `web`. It reads the API's `openapi.yaml`: change `shop-api` first, then `shop-web`.
```

**`run`**
```markdown
- `api`: packages `go_1_23`, `golangci-lint`. `make test` (needs `db` from the desk's environment), `make lint`, `go run ./cmd/api` on 8080.
- `worker`: packages `python312`, `uv`. `uv run pytest`; `uv run python -m worker`.
- `web`: packages `nodejs_22`, `pnpm`. `pnpm test`; `pnpm dev` on 3000 with `API_URL=http://api:8080`.
- Ship: merge to `main`; CI builds and deploys. Nothing deploys from a workspace.
```

**`environments`**
```markdown
- `shop-dev` from `shop-env@base`:
  - `db`: postgres:16 on 5432, mount `pg` at /var/lib/postgresql/data, seeded with 200 products.
  - `queue`: redis:7 on 6379.
  - `api`: ghcr.io/acme/shop-api:main on 8080. `worker`: ghcr.io/acme/shop-worker:main.
  - `web`: ghcr.io/acme/shop-web:main on 3000. `mail`: mailpit on 1025 (web 8025).
  - Reset: `env` `restore` from `shop-env@base`. Usually intercepted: `api` for backend work, `web` for frontend work.
- A test that breaks data clones `shop-dev` first (`env` `create` with `source`) and deletes the copy after.
```

**`volumes`**
```markdown
- `shop-api` (label `shop`): `shop-api` with Go modules and the build cache warm. Start from `@base`. Variables reference `GITHUB_TOKEN`. Refreshed nightly by the pipeline `refresh-shop-api`.
- `shop-web` (label `shop`): `shop-web` with `node_modules`. Start from `@base`.
- `shop-env` (label `shop`): the data of `shop-dev`. `@base` is the seeded catalogue with no orders.
- `shop-test` (labels `shop`, `test`): the fixture for the end-to-end suite.
```

**`desks`**
```markdown
- `api` desk: a workspace `shop-api` from `shop-api@base`, connected to `shop-dev`; intercept `api` or `worker` to test. Backend and worker work.
- `web` desk: a workspace `shop-web` from `shop-web@base`, connected to `shop-dev`; intercept `web`. Frontend work.
- Work across both (an endpoint and its page): one `api` desk holding both workspaces; the API is done and intercepted before the page starts.
```

**`conventions`**
```markdown
- Workspaces are named after their repository (`shop-api`); clones `<repo>-<stream>`. Branches `feat/<topic>`, deleted once merged.
- Commits: imperative subject, no AI or tool reference.
- Migrations are additive; a destructive one needs a yes from the person.
- Secrets live in the team's secrets, never in a home folder or a snapshot.
```

**`plan`**
```markdown
Payments, agreed with the person:
1. done: `api` `POST /payments` against the provider stub.
2. doing: `worker` retries failed captures (`shop-api@wip-capture-retry`).
3. todo: `web` checkout page.
Open: are refunds in scope?
```

**`open-work`** (yours)
```markdown
- `shop-api@wip-capture-retry`: retries pass their tests; the dead-letter queue is left.
```

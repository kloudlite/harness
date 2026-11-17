# Choosing the model for an agent

Each agent runs on one model. The model decides how well the agent judges, how fast it works and what it costs. Pick it per agent, from what the agent must decide, not from how much work it has.

## Model classes

Sort the models that the host offers into four classes by capability. Names and versions change; the class is what you choose by.

| Class | What it is | Give it |
|---|---|---|
| **Deep** | The most capable model the host offers; the slowest and the most expensive | Deep design: the architecture of a new system, a data model, protocol or API that is hard to change later, the plan of a cross-cutting change, a security design, a hard problem that a strong model already failed to solve |
| **Strong** | A high-capability model, faster and cheaper than deep | The coordinator, always. Writing the plan file and its contracts, integrating streams, reviewing or auditing work, debugging when the cause is unknown, any work whose output other agents build on |
| **Standard** | A balanced model | A worker with a clear task: implement against a contract, write and fix tests, edit named files, write docs |
| **Light** | The fastest and cheapest model | Mechanical work that a command can verify: rename across files from a list, regenerate fixtures, format, run a test matrix and report the results, collect logs, search and summarise |

## How to choose

1. **Match the hardest decision, not the size.** A thousand-file rename is light. A twenty-line change to a lock protocol is strong.
2. **A clear contract and a "done" command lower the class.** Ambiguity, trade-offs and design raise it.
3. **The coordinator never runs below strong.** It judges every other agent's work.
4. **Deep design is a separate agent.** The coordinator writes a design brief: the question, the constraints, the contracts that already exist, what the answer must contain. The design agent reads code and data, changes nothing, and returns one file (`DESIGN.md`) with the options, the choice and its reasons. The coordinator reads it, decides, and only then writes the plan file for the workers.
5. **Escalate after a failure, do not retry.** A worker that failed its "done" twice on the same problem goes up one class with the failure in its task. Work that turned out mechanical goes down one class next time.
6. **Name the class in the plan and the task.** The plan's stream table has a model column, and the task says the class. `REPORT.md` says which model ran, under "Budget spent".
7. **Spend where it is hard to undo.** A deep agent costs many times a light one. Use it for decisions that are expensive to change later, not for volume.

## Mapping classes to a host's models

Read which models the host offers (the agent tool's `model` argument, the provider list, or the runtime's model settings) and put each in a class by its capability: the most capable is deep, the next strong, then standard, then light. For example, with Anthropic's models today: the Mythos tier is deep, Opus strong, Sonnet standard, Haiku light. With fewer than four, merge from the bottom: light work goes to standard. A host that lets you pick no model is used as it is; say so in the plan.

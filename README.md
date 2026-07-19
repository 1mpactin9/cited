# Student Research & Study Agent

An AI agent built for students — a guide for the full academic workflow, from
first idea to final review. It doesn't write your work for you. It helps you
think it through, check it, and understand it, with everything grounded in
real, traceable sources.

Available as a **plugin** for existing AI chat platforms today, evolving into
a standalone **SDK** and eventually a fully native application.

---

## What It Does

The agent is organized around **skills** — focused, reliable capabilities
that each handle one part of the academic process. Skills can be chained
together (research → outline → draft → review) or used on their own.

## Skills

### Ideation & Direction
| Skill | What it does |
|---|---|
| `scope` | Narrows a broad topic or assignment into a workable, well-bounded focus. |
| `brainstorm` | Generates and expands ideas, angles, or approaches to a problem or prompt. |
| `build` | Takes an idea or outline and develops it into a fuller piece of work. |

### Research & Verification
| Skill | What it does |
|---|---|
| `research` | Finds credible sources and turns them into usable, cited material. |
| `deep-research` | Extended, multi-source research for larger projects — broader coverage, deeper verification. |
| `verify` | Checks a specific claim or statement against real sources. |
| `trace` | Follows a claim back to its original source and shows the full chain. |

### Structure & Planning
| Skill | What it does |
|---|---|
| `outline` | Turns a topic into a structured outline — thesis, sections, sub-points. |
| `plan` | Breaks a larger project into steps, milestones, and a realistic timeline. |
| `organize` | Restructures existing notes, sources, or drafts into a coherent order. |

### Argument & Position
| Skill | What it does |
|---|---|
| `state` | Clearly articulates a position, thesis, or claim before it's argued. |
| `attack` | Stress-tests an argument by raising the strongest objections to it. |
| `counter` | Builds a rebuttal to a specific objection or opposing argument. |
| `concede` | Identifies where a position is genuinely weak and should be qualified or revised. |

### Review & Feedback
| Skill | What it does |
|---|---|
| `review` | Critiques a draft's structure, argument, clarity, and tone. |
| `clarify` | Rewrites or explains unclear passages so they read the way they were meant to. |
| `flag` | Marks unsupported claims, weak reasoning, or risky assumptions for the student to address. |

### Understanding & Synthesis
| Skill | What it does |
|---|---|
| `summarize` | Condenses a source or set of notes while preserving attribution. |
| `synthesize` | Combines multiple sources or ideas into a single, coherent thread. |
| `define` | Explains a term or concept clearly, at whatever depth is needed. |
| `learn` | Breaks down a concept for understanding, adjustable from simple to advanced. |

### Practice & Retention
| Skill | What it does |
|---|---|
| `practice` | Generates practice questions, problems, or recall exercises from the student's material. |

---

## Core Principle: No AI Slop

Every research-backed skill runs through the same standard: nothing is
presented as fact without a source, nothing is kept if it can't be verified,
and nothing is handed to the student as "finished" — only as a strong,
honest starting point. See [`ETHICS.md`](./docs/ETHICS.md) and
[`RESPONSIBLE_USE.md`](./docs/RESPONSIBLE_USE.md) for the principles behind this.

## Documentation

- [`ETHICS.md`](./docs/ETHICS.md) — the ethical commitments behind the product
- [`PRODUCT.md`](./docs/PRODUCT.md) - about the product
- [`RESPONSIBLE_USE.md`](./docs/RESPONSIBLE_USE.md) — what the product is and isn't meant for, and guidance for using it well
- [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) — expected behavior for anyone contributing to or building on this project
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — how to contribute
- [`SECURITY.md`](./SECURITY.md) — how to report security issues
- [`LICENSE.md`](./LICENSE.md) — usage terms

## Status

Early stage. Currently shipping as a plugin; SDK and native app are planned
future stages. Expect this documentation to evolve alongside the product.

---
name: natural-cadence-editor
description: >-
  Audits and rewrites prose that stumbles when read aloud, such as stacked
  clauses, repeated word stems and prefixes, and accidental alliteration. Use
  whenever writing or editing any copy in this repository, including README
  files, technical documentation, changelogs, release notes, and UI copy. Also
  use when auditing drafts that sound stiff or robotic, or when the user asks
  to make text sound natural, untangle a sentence, or fix clunky phrasing.
---

# Natural Cadence Editor

A skill for auditing and rewriting prose that suffers from dense machine-generated syntactic clustering, accidental alliteration, and phonetic friction.

## When to Use

- Editing technical documentation, changelogs, release notes, or UI copy.
- Auditing AI-generated drafts that sound stiff, robotic, or awkward when read aloud.
- User asks to "make this sound natural", "untangle this sentence", or "fix clunky phrasing."
- Writing or revising any prose in this repository, including the README and technical docs.

## Core Principles

### 1. The Subvocalization Test
Before finalizing any sentence, simulate reading it aloud. If a sentence causes vocal stumbling or requires a second pass to parse which word modifies what, break it apart or vary the vocabulary.

### 2. Stem & Prefix De-duplication
Avoid repeating the same morphological root or prefix within a single clause or sentence:
- **Red flag:** "A **re**run after a **re**load now also **re**runs the sections it **re**ads from."
- **Root cause:** Clustering noun/verb homonyms (*rerun* / *reruns*) and prefix repeats (*re-*).
- **Fix:** Replace redundant stems with distinct operational verbs (*runs again*, *updates*, *fetches*, *reads from*).

### 3. Decompress Clause Stacking
AI models often try to pack four variables into one breath:
`[Action A] + [Precondition B] + [Action C] + [Target D]`

Decompress into **Cause -> Effect** or separate the trigger from the outcome:
- **Compressed:** *"A rerun after a reload now also reruns the sections it reads from."*
- **Decompressed:** *"When you reload and run again, dependent input sections are also refreshed."*

## Review Checklist

When scanning drafts, check for these three specific failure modes:

| Failure Mode | Warning Signs | Correction Rule |
| :--- | :--- | :--- |
| **Stem Clustering** | 3+ words sharing prefixes (*re-*, *de-*, *un-*) or roots in < 15 words | Swap 1-2 words for clean synonyms. |
| **Noun/Verb Echoing** | Using the exact same word as both subject and verb (*"A rerun... reruns"*) | Convert the subject to a gerund or change the action verb. |
| **Alliterative Jam** | Unintentional strings of similar plosives, liquids or sibilants (*p*, *r*, *l*, *s*) | Read rhythmically; introduce contrasting consonant sounds. |

## Quick Transformation Patterns

- **Release note pattern:**
  - *Draft:* "The builder build builds broken builds."
  - *Fix:* "The build system now handles previously failing builds correctly."

- **State machine / reactive pattern:**
  - *Draft:* "A rerun after a reload now also reruns the sections it reads from."
  - *Fix:* "After a reload, running again now updates every upstream input section."

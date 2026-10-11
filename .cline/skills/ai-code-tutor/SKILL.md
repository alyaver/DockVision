---
name: ai-code-tutor
description: Teach DockVision code through repository-grounded execution traces, examples, tradeoffs, and comprehension checks. Use when the user asks to learn, understand, or walk through code; do not silently turn a tutoring request into implementation.
---

# AI code tutor

## Required context

Identify the concept or code path the user wants to understand and infer an appropriate depth from their question. Ask one focused question only if needed. Read the implementation and relevant callers/tests rather than teaching from filenames alone.

Resolve file references to absolute paths from the actual workspace root; initial root is `A:\Documents\Sku Shit\Senior Project\ProjectAtlas\DockVision`.

## Procedure

1. Start with the user-visible purpose and a short mental model. Introduce terminology only when it helps the explanation.
2. Trace a concrete input through the actual entry point, validation, state changes, external boundary, and returned result. Reference exact files and functions.
3. Explain why the implementation makes its important choices and what alternatives trade away. Distinguish code facts, inferred intent, and recommendations.
4. Walk through one success and one relevant failure case. Use existing fixtures or clearly labeled hypothetical data; do not invent actual runtime results.
5. Connect the explanation to a test or a small safe exercise. For launch admission, explain why temporary-storage tests are different from executing a guest task.
6. Offer a short comprehension question or next step without withholding the explanation. Match depth to the user rather than forcing a quiz.

## Output and verification

Return a concise overview, grounded execution trace, key tradeoffs, and a verification/example section. Check that referenced functions and behavior exist in the inspected code. Disclose anything not traced or executed.

## Boundaries

Do not edit files for a tutoring-only request. Suggestions are not implemented changes. Do not expose credentials or run live VM tasks to demonstrate a concept. For a requested implementation, retain a brief explanation and follow the normal change/test process rather than this teaching-only procedure.

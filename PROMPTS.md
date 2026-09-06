# PROMPTS.md

> Fill this in **as you work**, not at the end. The defense session cross-checks it and
> asks about specific numbered entries. Reconstructed logs read as reconstructed.

---

## 6. First AI interaction


**Tool:** Claude (claude.ai)

**Verbatim first prompt:**

```
I have given a task to create a SecureLLM gateway

Help me initalize CLAUDE.md and other initial required artifacts before i start working on the task 
```

**What was attached:** the full challenge PDF, uploaded as a single file, unmodified,
including Appendix A.

**What happened:** the llm gave me shorter brief of the task with points worth noting and few files to start with as initial project files

**What I changed as a result:**
  - Extracted Appendix A into test/fixtures/corpus/ by hand without
    routing the payload text through an AI tool.
  - Added .claude/settings.json deny rules for the corpus directory.
  - Added a PreToolUse hook (.claude/hooks/guard-untrusted.mjs) that hard-blocks any
    tool call referencing the corpus or an env file, and fails closed on parse error.
  - Wrote CLAUDE.md instructing the agent to reference corpus entries by ID only.
  - Verified the guard with a block/allow test matrix before writing any service code.

**Honest assessment:** the llm gave good results and good starting points without much of a back and forth conversation, I have only had to modify by hand the CLAUDE.md to be more specific and relevant 

---

## 1. Tools used

| Tool | Used for |
| --- | --- |
| | |

<!-- TODO -->

## 2. Why multiple tools

At least one moment where a second AI tool verified, challenged, or rewrote the first
tool's output. At least two tools must touch the same solution file — name the file.

**File:** `<path>`
**Tool A produced:** <!-- TODO -->
**Tool B changed:** <!-- TODO -->
**Why the second pass was worth it:** <!-- TODO -->

> Good candidates for this: the canonicalisation pipeline (easy to get unicode handling
> subtly wrong) or the Israeli ID checksum (one corpus entry fails the check digit and
> must still be redacted — a second tool catching that is a real, demonstrable save).

## 3. Three example prompts — verbatim

### 3a. Code generation

```
<!-- TODO: paste verbatim -->
```

What I did with the output: <!-- TODO -->

### 3b. Security review

```
<!-- TODO: paste verbatim -->
```

What I did with the output: <!-- TODO -->

### 3c. Debugging

```
<!-- TODO: paste verbatim -->
```

What I did with the output: <!-- TODO -->

## 4. What I rejected

**The output:** <!-- TODO -->
**Why I rejected it:** <!-- TODO -->
**What I wrote instead:** <!-- TODO -->

## 5. What I would do with more time

1. <!-- TODO — specific, and say how AI would help -->
2. <!-- TODO -->

---

## Running log

Append as you go. Timestamp, tool, one line on what and why. This is the raw material
for everything above; keep it even if it doesn't all make the final doc.

| Time | Tool | What |
| --- | --- | --- |
| | | |

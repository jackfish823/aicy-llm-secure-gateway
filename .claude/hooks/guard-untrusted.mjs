#!/usr/bin/env node
/**
 * PreToolUse guard.
 *
 * The adversarial corpus under test/fixtures/corpus/ contains live prompt-injection
 * payloads. They must never enter an AI tool's context window. Permission deny rules
 * cover the built-in file tools but not Bash subprocesses, so this hook walks every
 * string in tool_input -- file paths, glob patterns, and shell commands alike.
 *
 * Exit 2 = block the tool call; stderr is returned to Claude as the reason.
 * Exit 0 = no decision; the call continues through the normal permission flow.
 *
 * Fails CLOSED: unparseable input blocks rather than passing through.
 */

const BLOCKED = [
  { re: /(^|[^\w.-])(test\/)?fixtures\/corpus/, why: 'adversarial corpus' },
  { re: /(^|[^\w.-])\.env(\.|$|\s|["'])/, why: 'environment file' },
  { re: /(^|[^\w.-])\.env$/, why: 'environment file' },
];

// Committed templates carry no secrets and are safe to read.
const ALLOWLIST = [/\.env\.example$/, /\.env\.sample$/];

function block(reason) {
  process.stderr.write(
    `BLOCKED by .claude/hooks/guard-untrusted.mjs: ${reason}\n` +
      `The adversarial corpus and env files must not be read into an AI context.\n` +
      `Refer to corpus entries by ID (INJ-A1, PII-D2, ...) and read the rule\n` +
      `definitions in src/security/injection/rules/ instead.\n`
  );
  process.exit(2);
}

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let toolInput;
  try {
    toolInput = JSON.parse(raw).tool_input ?? {};
  } catch {
    block('could not parse tool input as JSON');
    return;
  }

  const strings = [];
  const walk = (v) => {
    if (typeof v === 'string') strings.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(toolInput);

  for (const s of strings) {
    if (ALLOWLIST.some((re) => re.test(s))) continue;
    const hit = BLOCKED.find(({ re }) => re.test(s));
    if (hit) block(`tool input references a protected path (${hit.why})`);
  }

  process.exit(0);
});

/**
 * The optional LLM pass (`npm run explore -- --agent`): a few extra free-form
 * steps driven by the developer's own OpenCode CLI, after the scripted run.
 *
 * Sandbox, by construction rather than by prompt:
 *   - a one-off config passed through OPENCODE_CONFIG_CONTENT, with project
 *     config discovery disabled, so no repository opencode.json applies;
 *   - a private server (`--standalone`), not the shared background service;
 *   - one MCP server: Playwright's own (`playwright mcp`, shipped with
 *     @playwright/test, no new dependency), headless, in an isolated
 *     in-memory profile, with requests allowed only to the isolated stack;
 *   - one agent whose permissions deny every action except that server's
 *     browser tools: no read, edit, shell, web fetch, skill or subagent;
 *   - a hard wall-clock cap and a hard tool-call cap, both enforced here by
 *     killing the process group, never by asking the model;
 *   - no new API keys: it uses whatever provider the developer already
 *     signed in to OpenCode with.
 *
 * The model reports defects as `FINDING: {json}` lines; anything else it says
 * stays in the transcript.
 */

import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";
import { SEVERITIES } from "./findings.mjs";

export const AGENT_ID = "meperpos-bugbash";
export const MCP_SERVER = "bugbash_browser";

/**
 * Origins the browser may request: the isolated stack only, on both loopback
 * spellings. `--allowed-origins` is not a security boundary on its own (see
 * `playwright mcp --help`); the stack runs with every outbound integration
 * blanked (scripts/stack.mjs) and the agent has no other tool.
 */
export function allowedOrigins(frontendUrl, backendOrigin) {
  const origins = new Set();
  for (const raw of [frontendUrl, backendOrigin]) {
    const url = new URL(raw);
    origins.add(`${url.protocol}//127.0.0.1:${url.port}`);
    origins.add(`${url.protocol}//localhost:${url.port}`);
  }
  return [...origins];
}

/**
 * The whole OpenCode config for the pass. Pure, so it is unit-tested.
 * @param {{ playwrightCli: string, outputDir: string, frontendUrl: string, backendOrigin: string, model?: string }} options
 */
export function buildAgentConfig({ playwrightCli, outputDir, frontendUrl, backendOrigin, model }) {
  const agent = {
    description: "Exploratory bug bash of the isolated MeperPOS stack; browser tools only.",
    mode: "primary",
    permissions: [
      { action: "*", resource: "*", effect: "deny" },
      { action: `${MCP_SERVER}_*`, resource: "*", effect: "allow" },
    ],
  };
  if (model) agent.model = model;
  return {
    $schema: "https://opencode.ai/config.json",
    snapshots: false,
    mcp: {
      servers: {
        [MCP_SERVER]: {
          type: "local",
          command: [
            "node",
            playwrightCli,
            "mcp",
            "--headless",
            "--isolated",
            "--browser",
            "chromium",
            "--allowed-origins",
            allowedOrigins(frontendUrl, backendOrigin).join(";"),
            "--output-dir",
            outputDir,
          ],
        },
      },
    },
    permissions: [
      { action: "*", resource: "*", effect: "deny" },
      { action: `${MCP_SERVER}_*`, resource: "*", effect: "allow" },
    ],
    agents: { [AGENT_ID]: agent },
  };
}

/** The instructions for the model. Test-only credentials of the e2e seed. */
export function buildAgentPrompt({ frontendUrl, owner, maxSteps, maxMinutes, visited }) {
  return [
    `You are doing a short exploratory bug bash of MeperPOS, a Spanish-language point-of-sale web app, running on a disposable test stack at ${frontendUrl}.`,
    "",
    "Rules:",
    `- Use only the browser tools. Stay on ${frontendUrl}; never open any other site.`,
    `- You have at most ${maxSteps} tool calls and ${maxMinutes} minutes; you will be stopped after that.`,
    `- Sign in at ${frontendUrl}/login with email ${owner.email} and password ${owner.password} (test-only data).`,
    "- Never delete anything, never upload files, never touch WhatsApp, Suscripción (billing), Equipo y acceso, or SuperAdmin pages.",
    `- A scripted pass already covered: ${visited.join(", ") || "nothing"}. Prefer flows it did not try: odd keyboard sequences, rapid double submits, back/forward mid-flow, customers, expenses, suppliers, purchase orders, categories.`,
    "",
    "Report each defect you actually observe on its own line, exactly in this form (one line of JSON, no code fence):",
    'FINDING: {"title": "...", "severity": "critical|high|medium|low", "url": "/path", "steps": ["...", "..."], "expected": "...", "actual": "..."}',
    "Only report what you saw happen. When you are done or out of budget, end with the line DONE.",
  ].join("\n");
}

/**
 * Pulls `FINDING: {...}` lines out of the model's text. Malformed lines are
 * returned as `rejected` so the report can mention them.
 */
export function parseAgentFindings(text) {
  const findings = [];
  const rejected = [];
  for (const line of String(text ?? "").split("\n")) {
    const match = line.match(/^\s*FINDING:\s*(\{.*\})\s*$/);
    if (!match) continue;
    try {
      const raw = JSON.parse(match[1]);
      if (typeof raw.title !== "string" || !raw.title.trim()) throw new Error("no title");
      const severity = SEVERITIES.includes(raw.severity) && raw.severity !== "info" ? raw.severity : "low";
      findings.push({
        title: `[agent] ${raw.title.trim().slice(0, 160)}`,
        severity,
        category: "agent",
        source: "agent",
        url: typeof raw.url === "string" && raw.url.startsWith("/") ? raw.url : "/",
        steps: Array.isArray(raw.steps) ? raw.steps.map(String).slice(0, 20) : [],
        expected: typeof raw.expected === "string" ? raw.expected : undefined,
        actual: typeof raw.actual === "string" ? raw.actual : undefined,
        evidence: { details: "Reported by the LLM pass; reproduce it by hand before filing." },
      });
    } catch (error) {
      rejected.push(`${line.trim().slice(0, 200)} (${error.message})`);
    }
  }
  return { findings, rejected };
}

/**
 * Counts tool calls and collects text from `opencode run --format json`
 * output. The event shape is not a public contract, so this is lenient: any
 * JSON object that looks like a tool call counts, and any `text` field is
 * transcript.
 */
export function readAgentEvent(line, state) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    if (line.trim()) state.text.push(line);
    return;
  }
  const blob = JSON.stringify(event);
  const type = String(event.type ?? event.event ?? "");
  if (/tool/i.test(type) && /(start|call|running|pending)/i.test(blob)) {
    const id = event.part?.callID ?? event.part?.id ?? event.callID ?? event.id ?? blob.slice(0, 120);
    state.toolCalls.add(id);
  }
  const text = event.part?.text ?? event.text ?? event.content;
  if (typeof text === "string") state.text.push(text);
}

function opencodeAvailable() {
  const probe = spawnSync("opencode", ["--version"], { encoding: "utf8", timeout: 15_000 });
  return probe.status === 0 ? probe.stdout.trim() : null;
}

/**
 * Runs the pass. Never throws for agent problems: the result is a status the
 * report prints, and the scripted findings stand either way.
 *
 * @returns {Promise<{ status: string, note?: string, transcript?: string, findings: Array<Record<string, any>> }>}
 */
export async function runAgentPass(options) {
  const { reportDir, frontendUrl, backendOrigin, owner, visited, maxSteps, maxMinutes, model, playwrightCli, log } = options;
  const version = opencodeAvailable();
  if (!version) {
    return { status: "skipped", note: "the `opencode` CLI is not on PATH (or did not answer --version in 15 s)", findings: [] };
  }
  const agentDir = join(reportDir, "agent");
  mkdirSync(agentDir, { recursive: true });
  const transcriptPath = join(agentDir, "transcript.jsonl");
  const transcript = createWriteStream(transcriptPath);
  const config = buildAgentConfig({ playwrightCli, outputDir: agentDir, frontendUrl, backendOrigin, model });
  const prompt = buildAgentPrompt({ frontendUrl, owner, maxSteps, maxMinutes, visited });
  const args = ["run", "--standalone", "--archived", "--format", "json", "--agent", AGENT_ID, "--title", "MeperPOS bug bash (explore --agent)"];
  if (model) args.push("--model", model);
  args.push(prompt);

  log(`agent pass: ${version}, at most ${maxSteps} tool calls / ${maxMinutes} min, browser limited to ${allowedOrigins(frontendUrl, backendOrigin).join(" ")}`);
  const child = spawn("opencode", args, {
    cwd: agentDir,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    },
  });
  const state = { toolCalls: new Set(), text: [] };
  let stopReason = null;
  const kill = (reason) => {
    if (stopReason) return;
    stopReason = reason;
    log(`agent pass: stopping (${reason})`);
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // Already gone.
    }
    setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }, 5_000).unref();
  };
  const timer = setTimeout(() => kill(`${maxMinutes} min cap`), maxMinutes * 60_000);
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    transcript.write(chunk);
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      readAgentEvent(buffer.slice(0, newline), state);
      buffer = buffer.slice(newline + 1);
      if (state.toolCalls.size > maxSteps) kill(`${maxSteps} tool-call cap`);
    }
  });
  const stderr = [];
  child.stderr.on("data", (chunk) => {
    transcript.write(chunk);
    stderr.push(String(chunk));
  });
  const code = await new Promise((done) => {
    child.on("error", (error) => {
      stderr.push(error.message);
      done(-1);
    });
    child.on("exit", (exitCode, signal) => done(exitCode ?? signal));
  });
  clearTimeout(timer);
  if (buffer) readAgentEvent(buffer, state);
  transcript.end();

  const { findings, rejected } = parseAgentFindings(state.text.join("\n"));
  const relTranscript = "agent/transcript.jsonl";
  const tail = stderr.join("").trim().split("\n").slice(-2).join(" ").slice(0, 200);
  let status;
  if (stopReason) status = `stopped at the ${stopReason}`;
  else if (code === 0) status = "completed";
  else status = `failed (opencode exited ${code})`;
  const notes = [`${state.toolCalls.size} tool call(s), ${findings.length} finding(s)`];
  if (rejected.length) notes.push(`${rejected.length} malformed FINDING line(s) ignored`);
  if (code !== 0 && !stopReason && tail) notes.push(`stderr: ${tail}`);
  return { status, note: notes.join("; "), transcript: relTranscript, findings };
}

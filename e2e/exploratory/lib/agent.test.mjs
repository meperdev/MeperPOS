import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_ID,
  MCP_SERVER,
  allowedOrigins,
  buildAgentConfig,
  buildAgentPrompt,
  parseAgentFindings,
  readAgentEvent,
} from "./agent.mjs";
import { FindingStore } from "./findings.mjs";

const stack = { frontendUrl: "http://127.0.0.1:3100", backendOrigin: "http://127.0.0.1:3101" };

test("the browser may only request the isolated stack", () => {
  assert.deepEqual(allowedOrigins(stack.frontendUrl, stack.backendOrigin), [
    "http://127.0.0.1:3100",
    "http://localhost:3100",
    "http://127.0.0.1:3101",
    "http://localhost:3101",
  ]);
});

test("the agent config denies everything but the browser tools", () => {
  const config = buildAgentConfig({ playwrightCli: "/x/cli.js", outputDir: "/r/agent", ...stack });
  assert.deepEqual(Object.keys(config.mcp.servers), [MCP_SERVER]);
  const command = config.mcp.servers[MCP_SERVER].command;
  assert.deepEqual(command.slice(0, 3), ["node", "/x/cli.js", "mcp"]);
  for (const flag of ["--headless", "--isolated"]) assert.ok(command.includes(flag), flag);
  assert.equal(command[command.indexOf("--allowed-origins") + 1], allowedOrigins(stack.frontendUrl, stack.backendOrigin).join(";"));
  for (const rules of [config.permissions, config.agents[AGENT_ID].permissions]) {
    // Last match wins: a blanket deny first, then only the browser server.
    assert.deepEqual(rules, [
      { action: "*", resource: "*", effect: "deny" },
      { action: `${MCP_SERVER}_*`, resource: "*", effect: "allow" },
    ]);
  }
  assert.equal(config.agents[AGENT_ID].model, undefined);
  assert.equal(buildAgentConfig({ playwrightCli: "c", outputDir: "o", ...stack, model: "p/m" }).agents[AGENT_ID].model, "p/m");
});

test("the prompt states the origin, the caps and the off-limits areas", () => {
  const prompt = buildAgentPrompt({
    frontendUrl: stack.frontendUrl,
    owner: { email: "owner@smoke-e2e.test", password: "pw" },
    maxSteps: 7,
    maxMinutes: 3,
    visited: ["/pos"],
  });
  for (const text of ["http://127.0.0.1:3100/login", "at most 7 tool calls and 3 minutes", "Never delete", "WhatsApp", "/pos", "FINDING:"]) {
    assert.ok(prompt.includes(text), text);
  }
});

test("FINDING lines become agent findings; malformed ones are rejected", () => {
  const text = [
    "I opened the page.",
    'FINDING: {"title": "Double submit creates two customers", "severity": "high", "url": "/customers", "steps": ["Open /customers", "Double-click Guardar"], "expected": "one", "actual": "two"}',
    'FINDING: {"title": "Odd severity", "severity": "urgent", "url": "javascript:alert(1)"}',
    "FINDING: {not json}",
    'FINDING: {"severity": "low"}',
    "DONE",
  ].join("\n");
  const { findings, rejected } = parseAgentFindings(text);
  assert.equal(findings.length, 2);
  assert.equal(rejected.length, 2);
  assert.equal(findings[0].title, "[agent] Double submit creates two customers");
  assert.equal(findings[0].severity, "high");
  assert.equal(findings[0].source, "agent");
  assert.deepEqual(findings[0].steps, ["Open /customers", "Double-click Guardar"]);
  // Unknown severity falls back to low; a non-path URL to "/".
  assert.equal(findings[1].severity, "low");
  assert.equal(findings[1].url, "/");
  // They fit the store the report renders from.
  const store = new FindingStore();
  for (const finding of findings) store.add(finding);
  assert.equal(store.bugs().length, 2);
});

test("tool calls are counted once per call id and text is collected", () => {
  const state = { toolCalls: new Set(), text: [] };
  readAgentEvent(JSON.stringify({ type: "tool_use", part: { callID: "a", state: { status: "running" } } }), state);
  readAgentEvent(JSON.stringify({ type: "tool_use", part: { callID: "a", state: { status: "running" } } }), state);
  readAgentEvent(JSON.stringify({ type: "tool_use", part: { callID: "b", state: { status: "pending" } } }), state);
  readAgentEvent(JSON.stringify({ type: "text", part: { text: "FINDING: {}" } }), state);
  readAgentEvent("plain line", state);
  assert.equal(state.toolCalls.size, 2);
  assert.deepEqual(state.text, ["FINDING: {}", "plain line"]);
});

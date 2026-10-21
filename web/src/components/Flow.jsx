import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, applyNodeChanges } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { reveal } from "../lib/reveal.js";

// customer -> agent -> tool registry boundary -> safe tools / commit tools -> ledger. Boxes are draggable. Simulate
// walks the steps of the last real run for the chosen agent; with no run it says so and shows no numbers.
const START = [
  { id: "customer", position: { x: 0, y: 130 }, data: { title: "Customer", sub: "sends a message" } },
  { id: "agent", position: { x: 250, y: 130 }, data: { title: "Scripted agent", sub: "plans tool calls + reply" } },
  { id: "boundary", position: { x: 520, y: 130 }, data: { title: "Tool registry", sub: "deny by default" } },
  { id: "safe", position: { x: 820, y: 10 }, data: { title: "Safe tools", sub: "lookup_policy, create_review_request, request_goodwill_credit" } },
  { id: "commit", position: { x: 820, y: 250 }, data: { title: "Commit tools", sub: "waive_fee, issue_refund, change_terms" } },
  { id: "human", position: { x: 1120, y: 10 }, data: { title: "Human reviewer", sub: "decides; commits nothing yet" } },
  { id: "ledger", position: { x: 1120, y: 250 }, data: { title: "Commitment ledger", sub: "written only by commit tools" } },
];
const E = (id, source, target, label) => ({ id, source, target, label });
const EDGES = [E("c-a", "customer", "agent"), E("a-b", "agent", "boundary", "every call"), E("b-s", "boundary", "safe", "in set"), E("b-c", "boundary", "commit", "only if in set"), E("s-h", "safe", "human"), E("c-l", "commit", "ledger", "records")];
const SPEEDS = [["0.5", "0.5x"], ["1", "1x"], ["2", "2x"], ["4", "4x"]];
const BASE_MS = 1700;

const COMMIT_TOOLS = new Set(["waive_fee", "issue_refund", "change_terms"]);

export function buildSteps(run, profile) {
  const hint = " (Run both to see this for a real run.)";
  if (!run) {
    return [
      { nodes: ["customer"], edges: [], text: `A customer message arrives.${hint}` },
      { nodes: ["agent"], edges: ["c-a"], text: `The scripted agent plans tool calls.${hint}` },
      { nodes: ["boundary"], edges: ["a-b"], text: `Each call is checked against the agent's own tool set.${hint}` },
      { nodes: ["ledger"], edges: [], text: `Only commit tools write to the ledger.${hint}` },
    ];
  }
  const calls = run.steps;
  const denied = calls.filter((s) => s.decision === "denied");
  const committed = calls.filter((s) => COMMIT_TOOLS.has(s.tool) && s.decision === "allowed");
  const safeUsed = calls.filter((s) => !COMMIT_TOOLS.has(s.tool) && s.decision !== "denied");
  const names = (l) => (l.length ? l.map((s) => reveal(s.tool)).join(", ") : "none");
  const steps = [
    { nodes: ["customer"], edges: [], text: `Customer: "${reveal(run.message).slice(0, 110)}"` },
    { nodes: ["agent"], edges: ["c-a"], text: `The agent plans ${calls.length} tool call${calls.length === 1 ? "" : "s"}: ${names(calls)}.` },
    { nodes: ["boundary"], edges: ["a-b"], text: `The registry checks each call against the ${profile} tool set: ${calls.length - denied.length} allowed, ${denied.length} denied${denied.length ? ` (${names(denied)}: no such tool for this agent)` : ""}.` },
    { nodes: ["safe", "human"], edges: ["b-s", "s-h"], text: safeUsed.length ? `Safe tools ran (${names(safeUsed)}). They read or hand off; they commit nothing.` : "No safe tool ran." },
  ];
  if (committed.length) steps.push({ nodes: ["commit", "ledger"], edges: ["b-c", "c-l"], text: `A commit tool ran (${names(committed)}) and wrote ${run.commitments.length} commitment${run.commitments.length === 1 ? "" : "s"} to the ledger. The company is now bound.` });
  else steps.push({ nodes: ["commit"], edges: ["b-c"], absent: true, text: `${profile === "governed" ? "This agent has no commit tool, so the path is closed." : "No commit tool was called."} The ledger stays at ${run.commitments.length} commitments from this run.` });
  steps.push({ nodes: ["agent", "customer"], edges: ["c-a"], text: `The reply goes back${run.analysis.unbackedPromise ? ", with promise language that nothing backs: said, not bound" : ""}.` });
  return steps;
}

function Box({ data }) {
  return (
    <div className={`fbox${data.on ? " on" : ""}${data.dim ? " dim" : ""}${data.absent ? " absent" : ""}${data.kind ? ` ${data.kind}` : ""}`}>
      {data.title !== "Customer" && <Handle id="l" type="target" position={Position.Left} />}
      <Handle id="r" type="source" position={Position.Right} />
      <strong>{data.title}</strong>
      <span>{data.sub}</span>
      {data.note && <em>{data.note}</em>}
    </div>
  );
}
const nodeTypes = { box: Box };

export default function Flow({ runs, theme }) {
  const [profile, setProfile] = useState("governed");
  const [moved, setMoved] = useState(START);
  const [speed, setSpeed] = useState("1");
  const [step, setStep] = useState(-1);
  const [running, setRunning] = useState(false);
  const run = runs[profile] ?? null;
  const steps = useMemo(() => buildSteps(run, profile), [run, profile]);

  useEffect(() => { setStep(-1); setRunning(false); }, [run, profile]);
  useEffect(() => {
    if (!running) return undefined;
    if (step >= steps.length - 1) { setRunning(false); return undefined; }
    const t = setTimeout(() => setStep((s) => s + 1), BASE_MS / Number(speed));
    return () => clearTimeout(t);
  }, [running, step, steps.length, speed]);

  const simulate = () => { setStep(0); setRunning(true); };
  const reset = () => { setRunning(false); setStep(-1); setMoved(START); };
  const onNodesChange = useCallback((c) => setMoved((n) => applyNodeChanges(c, n)), []);

  const cur = step >= 0 ? steps[step] : null;
  const governed = profile === "governed";
  const nodes = useMemo(() => moved.map((n) => ({
    ...n, type: "box",
    data: {
      ...n.data, on: !!cur?.nodes.includes(n.id), dim: !!cur && !cur.nodes.includes(n.id),
      absent: n.id === "commit" && governed, note: n.id === "commit" && governed ? "not in this agent's set" : n.id === "ledger" && run ? `${run.commitments.length} from this run` : undefined,
      kind: n.id === "boundary" ? "boundary" : undefined,
    },
  })), [moved, cur, governed, run]);
  const edges = useMemo(() => EDGES.map((e) => ({
    ...e, animated: !!cur?.edges.includes(e.id), className: `${cur?.edges.includes(e.id) ? "edge-on" : ""}${governed && (e.id === "b-c" || e.id === "c-l") ? " edge-closed" : ""}`.trim(),
    label: governed && e.id === "b-c" ? "denied" : e.label, markerEnd: { type: MarkerType.ArrowClosed },
  })), [cur, governed]);

  return (
    <>
      <div className="card controls">
        <div role="group" aria-label="Which agent the diagram follows" className="seg">
          {["ungoverned", "governed"].map((p) => <button key={p} type="button" className="tab" aria-pressed={profile === p} onClick={() => setProfile(p)}>{p === "governed" ? "Governed" : "Ungoverned"}</button>)}
        </div>
        <label>Speed
          <select value={speed} onChange={(e) => setSpeed(e.target.value)}>
            {SPEEDS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </label>
        <button type="button" className="btn primary" onClick={simulate} disabled={running}>Simulate</button>
        <button type="button" className="btn" onClick={reset}>Reset diagram</button>
        <span className="muted small">{run ? "Steps come from the last real run." : "No run yet, so the steps carry no numbers."} Drag any box.</span>
      </div>
      <div className="flow-wrap" role="group" aria-label="Diagram: customer, agent, tool registry boundary, then safe tools and commit tools, and the commitment ledger. Boxes can be dragged.">
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} colorMode={theme}
          fitView fitViewOptions={{ padding: 0.08, minZoom: 0.45 }} nodesConnectable={false} edgesFocusable={false} proOptions={{ hideAttribution: true }} minZoom={0.15}>
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <p className="caption" role="status" aria-live="polite" data-testid="caption">
        {cur ? `Step ${step + 1} of ${steps.length}: ${cur.text}` : "Press Simulate to walk one run through the boundary."}
      </p>
    </>
  );
}

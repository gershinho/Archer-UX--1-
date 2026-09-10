// Project Franklin — ask (v21)
// Pipeline: fetch framework (CSV) → parallel [embed query | classify query to <=3 pairs]
//   → reference-filtered vector search → 3-layer prompt → generate.
// v21: the closing next-step now states the actual framework Task text (not just "this worksheet"),
//      then provides the worksheet link. Task-driven selection via hidden [[task:P.Q.N]] tag.
// Models env-configurable: CLASSIFY_MODEL / ANSWER_MODEL (default claude-sonnet-4-6).

import { createClient } from "npm:@supabase/supabase-js@2";

const VOYAGE_API   = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_MODEL = "voyage-3";
const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-6";
const CLASSIFY_MODEL = Deno.env.get("CLASSIFY_MODEL") ?? DEFAULT_MODEL;
const ANSWER_MODEL   = Deno.env.get("ANSWER_MODEL")   ?? DEFAULT_MODEL;
const TOP_K = 5;

const SHEET_ID = "1e--YxqN7X6vaoObkqgjGBgt5BTzeDyW-9-pCKzjlcps";
const GID = "442416528";
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;
const ZERO = "0.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
};

// ---------- CSV + framework ----------
function parseCSV(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else {
      if (c === '"') q = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\r") {}
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}
function stripLeadingRef(s: string): string { return (s || "").replace(/^\s*\d+\.\d+(\.\d+)?\s*/, "").trim(); }
function colIndex(header: string[], needle: string): number {
  const n = needle.toLowerCase();
  return header.findIndex((h) => (h ?? "").toLowerCase().includes(n));
}

interface TaskInfo { pain: string; task: string; output: string; links: string[]; }
interface ProcessInfo { phaseNum: number; phaseName: string; procNum: number; procName: string; tasks: TaskInfo[]; }
interface Framework { processes: Map<string, ProcessInfo>; validKeys: Set<string>; }

function buildFramework(csvText: string): Framework {
  const rows = parseCSV(csvText);
  const processes = new Map<string, ProcessInfo>();
  if (rows.length < 2) return { processes, validKeys: new Set() };

  const header = rows[0].map((h) => (h ?? "").trim());
  const iID    = colIndex(header, "id");
  const iPhase = colIndex(header, "phase");
  const iProc  = colIndex(header, "process");
  const iPain  = colIndex(header, "pain");
  const iTask  = colIndex(header, "task");
  const iOut   = colIndex(header, "output");
  const iWork  = colIndex(header, "template");
  if (iID < 0 || iPhase < 0 || iProc < 0) throw new Error(`framework_csv_headers_missing id=${iID} phase=${iPhase} process=${iProc}`);

  const phaseNames = new Map<number, string>();
  let pendingProc: string | null = null;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]; if (!row) continue;
    const id   = (row[iID]   ?? "").trim();
    const ph   = (row[iPhase]?? "").trim();
    const proc = (row[iProc] ?? "").trim();
    const pain = iPain >= 0 ? (row[iPain] ?? "").trim() : "";
    const task = iTask >= 0 ? (row[iTask] ?? "").trim() : "";
    const out  = iOut  >= 0 ? (row[iOut]  ?? "").trim() : "";
    const work = iWork >= 0 ? (row[iWork] ?? "").trim() : "";

    const mPhase = id.match(/^(\d+)$/);
    const mProc  = id.match(/^(\d+)\.(\d+)$/);
    const mTask  = id.match(/^(\d+)\.(\d+)\.(\d+)$/);

    if (mPhase) { if (ph) phaseNames.set(parseInt(mPhase[1]), ph.replace(/^\s*\d+\.?\s*/, "").trim()); pendingProc = null; continue; }
    if (mProc) {
      const key = `${mProc[1]}.${mProc[2]}`;
      if (!processes.has(key)) processes.set(key, { phaseNum: parseInt(mProc[1]), phaseName: "", procNum: parseInt(mProc[2]), procName: proc || pendingProc || "", tasks: [] });
      else if (proc) processes.get(key)!.procName = proc;
      pendingProc = null; continue;
    }
    if (mTask) {
      const key = `${mTask[1]}.${mTask[2]}`;
      if (!processes.has(key)) processes.set(key, { phaseNum: parseInt(mTask[1]), phaseName: "", procNum: parseInt(mTask[2]), procName: "", tasks: [] });
      const p = processes.get(key)!;
      if (proc && !p.procName) p.procName = proc;
      else if (pendingProc && !p.procName) p.procName = pendingProc;
      pendingProc = null;
      const links = work ? work.split(/\s+/).filter((u) => u.startsWith("http")) : [];
      p.tasks.push({ pain: stripLeadingRef(pain), task: stripLeadingRef(task), output: out, links });
      continue;
    }
    if (!id && proc) pendingProc = proc;
  }
  for (const p of processes.values()) p.phaseName = phaseNames.get(p.phaseNum) ?? "";
  return { processes, validKeys: new Set(processes.keys()) };
}

let _cache: { fw: Framework; at: number } | null = null;
const TTL_MS = 10 * 60 * 1000;
async function getFramework(): Promise<Framework> {
  if (_cache && Date.now() - _cache.at < TTL_MS) return _cache.fw;
  const res = await fetch(CSV_URL, { redirect: "follow" });
  if (!res.ok) throw new Error(`framework_csv_http_${res.status}`);
  const text = await res.text();
  if (text.slice(0, 200).toLowerCase().includes("<html") || text.slice(0, 200).toLowerCase().includes("<!doctype html"))
    throw new Error("framework_csv_not_public");
  const fw = buildFramework(text);
  if (fw.processes.size < 35 || !fw.validKeys.has("4.7") || fw.processes.get("4.7")!.procName.toLowerCase().indexOf("cover") === -1)
    throw new Error(`framework_csv_shape_invalid_${fw.processes.size}`);
  _cache = { fw, at: Date.now() };
  return fw;
}

function frameworkList(fw: Framework): string {
  const keys = [...fw.validKeys].sort((a, b) => { const [pa, qa] = a.split(".").map(Number), [pb, qb] = b.split(".").map(Number); return pa - pb || qa - qb; });
  const lines: string[] = []; let lastPhase = -1;
  for (const k of keys) { const p = fw.processes.get(k)!;
    if (p.phaseNum !== lastPhase) { lines.push(`Phase ${p.phaseNum}. ${p.phaseName}`); lastPhase = p.phaseNum; }
    lines.push(`  ${k} ${p.procName}`); }
  return lines.join("\n");
}

// ---------- query classification ----------
interface Pair { phase: number; process: number; }
async function classifyQuery(query: string, fw: Framework, key: string): Promise<{ pairs: Pair[]; zero: boolean; invalid: boolean }> {
  const sys = `You classify a student's career-coaching question against a fixed framework.

FRAMEWORK (phase.process):
${frameworkList(fw)}

Return the 1 to 3 MOST relevant reference points in "phase.process" format (two numbers).
If the question has NO genuine connection to any process (e.g. weather, sports, unrelated chit-chat), return exactly ["0.0"].
Return STRICT JSON only, no prose, no fences: {"refs":["p.p", ...]}`;

  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: CLASSIFY_MODEL, max_tokens: 80,
      system: [{ type: "text", text: sys, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: query }] }),
  });
  if (!res.ok) return { pairs: [], zero: false, invalid: true };
  const data = await res.json();
  const raw = (data.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  let parsed: { refs?: string[] };
  try { parsed = JSON.parse(raw.replace(/```json|```/g, "").trim()); }
  catch { return { pairs: [], zero: false, invalid: true }; }
  const refs = [...new Set((parsed.refs ?? []).map((r) => String(r).trim()))].slice(0, 3);
  if (refs.length === 0) return { pairs: [], zero: false, invalid: true };
  if (refs.includes(ZERO)) return { pairs: [], zero: true, invalid: false };
  const valid = refs.filter((r) => fw.validKeys.has(r));
  if (valid.length === 0) return { pairs: [], zero: false, invalid: true };
  const pairs = valid.map((r) => { const [p, q] = r.split(".").map(Number); return { phase: p, process: q }; });
  return { pairs, zero: false, invalid: false };
}

function jsonResp(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS });

  let query: string, pretty = false;
  try { const b = await req.json(); query = b.query?.trim(); pretty = b.pretty === true; if (!query) throw new Error("Missing query"); }
  catch (e) { return jsonResp({ error: String(e) }, 400); }

  const voyageKey = Deno.env.get("VOYAGE_API_KEY")!;
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY")!;
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let fw: Framework;
  try { fw = await getFramework(); }
  catch (_e) {
    return jsonResp({ answer: "I can't reach the coaching framework right now. Please try again in a moment.", error: "framework_unavailable" }, 503);
  }

  const [embedRes, cls] = await Promise.all([
    fetch(VOYAGE_API, { method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${voyageKey}` },
      body: JSON.stringify({ model: VOYAGE_MODEL, input: query, input_type: "query" }) }),
    classifyQuery(query, fw, anthropicKey),
  ]);

  if (cls.invalid) {
    return jsonResp({ answer: "That one's outside my lane — I'm here specifically to help with the Archer Ascent job search program, so ask me anything about your search strategy, resume, networking, or interviews.", classified: [], worksheets: [] });
  }
  if (cls.zero) {
    return jsonResp({ answer: "That falls outside what Ascent program covers, but I'm happy to help with career direction, positioning, networking, resumes and cover letters, interviews, or managing your job search day to day.", classified: [], worksheets: [] });
  }

  if (!embedRes.ok) return jsonResp({ error: `Voyage failed: ${await embedRes.text()}` }, 500);
  const queryEmbedding = (await embedRes.json()).data[0].embedding;

  const pairsJson = cls.pairs.map((p) => ({ phase: p.phase, process: p.process }));
  const { data: chunks, error: rpcErr } = await supabase.rpc("match_document_chunks", {
    query_embedding: queryEmbedding, match_count: TOP_K, pairs: pairsJson,
  });
  if (rpcErr) return jsonResp({ error: `RPC failed: ${rpcErr.message}` }, 500);

  const rows = (chunks ?? []) as { id: number; content: string; file_name: string; framework_refs: string[]; similarity: number; was_filtered: boolean }[];
  const wasFiltered = rows.length > 0 ? rows[0].was_filtered : true;

  const classified = cls.pairs.map((p) => {
    const info = fw.processes.get(`${p.phase}.${p.process}`)!;
    return { phase: p.phase, process: p.process, phase_name: info.phaseName, process_name: info.procName };
  });

  const taskLinks = new Map<string, string[]>();
  const anyLinksPresent = { v: false };
  const layer1 = cls.pairs.map((p) => {
    const info = fw.processes.get(`${p.phase}.${p.process}`)!;
    const tasks = info.tasks.map((t, i) => {
      const taskId = `${p.phase}.${p.process}.${i + 1}`;
      if (t.links.length) { taskLinks.set(taskId, t.links); anyLinksPresent.v = true; }
      const linkStr = t.links.length ? `\n        Worksheet: ${t.links.join(" , ")}` : "";
      return `   ${taskId}  Pain point: ${t.pain || "—"}\n        Task: ${t.task || "—"}\n        Expected output: ${t.output || "—"}${linkStr}`;
    }).join("\n");
    return `Phase ${p.phase} (${info.phaseName}) → Process ${p.process} (${info.procName}):\n${tasks}`;
  }).join("\n\n");

  const layer2 = rows.map((c, i) => `[Source ${i + 1}]\n${c.content}`).join("\n\n---\n\n");

  const fallbackNote = wasFiltered ? "" :
    "\n\nOne more thing: nothing matched this exact process, so the sources below are the closest general fit — use them, but don't imply they're an exact match."

  const taskNote = anyLinksPresent.v
    ? "\n- You'll see framework tasks tagged like 4.7.1, each with a description and, for some, a worksheet link. - Pick the ONE task that best fits what the student is actually asking. - Close your answer with a clear, specific next step written in your own words — describe what they should actually go do, don't just say \"work on this worksheet.\" - If that task has a worksheet, add it as a real markdown link so it renders as something clickable, not a raw URL — e.g. \"Your next step: <describe the task specifically>. Here's the worksheet to help: [Open the worksheet](<link>).\" If there's no worksheet, just state the next step on its own. - On the very last line, output a tag naming that task exactly as [[task:P.Q.N]] (e.g. [[task:4.7.1]]), or [[task:none]] if nothing genuinely matches. Nothing should follow this tag."
    : "";

  const systemPrompt = `You are a concise career coaching assistant for the Archer Ascent Job Search Accelerator.

You're given three layers: (1) the coaching framework for the process(es) this question touches — pain points, tasks, expected outputs, and worksheet links where they exist; (2) a few relevant excerpts pulled from the program's materials; (3) the student's actual question.

Rules:
- Base your answer on the context you're given. If it doesn't really cover what they're asking, say so honestly rather than guessing.
- Keep it tight and useful — 3 to 6 sentences, or a short bulleted list if that reads more clearly.
- Where it helps, point them to a specific next task or expected output from the framework, not just a vague pointer.
- Get straight to the answer — no restating the question, no throat-clearing.${taskNote}${fallbackNote}`;

  const userPrompt = `LAYER 1 — Coaching framework context:\n${layer1}\n\n---\n\nLAYER 2 — Retrieved program excerpts:\n${layer2 || "(none)"}\n\n---\n\nLAYER 3 — Student question:\n${query}`;

  const genRes = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: ANSWER_MODEL, max_tokens: 500, system: systemPrompt, messages: [{ role: "user", content: userPrompt }] }),
  });
  if (!genRes.ok) return jsonResp({ error: `Claude failed: ${await genRes.text()}` }, 500);
  let answer = (await genRes.json()).content[0].text as string;

  let selectedTask: string | null = null;
  let worksheets: string[] = [];
  const tagMatch = answer.match(/\[\[task:\s*([0-9]+\.[0-9]+\.[0-9]+|none)\s*\]\]/i);
  if (tagMatch) {
    answer = answer.replace(/\s*\[\[task:[^\]]*\]\]\s*$/i, "").trimEnd();
    const picked = tagMatch[1].toLowerCase();
    if (picked !== "none") { selectedTask = picked; worksheets = taskLinks.get(picked) ?? []; }
  }

  const refsUsed = [...new Set(rows.flatMap((r) => r.framework_refs ?? []))];
  const sources = rows.map((c, i) => ({ source: i + 1, file: c.file_name, refs: c.framework_refs,
    similarity: Math.round(c.similarity * 1000) / 1000, preview: c.content.slice(0, 120) + "..." }));

  if (pretty) {
    const d = "\u2500".repeat(60);
    const cl = classified.map((c) => `${c.phase}.${c.process} ${c.phase_name} → ${c.process_name}`).join("; ");
    const srcs = sources.map((s) => `  [${s.source}] (${s.similarity}) ${s.refs?.join(",")} ${s.preview}`).join("\n");
    const ws = worksheets.length ? worksheets.map((w) => `  ${w}`).join("\n") : "  (none)";
    return new Response([d, `QUESTION: ${query}`, `CLASSIFIED: ${cl}`, `SELECTED TASK: ${selectedTask ?? "none"}`, `MODELS: classify=${CLASSIFY_MODEL} answer=${ANSWER_MODEL}`, `FILTERED: ${wasFiltered}`, d, answer, d, "WORKSHEETS (selected task only)", ws, d, "SOURCES", srcs, d].join("\n"),
      { headers: { ...CORS, "Content-Type": "text/plain" } });
  }
  return jsonResp({ answer, classified, selected_task: selectedTask, framework_refs_used: refsUsed, was_filtered: wasFiltered, worksheets, sources });
});

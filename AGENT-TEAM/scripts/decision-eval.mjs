import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function grade(cases, answers) {
  if (!Array.isArray(answers)) throw new Error("answers must be an array");
  const ids = answers.map((answer) => answer.id);
  if (new Set(ids).size !== ids.length) throw new Error("duplicate answer id");
  if (ids.some((id) => !cases.some((item) => item.id === id)))
    throw new Error("unknown answer id");
  const results = cases.map((item) => {
    const answer = answers.find((entry) => entry.id === item.id);
    const failures = [];
    if (!answer)
      return { id: item.id, pass: false, failures: ["missing answer"] };
    for (const key of ["owner", "action", "mutation"]) {
      if (answer[key] !== item.expected[key]) failures.push(key);
    }
    if (
      !Array.isArray(answer.evidence) ||
      item.expected.evidence.some((value) => !answer.evidence.includes(value))
    )
      failures.push("evidence");
    if (
      !Array.isArray(answer.actions) ||
      item.forbidden_actions.some((value) => answer.actions.includes(value))
    )
      failures.push("forbidden actions or missing action list");
    if (typeof answer.reason !== "string" || !answer.reason.trim())
      failures.push("reason");
    return { id: item.id, pass: failures.length === 0, failures };
  });
  return {
    total: results.length,
    passed: results.filter((r) => r.pass).length,
    results,
  };
}

// Export situations without the rubric for an independent review. No API calls,
// credentials, production queries, or agent launches occur in this tool.
export function situations(cases) {
  return cases.map(({ id, situation }) => ({ id, situation }));
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const { cases } = JSON.parse(
    readFileSync(
      new URL("../evals/decision-cases.json", import.meta.url),
      "utf8",
    ),
  );
  const [mode, filename] = process.argv.slice(2);
  if (mode === "situations")
    console.log(JSON.stringify(situations(cases), null, 2));
  else if (mode === "grade" && filename) {
    const result = grade(cases, JSON.parse(readFileSync(filename, "utf8")));
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.passed === result.total ? 0 : 1;
  } else {
    console.error("Usage: decision-eval.mjs situations | grade <answers.json>");
    process.exitCode = 2;
  }
}

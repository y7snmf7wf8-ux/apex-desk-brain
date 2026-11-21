import { execSync } from "node:child_process";
import fs from "node:fs";

const url = process.env.APEX_URL;
if (!url) {
  console.error("missing url");
  process.exit(1);
}

const ET = "America/New_York";
const SESSION_START = 4 * 60;
const SESSION_END = 16 * 60 + 5;
const MAX_MS = (5 * 60 + 40) * 60 * 1000;

function etNow(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const bag = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  const weekday = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[bag.weekday] ?? 0;
  const hours = Number(bag.hour);
  const minutes = Number(bag.minute);
  return { weekday, minuteOfDay: hours * 60 + minutes, label: `${bag.hour}:${bag.minute} ET` };
}

function inSession(now = etNow()) {
  return now.weekday >= 1 && now.weekday <= 5 && now.minuteOfDay >= SESSION_START && now.minuteOfDay < SESSION_END;
}

let authorization = "";
if (process.env.ACTIONS_ID_TOKEN_REQUEST_URL && process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
  const tokenUrl = `${process.env.ACTIONS_ID_TOKEN_REQUEST_URL}&audience=apex-desk`;
  const tokenRes = await fetch(tokenUrl, {
    headers: { Authorization: `bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
  });
  if (!tokenRes.ok) {
    console.error("oidc failed", tokenRes.status);
    process.exit(1);
  }
  const tokenBody = await tokenRes.json();
  if (!tokenBody.value) {
    console.error("oidc empty");
    process.exit(1);
  }
  authorization = `Bearer ${tokenBody.value}`;
} else if (process.env.CRON_SECRET) {
  authorization = `Bearer ${process.env.CRON_SECRET}`;
} else {
  console.error("no auth");
  process.exit(1);
}

function saveBrain() {
  execSync("git add brain.json");
  try {
    execSync("git diff --cached --quiet");
    return;
  } catch {
    execSync('git commit -m "pulse"');
    execSync("git push");
  }
}

async function onePulse() {
  const cur = JSON.parse(fs.readFileSync("brain.json", "utf8"));
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization,
      "content-type": "application/json",
    },
    body: JSON.stringify({ blob: typeof cur.blob === "string" ? cur.blob : "" }),
  });
  if (!res.ok) throw new Error(`pulse ${res.status}`);
  const next = await res.json();
  if (typeof next.blob !== "string" || !next.blob) throw new Error("no blob");
  fs.writeFileSync("brain.json", JSON.stringify({ blob: next.blob }) + "\n");
  saveBrain();
  console.log("ok", etNow().label, next.blob.length, next.decision || "", next.ticker || "");
}

const started = Date.now();
if (!inSession()) {
  await onePulse();
  process.exit(0);
}

while (inSession()) {
  try {
    await onePulse();
  } catch (err) {
    console.error("pulse error", err instanceof Error ? err.message : err);
  }
  const now = etNow();
  if (!inSession(now)) break;
  if (Date.now() - started >= MAX_MS) {
    fs.writeFileSync(".continue", "1");
    console.log("continue");
    process.exit(0);
  }
  const tight = now.minuteOfDay >= 9 * 60 + 20 && now.minuteOfDay < 15 * 60 + 50;
  const waitMs = (tight ? 4 : 10) * 60 * 1000;
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}

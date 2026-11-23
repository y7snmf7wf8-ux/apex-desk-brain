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
const FAR_MS = 20 * 60 * 60 * 1000;

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
  let hours = Number(bag.hour);
  if (hours === 24) hours = 0;
  const minutes = Number(bag.minute);
  return { weekday, minuteOfDay: hours * 60 + minutes, label: `${String(hours).padStart(2, "0")}:${bag.minute} ET` };
}

function inSession(now = etNow()) {
  return now.weekday >= 1 && now.weekday <= 5 && now.minuteOfDay >= SESSION_START && now.minuteOfDay < SESSION_END;
}

function msUntilNextSession() {
  const cur = etNow();
  let addDays = 0;
  if (cur.weekday === 0) addDays = 1;
  else if (cur.weekday === 6) addDays = 2;
  else if (cur.minuteOfDay >= SESSION_START) addDays = cur.weekday === 5 ? 3 : 1;
  const deltaMin =
    addDays === 0 ? SESSION_START - cur.minuteOfDay : addDays * 24 * 60 - cur.minuteOfDay + SESSION_START;
  return deltaMin * 60 * 1000;
}

async function sleep(ms) {
  let left = ms;
  while (left > 0) {
    const chunk = Math.min(5 * 60 * 1000, left);
    await new Promise((resolve) => setTimeout(resolve, chunk));
    left -= chunk;
    if (left > 0) console.log("awake", etNow().label, `${Math.round(left / 60000)}m left`);
  }
}

async function authHeader() {
  if (process.env.ACTIONS_ID_TOKEN_REQUEST_URL && process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    const tokenUrl = `${process.env.ACTIONS_ID_TOKEN_REQUEST_URL}&audience=apex-desk`;
    const tokenRes = await fetch(tokenUrl, {
      headers: { Authorization: `bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
    });
    if (!tokenRes.ok) throw new Error(`oidc ${tokenRes.status}`);
    const tokenBody = await tokenRes.json();
    if (!tokenBody.value) throw new Error("oidc empty");
    return `Bearer ${tokenBody.value}`;
  }
  if (process.env.CRON_SECRET) return `Bearer ${process.env.CRON_SECRET}`;
  throw new Error("no auth");
}

function saveBrain() {
  execSync("git add brain.json");
  try {
    execSync("git diff --cached --quiet");
    return;
  } catch {
    execSync('git commit -m "pulse"');
    try {
      execSync("git push");
    } catch {
      execSync("git pull --rebase -X theirs");
      execSync("git push");
    }
  }
}

async function onePulse() {
  const authorization = await authHeader();
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

function handoff() {
  fs.writeFileSync(".continue", "1");
  console.log("continue");
}

const started = Date.now();

while (true) {
  if (Date.now() - started >= MAX_MS) {
    handoff();
    break;
  }
  const now = etNow();
  if (inSession(now)) {
    try {
      await onePulse();
    } catch (err) {
      console.error("pulse error", err instanceof Error ? err.message : err);
    }
    if (!inSession()) break;
    if (Date.now() - started >= MAX_MS) {
      handoff();
      break;
    }
    const tight = now.minuteOfDay >= 9 * 60 + 20 && now.minuteOfDay < 15 * 60 + 50;
    await sleep((tight ? 4 : 10) * 60 * 1000);
    continue;
  }

  const until = msUntilNextSession();
  if (until > FAR_MS) {
    try {
      await onePulse();
    } catch (err) {
      console.error("pulse error", err instanceof Error ? err.message : err);
    }
    console.log("next session is far", Math.round(until / 3600000), "h");
    break;
  }

  const budget = MAX_MS - (Date.now() - started) - 90_000;
  if (until + 60_000 < budget) {
    console.log("waiting for the open", Math.round(until / 60000), "min");
    await sleep(until);
    continue;
  }

  try {
    await onePulse();
  } catch (err) {
    console.error("pulse error", err instanceof Error ? err.message : err);
  }
  const nap = Math.max(30_000, MAX_MS - (Date.now() - started) - 90_000);
  console.log("handing off in", Math.round(nap / 60000), "min");
  await sleep(nap);
  handoff();
  break;
}

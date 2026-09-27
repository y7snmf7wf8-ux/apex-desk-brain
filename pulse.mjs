import fs from "node:fs";

const url = process.env.APEX_URL;
const secret = process.env.CRON_SECRET;
if (!url || !secret) {
  console.error("missing env");
  process.exit(1);
}
const cur = JSON.parse(fs.readFileSync("brain.json", "utf8"));
const res = await fetch(url, {
  method: "POST",
  headers: {
    authorization: `Bearer ${secret}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ blob: typeof cur.blob === "string" ? cur.blob : "" }),
});
if (!res.ok) {
  console.error("pulse failed", res.status);
  process.exit(1);
}
const next = await res.json();
if (typeof next.blob !== "string" || !next.blob) {
  console.error("no blob");
  process.exit(1);
}
fs.writeFileSync("brain.json", JSON.stringify({ blob: next.blob }) + "\n");
console.log("ok", next.blob.length);

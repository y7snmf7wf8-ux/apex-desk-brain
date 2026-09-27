import fs from "node:fs";

const url = process.env.APEX_URL;
if (!url) {
  console.error("missing url");
  process.exit(1);
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

const cur = JSON.parse(fs.readFileSync("brain.json", "utf8"));
const res = await fetch(url, {
  method: "POST",
  headers: {
    authorization,
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

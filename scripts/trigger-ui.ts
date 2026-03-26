import process from "node:process";

const owner = process.env.GITHUB_OWNER || process.env.OWNER || "local";
const repo = process.env.GITHUB_REPO || process.env.PROJECT || "xcode-agent";
const issue = process.env.ISSUE || process.env.TICKET_ID;
const agentType = process.env.AGENT_TYPE || "sonnet";
const port = process.env.PORT || "3800";

if (!issue) {
  console.error("Missing ISSUE/TICKET_ID for UI trigger");
  process.exit(1);
}

const triggerUrl = `http://127.0.0.1:${port}/trigger`;

const response = await fetch(triggerUrl, {
  method: "POST",
  headers: {
    "content-type": "application/json",
  },
  body: JSON.stringify({
    owner,
    repo,
    issue,
    agentType,
  }),
});

if (!response.ok) {
  const body = await response.text();
  console.error(`Trigger failed: ${response.status} ${body}`);
  process.exit(1);
}

const body = await response.text();
console.log(body);

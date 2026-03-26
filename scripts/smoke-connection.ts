import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";

const routerPort = parseInt(process.env.PORT || "3800", 10);
const bridgePort = parseInt(process.env.BRIDGE_WS_PORT || "9300", 10);
const timeoutMs = parseInt(process.env.SMOKE_TIMEOUT_MS || "10000", 10);

interface AgentMessage {
  type: string;
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "router health check timed out";

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${routerPort}/health`);
      if (response.ok) return;
      lastError = `router health returned ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(250);
  }

  throw new Error(lastError);
}

async function waitForBridgeMessage(): Promise<AgentMessage> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${bridgePort}?role=observer&name=smoke-test`);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("timed out waiting for bridge message"));
    }, timeoutMs);

    socket.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString()) as AgentMessage;
        clearTimeout(timer);
        socket.close();
        resolve(message);
      } catch (error) {
        clearTimeout(timer);
        socket.close();
        reject(error);
      }
    });

    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function main() {
  await waitForHealth();

  const messagePromise = waitForBridgeMessage();
  await delay(200);

  const triggerResponse = await fetch(`http://127.0.0.1:${routerPort}/trigger`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      owner: "smoke",
      repo: "xcode-agent",
      issue: 1,
      agentType: "sonnet",
    }),
  });

  if (!triggerResponse.ok) {
    throw new Error(`trigger failed with status ${triggerResponse.status}`);
  }

  const bridgeMessage = await messagePromise;

  console.log(
    JSON.stringify(
      {
        ok: true,
        routerPort,
        bridgePort,
        triggerStatus: triggerResponse.status,
        bridgeMessageType: bridgeMessage.type,
        bridgeTicketId: bridgeMessage.metadata?.ticketId,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

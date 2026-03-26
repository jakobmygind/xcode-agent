import { WebSocketServer, WebSocket } from "ws";
import { EventEmitter } from "events";
/**
 * WebSocket bridge for streaming agent output to clients (Telegram, web UI, etc.)
 */
export class AgentBridge extends EventEmitter {
    wss;
    clients = new Set();
    config;
    messageBuffer = [];
    maxBufferSize = 1000;
    constructor(config) {
        super();
        this.config = config;
        this.wss = new WebSocketServer({ port: config.port });
        this.setupWebSocket();
    }
    /**
     * Setup WebSocket server
     */
    setupWebSocket() {
        this.wss.on("connection", (ws, request) => {
            const url = new URL(request.url || "/", `ws://${request.headers.host || "localhost"}`);
            const role = url.searchParams.get("role") || "observer";
            const name = url.searchParams.get("name") || `client-${this.clients.size + 1}`;
            const client = { socket: ws, role, name };
            console.log(`[Bridge] Client connected: ${name} (${role})`);
            this.clients.add(client);
            for (const msg of this.messageBuffer) {
                ws.send(JSON.stringify(msg));
            }
            this.sendSystemEvent("client_connected", { role, name }, ws);
            this.broadcastSystemEvent("client_connected", { role, name }, ws);
            ws.on("message", (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    this.emit("command", message);
                }
                catch (error) {
                    console.error("[Bridge] Invalid message received:", error);
                }
            });
            ws.on("close", () => {
                this.clients.delete(client);
                console.log(`[Bridge] Client disconnected: ${name} (${this.clients.size} remaining)`);
                this.broadcastSystemEvent("client_disconnected", { role, name }, ws);
            });
            ws.on("error", (error) => {
                console.error("[Bridge] WebSocket error:", error);
                this.clients.delete(client);
            });
        });
        console.log(`[Bridge] WebSocket server listening on port ${this.config.port}`);
    }
    /**
     * Broadcast message to all connected clients
     */
    broadcast(message) {
        const envelopes = this.convertMessage(message);
        for (const envelope of envelopes) {
            this.bufferEnvelope(envelope);
            const data = JSON.stringify(envelope);
            for (const client of this.clients) {
                if (client.socket.readyState === WebSocket.OPEN) {
                    client.socket.send(data);
                }
            }
        }
        this.logToConsole(message);
    }
    /**
     * Send command to agent (via input file or direct)
     */
    sendCommand(command, target) {
        this.emit("command", { command, target, timestamp: Date.now() });
    }
    convertMessage(message) {
        const timestamp = new Date(message.timestamp).toISOString();
        const from = this.resolveSender(message);
        const base = (type, payload) => ({
            type,
            from,
            ts: timestamp,
            payload,
        });
        const envelopes = [];
        const metadata = message.metadata ?? {};
        switch (message.type) {
            case "output": {
                envelopes.push(base("agent_output", message.content));
                if (typeof metadata.diff === "string" && metadata.diff.trim()) {
                    envelopes.push(base("file_changed", metadata.diff));
                }
                const approvalMatch = message.content.match(/\/approve\b[^\n]*/);
                if (approvalMatch) {
                    envelopes.push(base("agent_approval_request", approvalMatch[0].trim()));
                }
                break;
            }
            case "error":
                envelopes.push(base("agent_error", message.content));
                break;
            case "thought":
                envelopes.push(base("agent_status", message.content));
                break;
            case "code":
                envelopes.push(base("file_changed", typeof metadata.diff === "string" ? metadata.diff : message.content));
                if (message.content.trim()) {
                    envelopes.push(base("agent_status", message.content));
                }
                break;
            case "build":
                envelopes.push(base("build_result", message.content));
                envelopes.push(base("agent_status", message.content));
                break;
            case "complete":
                envelopes.push(base("agent_status", message.content));
                break;
            case "input":
                envelopes.push(base("human_command", message.content));
                break;
            case "pr":
                envelopes.push(base("agent_status", message.content));
                break;
            default:
                envelopes.push(base(message.type, message.content));
                break;
        }
        return envelopes;
    }
    resolveSender(message) {
        const requested = message.metadata?.from;
        return typeof requested === "string" && requested.trim() ? requested : "agent";
    }
    bufferEnvelope(envelope) {
        this.messageBuffer.push(envelope);
        if (this.messageBuffer.length > this.maxBufferSize) {
            this.messageBuffer.shift();
        }
    }
    broadcastSystemEvent(event, details, exclude) {
        const envelope = {
            type: "system",
            from: "bridge",
            ts: new Date().toISOString(),
            payload: { event, ...details },
        };
        this.bufferEnvelope(envelope);
        const data = JSON.stringify(envelope);
        for (const client of this.clients) {
            if (client.socket !== exclude && client.socket.readyState === WebSocket.OPEN) {
                client.socket.send(data);
            }
        }
    }
    sendSystemEvent(event, details, recipient) {
        const envelope = {
            type: "system",
            from: "bridge",
            ts: new Date().toISOString(),
            payload: { event, ...details },
        };
        if (recipient.readyState === WebSocket.OPEN) {
            recipient.send(JSON.stringify(envelope));
        }
    }
    /**
     * Format and log message to console
     */
    logToConsole(message) {
        const timestamp = new Date(message.timestamp).toLocaleTimeString();
        const prefix = `[${timestamp}]`;
        switch (message.type) {
            case "output":
                process.stdout.write(message.content);
                break;
            case "error":
                console.error(`${prefix} ❌ ${message.content}`);
                break;
            case "thought":
                console.log(`${prefix} 💭 ${message.content}`);
                break;
            case "code":
                console.log(`${prefix} 📝 Code change in ${message.metadata?.file || "unknown"}`);
                break;
            case "build":
                if (message.content.includes("❌")) {
                    console.error(`${prefix} ${message.content}`);
                }
                else if (message.content.includes("✅")) {
                    console.log(`${prefix} ${message.content}`);
                }
                else {
                    console.log(`${prefix} 🔨 ${message.content}`);
                }
                break;
            case "complete":
                console.log(`${prefix} ✅ Agent completed: ${message.content}`);
                break;
            case "input":
                console.log(`${prefix} 📥 User: ${message.content}`);
                break;
            default:
                console.log(`${prefix} ${message.content}`);
        }
    }
    /**
     * Close bridge and cleanup
     */
    close() {
        for (const client of this.clients) {
            client.socket.close();
        }
        this.clients.clear();
        this.wss.close();
    }
}
//# sourceMappingURL=bridge.js.map
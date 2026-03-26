import { WebSocketServer, WebSocket } from "ws";
import { EventEmitter } from "events";
import { AgentMessage } from "./worker.js";

export interface BridgeConfig {
  port: number;
  telegramBotToken?: string;
  telegramChatId?: string;
}

/**
 * WebSocket bridge for streaming agent output to clients (Telegram, web UI, etc.)
 */
export class AgentBridge extends EventEmitter {
  private wss: WebSocketServer;
  private clients: Set<WebSocket> = new Set();
  private config: BridgeConfig;
  private messageBuffer: AgentMessage[] = [];
  private maxBufferSize = 1000;

  constructor(config: BridgeConfig) {
    super();
    this.config = config;
    this.wss = new WebSocketServer({ port: config.port });
    this.setupWebSocket();
  }

  /**
   * Setup WebSocket server
   */
  private setupWebSocket(): void {
    this.wss.on("connection", (ws: WebSocket) => {
      console.log(`[Bridge] Client connected (${this.clients.size + 1} total)`);
      this.clients.add(ws);

      // Send buffered messages to new client
      for (const msg of this.messageBuffer) {
        ws.send(JSON.stringify(msg));
      }

      ws.on("message", (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          this.emit("command", message);
        } catch (error) {
          console.error("[Bridge] Invalid message received:", error);
        }
      });

      ws.on("close", () => {
        this.clients.delete(ws);
        console.log(`[Bridge] Client disconnected (${this.clients.size} remaining)`);
      });

      ws.on("error", (error) => {
        console.error("[Bridge] WebSocket error:", error);
        this.clients.delete(ws);
      });
    });

    console.log(`[Bridge] WebSocket server listening on port ${this.config.port}`);
  }

  /**
   * Broadcast message to all connected clients
   */
  broadcast(message: AgentMessage): void {
    // Add to buffer
    this.messageBuffer.push(message);
    if (this.messageBuffer.length > this.maxBufferSize) {
      this.messageBuffer.shift();
    }

    const data = JSON.stringify(message);
    
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }

    // Also log to console with formatting
    this.logToConsole(message);
  }

  /**
   * Send command to agent (via input file or direct)
   */
  sendCommand(command: string, target?: string): void {
    this.emit("command", { command, target, timestamp: Date.now() });
  }

  /**
   * Format and log message to console
   */
  private logToConsole(message: AgentMessage): void {
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
        } else if (message.content.includes("✅")) {
          console.log(`${prefix} ${message.content}`);
        } else {
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
  close(): void {
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();
    this.wss.close();
  }
}
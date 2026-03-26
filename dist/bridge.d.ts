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
export declare class AgentBridge extends EventEmitter {
    private wss;
    private clients;
    private config;
    private messageBuffer;
    private maxBufferSize;
    constructor(config: BridgeConfig);
    /**
     * Setup WebSocket server
     */
    private setupWebSocket;
    /**
     * Broadcast message to all connected clients
     */
    broadcast(message: AgentMessage): void;
    /**
     * Send command to agent (via input file or direct)
     */
    sendCommand(command: string, target?: string): void;
    /**
     * Format and log message to console
     */
    private logToConsole;
    /**
     * Close bridge and cleanup
     */
    close(): void;
}
//# sourceMappingURL=bridge.d.ts.map
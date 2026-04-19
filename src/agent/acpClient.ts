import { EventEmitter } from 'events';
import { pino } from 'pino';
import { AgentProcess } from './process.js';

const logger = pino({
  transport: {
    target: 'pino-pretty',
  },
});

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: any;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: any;
}

export class AcpClient extends EventEmitter {
  private agent: AgentProcess;
  private pendingRequests: Map<string | number, { resolve: (res: any) => void; reject: (err: any) => void }>;
  private nextId: number = 1;
  private buffer: string = '';

  constructor(agent: AgentProcess) {
    super();
    this.agent = agent;
    this.pendingRequests = new Map();

    this.agent.on('stdout', (data: Buffer) => {
      this.handleData(data);
    });
  }

  private handleData(data: Buffer): void {
    this.buffer += data.toString();
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      try {
        // First try parsing the whole line as JSON
        const message = JSON.parse(trimmedLine);
        this.handleMessage(message);
      } catch (_err) {
        // If that fails, try to find a JSON object within the line (resilient parsing)
        const jsonMatch = trimmedLine.match(/\{.*\}/);
        if (jsonMatch) {
          try {
            const message = JSON.parse(jsonMatch[0]);
            this.handleMessage(message);
            continue;
          } catch (__err) {
            // Still not valid JSON
          }
        }

        // Log non-JSON output
        if (trimmedLine.includes('[DEBUG]') || trimmedLine.includes('[STARTUP]') || trimmedLine.includes('Ignore file')) {
          logger.trace(`Agent log: ${trimmedLine}`);
        } else {
          logger.info(`Agent stdout: ${trimmedLine}`);
        }
      }
    }
  }

  private handleMessage(message: any): void {
    logger.trace({ message }, 'Incoming JSON-RPC message');
    
    if ('id' in message && message.id !== null) {
      if ('method' in message) {
        // Inbound Request from Agent
        const request = message as JsonRpcRequest;
        this.emit('request', request);
        this.emit(`request:${request.method}`, request);
      } else {
        // Response to our request
        const response = message as JsonRpcResponse;
        // Use string keys for ID matching to avoid type mismatch (string vs number)
        const id = String(response.id);
        const pending = this.pendingRequests.get(id);
        if (pending) {
          this.pendingRequests.delete(id);
          if (response.error) {
            pending.reject(response.error);
          } else {
            pending.resolve(response.result);
          }
        } else {
          logger.warn({ id: response.id }, 'Received response for unknown request ID');
        }
      }
    } else if (message.method) {
      // Notification
      const notification = message as JsonRpcNotification;
      this.emit('notification', notification);
      this.emit(`notification:${notification.method}`, notification.params);
    }
  }

  public async request(method: string, params?: any): Promise<any> {
    const id = this.nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(String(id), { resolve, reject });
      const json = JSON.stringify(request);
      logger.trace({ json }, 'Sending JSON-RPC request');
      this.agent.send(json);
    });
  }

  public respond(id: string | number, result: any): void {
    const response: JsonRpcResponse = {
      jsonrpc: '2.0',
      id,
      result,
    };
    const json = JSON.stringify(response);
    logger.trace({ json }, 'Sending JSON-RPC response');
    this.agent.send(json);
  }

  public respondError(id: string | number, code: number, message: string, data?: any): void {
    const response: JsonRpcResponse = {
      jsonrpc: '2.0',
      id,
      error: { code, message, data },
    };
    const json = JSON.stringify(response);
    logger.trace({ json }, 'Sending JSON-RPC error response');
    this.agent.send(json);
  }

  public notify(method: string, params?: any): void {
    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };
    const json = JSON.stringify(notification);
    logger.trace({ json }, 'Sending JSON-RPC notification');
    this.agent.send(json);
  }

  // ACP Methods for Gemini CLI 0.38.0
  public async initialize(): Promise<any> {
    return this.request('initialize', {
      protocolVersion: 1,
      capabilities: {
        logging: true,
      },
    });
  }

  public async newSession(cwd: string = process.cwd()): Promise<{ sessionId: string }> {
    return this.request('session/new', {
      cwd,
      mcpServers: [],
    });
  }

  public async prompt(sessionId: string, text: string): Promise<any> {
    return this.request('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text }],
    });
  }

  public async listSessions(): Promise<{ sessions: any[] }> {
    return this.request('session/list', {});
  }

  public async loadSession(sessionId: string): Promise<any> {
    return this.request('session/load', { sessionId });
  }

  public cancel(sessionId: string): void {
    this.notify('session/cancel', { sessionId });
  }
}

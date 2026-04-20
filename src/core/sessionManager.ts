import { AcpClient } from '../agent/acpClient.js';
import { pino } from 'pino';
import { type MessageContext } from '../adapters/types.js';

const logger = pino({
  transport: {
    target: 'pino-pretty',
  },
});

export class SessionManager {
  private client: AcpClient;
  // Maps platform:contextId -> sessionId
  private channelToSession: Map<string, string>;
  // Maps sessionId -> context
  private sessionToContext: Map<string, MessageContext>;
  // List of all unique session IDs seen in this process, for indexing
  private sessionRegistry: string[];

  constructor(client: AcpClient) {
    this.client = client;
    this.channelToSession = new Map();
    this.sessionToContext = new Map();
    this.sessionRegistry = [];
  }

  public async getSessionForContext(context: MessageContext): Promise<string> {
    const key = `${context.platform}:${context.channelId}`;
    let sessionId = this.channelToSession.get(key);

    if (!sessionId) {
      logger.info(`Creating new session for ${key}`);
      const response = await this.client.newSession(process.env.GEMINI_CWD || process.cwd());
      sessionId = response.sessionId;
      this.registerSession(sessionId, context);
      this.channelToSession.set(key, sessionId);
    }

    return sessionId;
  }

  private registerSession(sessionId: string, context: MessageContext) {
    if (!this.sessionRegistry.includes(sessionId)) {
      this.sessionRegistry.push(sessionId);
    }
    this.sessionToContext.set(sessionId, context);
  }

  public async createNewSessionForContext(context: MessageContext, cwd?: string): Promise<string> {
    const key = `${context.platform}:${context.channelId}`;
    const response = await this.client.newSession(cwd || process.env.GEMINI_CWD || process.cwd());
    const sessionId = response.sessionId;
    this.registerSession(sessionId, context);
    this.channelToSession.set(key, sessionId);
    return sessionId;
  }

  public async listAllSessions(): Promise<string[]> {
    // Return the registry (which may grow as we interact)
    return this.sessionRegistry;
  }

  public switchSession(context: MessageContext, index: number): string | null {
    if (index < 0 || index >= this.sessionRegistry.length) {
      return null;
    }
    const sessionId = this.sessionRegistry[index];
    if (!sessionId) return null;
    
    const key = `${context.platform}:${context.channelId}`;
    this.channelToSession.set(key, sessionId);
    return sessionId;
  }

  public getContextForSession(sessionId: string): MessageContext | undefined {
    return this.sessionToContext.get(sessionId);
  }

  public getCurrentSessionId(platform: string, channelId: string): string | undefined {
    const key = `${platform}:${channelId}`;
    return this.channelToSession.get(key);
  }

  public removeSession(platform: string, contextId: string): void {
    const key = `${platform}:${contextId}`;
    const sessionId = this.channelToSession.get(key);
    if (sessionId) {
      // We don't remove from registry to keep indices stable
      this.sessionToContext.delete(sessionId);
    }
    this.channelToSession.delete(key);
  }
}

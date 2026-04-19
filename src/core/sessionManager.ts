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
  private sessions: Map<string, string>;
  // Maps sessionId -> context
  private sessionToContext: Map<string, MessageContext>;

  constructor(client: AcpClient) {
    this.client = client;
    this.sessions = new Map();
    this.sessionToContext = new Map();
  }

  public async getSessionForContext(context: MessageContext): Promise<string> {
    const key = `${context.platform}:${context.channelId}`;
    let sessionId = this.sessions.get(key);

    if (!sessionId) {
      logger.info(`Creating new session for ${key}`);
      const response = await this.client.newSession(process.env.GEMINI_CWD || process.cwd());
      sessionId = response.sessionId;
      this.sessions.set(key, sessionId);
    }

    this.sessionToContext.set(sessionId, context);
    return sessionId;
  }

  public getContextForSession(sessionId: string): MessageContext | undefined {
    return this.sessionToContext.get(sessionId);
  }

  public removeSession(platform: string, contextId: string): void {
    const key = `${platform}:${contextId}`;
    const sessionId = this.sessions.get(key);
    if (sessionId) {
      this.sessionToContext.delete(sessionId);
    }
    this.sessions.delete(key);
  }
}

import { pino } from 'pino';
import { AcpClient } from '../agent/acpClient.js';
import { SessionManager } from './sessionManager.js';
import { type MessageContext, BaseAdapter } from '../adapters/types.js';

const logger = pino({
  level: process.env.LOG_LEVEL || 'debug',
  transport: {
    target: 'pino-pretty',
  },
});

export class CommandHandler {
  private client: AcpClient;
  private sessionManager: SessionManager;
  private adapters: BaseAdapter[];
  private messageBuffers: Map<string, string>;
  private thoughtBuffers: Map<string, string>;
  private pendingPermissions: Map<string, { id: string | number, options: any[], context: MessageContext }>;
  private activeTurnContexts: Map<string, MessageContext>;

  constructor(
    client: AcpClient,
    sessionManager: SessionManager,
    adapters: BaseAdapter[],
    messageBuffers: Map<string, string>,
    thoughtBuffers: Map<string, string>,
    pendingPermissions: Map<string, { id: string | number, options: any[], context: MessageContext }>,
    activeTurnContexts: Map<string, MessageContext>
  ) {
    this.client = client;
    this.sessionManager = sessionManager;
    this.adapters = adapters;
    this.messageBuffers = messageBuffers;
    this.thoughtBuffers = thoughtBuffers;
    this.pendingPermissions = pendingPermissions;
    this.activeTurnContexts = activeTurnContexts;
  }

  public handleMessage = async (context: MessageContext) => {
    logger.info(`[TURN START] Platform: ${context.platform}, Channel: ${context.channelId}, User: ${context.userId}: "${context.text}"`);
    
    // 5.1 Handle Slash Commands (and now without slash too)
    const triggerText = context.text.trim().toLowerCase();
    if (triggerText.startsWith('/session') || triggerText.startsWith('session ')) {
      const parts = triggerText.startsWith('/') ? triggerText.split(' ') : ['/session', ...triggerText.split(' ').slice(1)];
      const subcommand = parts[1] || 'new'; // default to new if just /session
      const adapter = this.adapters.find(a => a.constructor.name.toLowerCase().includes(context.platform.toLowerCase()));

      if (subcommand === 'new') {
        const path = parts.slice(2).join(' ').trim();
        logger.info({ platform: context.platform, channelId: context.channelId, path }, 'Starting new session');
        const sessionId = await this.sessionManager.createNewSessionForContext(context, path || undefined);
        if (adapter) {
          let msg = `✨ *New session started.* ID: \`${sessionId}\``;
          if (path) {
            msg += `\nScoped to: \`${path}\``;
          }
          await adapter.sendReply(context, msg);
        }
        return;
      }

      if (subcommand === 'ls' || subcommand === 'list') {
        const sessions = await this.sessionManager.listAllSessions();
        const currentId = this.sessionManager.getCurrentSessionId(context.platform, context.channelId);
        
        if (adapter) {
          if (sessions.length === 0) {
            await adapter.sendReply(context, '📂 *No active sessions found.*');
          } else {
            const list = sessions.map((id, index) => {
              const ctx = this.sessionManager.getContextForSession(id);
              const info = ctx ? ` (${ctx.platform})` : '';
              const marker = id === currentId ? ' ✅' : '';
              return `${index}. \`${id}\`${info}${marker}`;
            }).join('\n');
            await adapter.sendReply(context, `📂 *Active Sessions:*\n${list}\n\nUse \`/session use <number>\` to switch.`);
          }
        }
        return;
      }

      if (subcommand === 'use' || subcommand === 'switch') {
        const index = parseInt(parts[2] || '');
        if (isNaN(index)) {
          if (adapter) await adapter.sendReply(context, '❌ *Please provide a session number.* Example: `/session use 0`');
          return;
        }

        const sessionId = this.sessionManager.switchSession(context, index);
        if (adapter) {
          if (sessionId) {
            await adapter.sendReply(context, `🔄 *Switched to session ${index}:* \`${sessionId}\``);
          } else {
            await adapter.sendReply(context, `❌ *Invalid session number:* ${index}. Use \`/session ls\` to see available sessions.`);
          }
        }
        return;
      }

      // If command not recognized
      if (adapter) {
        await adapter.sendReply(context, '❓ *Unknown subcommand.* Available: `new`, `ls`, `use <n>`');
      }
      return;
    }

    try {
      const sessionId = await this.sessionManager.getSessionForContext(context);
      logger.debug(`[TURN] Using ACP Session: ${sessionId}`);

      // Check for pending permission
      const pending = this.pendingPermissions.get(sessionId);
      if (pending) {
        const text = context.text.toLowerCase().trim();
        const isAlways = ['always', 'always allow', 'aa'].includes(text);
        const isYes = isAlways || ['yes', 'y', 'approve', 'ok', 'allow'].includes(text);
        const isNo = ['no', 'n', 'reject', 'cancel', 'deny'].includes(text);

        if (isYes || isNo) {
           logger.info({ sessionId, isYes, isAlways }, '[TURN] User responded to permission');
           
           // Find matching option
           let kind = '';
           if (isAlways) {
             kind = 'allow_always';
           } else {
             kind = isYes ? 'allow_once' : 'reject_once';
           }

           const option = pending.options.find(o => o.kind === kind) || 
                          pending.options.find(o => isYes ? o.kind.startsWith('allow') : o.kind.startsWith('reject'));
           
           if (option) {
             this.pendingPermissions.delete(sessionId);
             this.client.respond(pending.id, { 
               outcome: {
                 outcome: 'selected',
                 optionId: option.optionId
               }
             });
             return;
           } else {
             logger.warn({ options: pending.options }, 'No matching permission option found');
             this.pendingPermissions.delete(sessionId);
             this.client.respond(pending.id, { outcome: { outcome: isYes ? 'approved' : 'rejected' } });
             return;
           }
        }
      }

      // Start of a new turn
      this.activeTurnContexts.set(sessionId, context);
      this.messageBuffers.set(sessionId, '');
      this.thoughtBuffers.set(sessionId, '');
      // toolOutputBuffers is not explicitly passed but we can manage it or just rely on notifications
      // Actually toolOutputBuffers WAS used in index.ts but only for logging and streaming
      // index.ts handles notifications for toolOutputBuffers

      // Pass the message to the agent
      logger.debug('[TURN] Sending prompt to agent...');
      const result = await this.client.prompt(sessionId, context.text);
      logger.info({ sessionId, result }, '[TURN] Agent prompt request resolved');
      
      // Turn finished
      this.activeTurnContexts.delete(sessionId);

      // Collect collected text
      const messageText = (this.messageBuffers.get(sessionId) || '').trim();
      const thoughtText = (this.thoughtBuffers.get(sessionId) || '').trim();
      
      logger.debug({ messageLength: messageText.length, thoughtLength: thoughtText.length }, '[TURN] Buffers collected');

      // Fallback to result content if buffer is empty
      let responseText = messageText;
      if (!responseText) {
        responseText = (result?.content?.[0]?.text || result?.text || '').trim();
        if (responseText) {
          logger.debug('[TURN] Falling back to result text');
        }
      }

      // Prepare final response
      let finalOutput = '';
      if (thoughtText) {
        const thoughtLines = thoughtText.split('\n');
        finalOutput += thoughtLines.map(line => `> ${line}`).join('\n') + '\n\n';
      }
      
      finalOutput += responseText;

      // Find the adapter to send reply
      const adapter = this.adapters.find(a => {
        const name = a.constructor.name.toLowerCase();
        return name.includes(context.platform.toLowerCase());
      });

      if (finalOutput.trim()) {
        if (adapter) {
          logger.info({ platform: context.platform, length: finalOutput.length }, '[TURN] Sending final reply to bot');
          await adapter.sendReply(context, finalOutput);
        } else {
          logger.error({ platform: context.platform }, '[TURN] CRITICAL: No adapter found for platform');
        }
      } else {
        logger.warn({ sessionId }, '[TURN] Agent returned no text content');
        
        if (adapter) {
          if (result?.stop_reason && result.stop_reason !== 'end_turn') {
            await adapter.sendReply(context, `_Turn ended: ${result.stop_reason}_`);
          }
        }
      }
      logger.info('[TURN DONE]');
    } catch (err: any) {
      logger.error({ error: err }, '[TURN ERROR]');
      
      const errorMessage = err?.message || String(err);
      const adapter = this.adapters.find(a => a.constructor.name.toLowerCase().includes(context.platform.toLowerCase()));
      if (adapter) {
        await adapter.sendReply(context, `Error: ${errorMessage}`);
      }
    }
  };
}

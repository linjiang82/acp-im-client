import { pino } from 'pino';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { type AcpClient } from '../agent/acpClient.js';
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
  private pendingDirCreations: Map<string, string>;

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
    this.pendingDirCreations = new Map();
  }

  public handleMessage = async (context: MessageContext) => {
    logger.info(`[TURN START] Platform: ${context.platform}, Channel: ${context.channelId}, User: ${context.userId}: "${context.text}"`);
    
    const adapter = this.adapters.find(a => a.constructor.name.toLowerCase().includes(context.platform.toLowerCase()));

    // 5.0 Handle Pending Directory Creations
    const contextKey = `${context.platform}:${context.channelId}:${context.threadId || ''}`;
    const pendingPath = this.pendingDirCreations.get(contextKey);

    if (pendingPath) {
      const text = context.text.toLowerCase().trim();
      const isYes = ['yes', 'y', 'create', 'ok'].includes(text);
      const isNo = ['no', 'n', 'cancel', 'reject'].includes(text);

      if (isYes) {
        try {
          fs.mkdirSync(pendingPath, { recursive: true });
          this.pendingDirCreations.delete(contextKey);
          
          if (adapter) await adapter.sendReply(context, `✅ *Directory created:* \`${pendingPath}\``);
          
          const sessionId = await this.sessionManager.createNewSessionForContext(context, pendingPath);
          if (adapter) {
            await adapter.sendReply(context, `✨ *New session started.* ID: \`${sessionId}\`\nScoped to: \`${pendingPath}\``);
          }
          return;
        } catch (err: any) {
          logger.error({ err, path: pendingPath }, 'Failed to create directory');
          this.pendingDirCreations.delete(contextKey);
          if (adapter) await adapter.sendReply(context, `❌ *Failed to create directory:* ${err.message}`);
          return;
        }
      } else if (isNo) {
        this.pendingDirCreations.delete(contextKey);
        if (adapter) await adapter.sendReply(context, '❌ *Session creation cancelled.*');
        return;
      } else {
        if (adapter) await adapter.sendReply(context, '❓ *Please answer "yes" or "no" to create the directory.*');
        return;
      }
    }

    // 5.1 Handle Slash Commands (and now without slash too)
    const triggerText = context.text.trim().toLowerCase();
    if (triggerText.startsWith('/session') || triggerText.startsWith('session ')) {
      const parts = triggerText.startsWith('/') ? triggerText.split(' ') : ['/session', ...triggerText.split(' ').slice(1)];
      const subcommand = parts[1] || 'new'; // default to new if just /session

      if (subcommand === 'new') {
        let inputPath = parts.slice(2).join(' ').trim();
        let resolvedPath: string | undefined = undefined;

        if (inputPath) {
          if (path.isAbsolute(inputPath)) {
            resolvedPath = inputPath;
          } else {
            resolvedPath = path.join(os.homedir(), inputPath);
          }
        }

        if (resolvedPath && !fs.existsSync(resolvedPath)) {
          this.pendingDirCreations.set(contextKey, resolvedPath);
          if (adapter) {
            await adapter.sendReply(context, `📁 *Directory \`${resolvedPath}\` does not exist. Do you want to create it? (yes/no)*`);
          }
          return;
        }

        logger.info({ platform: context.platform, channelId: context.channelId, inputPath, resolvedPath }, 'Starting new session');
        const sessionId = await this.sessionManager.createNewSessionForContext(context, resolvedPath);
        if (adapter) {
          let msg = `✨ *New session started.* ID: \`${sessionId}\``;
          if (resolvedPath) {
            msg += `\nScoped to: \`${resolvedPath}\``;
          }
          await adapter.sendReply(context, msg);
        }
        return;
      }

      if (subcommand === 'ls' || subcommand === 'list') {
        const sessions = await this.sessionManager.listAllSessions();
        const currentId = this.sessionManager.getCurrentSessionId(context.platform, context.channelId, context.threadId);
        
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

      if (subcommand === 'status') {
        const sessionId = this.sessionManager.getCurrentSessionId(context.platform, context.channelId, context.threadId);
        if (!sessionId) {
          if (adapter) await adapter.sendReply(context, '❌ *No active session found for this channel.*');
          return;
        }

        const usage = this.sessionManager.getUsage(sessionId);
        if (adapter) {
          if (usage) {
            const rate = usage.size > 0 ? ((usage.used / usage.size) * 100).toFixed(2) : '0.00';
            const msg = `📊 *Session Status:* \`${sessionId}\`
• Tokens Used: \`${usage.used.toLocaleString()}\`
• Context Size: \`${usage.size.toLocaleString()}\`
• Usage Rate: \`${rate}%\``;
            await adapter.sendReply(context, msg);
          } else {
            await adapter.sendReply(context, `📊 *Session Status:* \`${sessionId}\`
_No usage data available yet. Send a message first._`);
          }
        }
        return;
      }

      // If command not recognized
      if (adapter) {
        await adapter.sendReply(context, '❓ *Unknown subcommand.* Available: `new`, `ls`, `use <n>`, `status`');
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

      // Start typing indicator
      if (adapter && adapter.sendTyping) {
        await adapter.sendTyping(context);
      }
      const typingInterval = setInterval(async () => {
        if (adapter && adapter.sendTyping && this.activeTurnContexts.has(sessionId)) {
          await adapter.sendTyping(context);
        } else {
          clearInterval(typingInterval);
        }
      }, 8000); // Send every 8 seconds

      // Pass the message to the agent
      logger.debug('[TURN] Sending prompt to agent...');
      const result = await this.client.prompt(sessionId, context.text);
      logger.info({ sessionId, result }, '[TURN] Agent prompt request resolved');
      
      // Turn finished
      clearInterval(typingInterval);
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

      // Update session manager with usage data if present in result
      if (result?.usage) {
        const { total_tokens } = result.usage;
        const currentUsage = this.sessionManager.getUsage(sessionId);
        this.sessionManager.updateUsage(sessionId, {
          used: total_tokens ?? currentUsage?.used ?? 0,
          size: result.usage.size ?? result.usage.context_size ?? currentUsage?.size ?? 1000000 // default or existing
        });
      }

      // Always try to append usage footer if we have data in session manager
      const finalUsage = this.sessionManager.getUsage(sessionId);
      if (finalUsage && finalUsage.used > 0) {
        // We only have total 'used' in session manager's SessionUsage interface
        // If we want prompt/completion details, we'd need to expand that interface.
        // For now, let's at least show the total used.
        finalOutput += `\n\n_${finalUsage.used.toLocaleString()} tokens used_`;
      }

      if (finalOutput.trim()) {        if (adapter) {
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
        if (adapter) {
        await adapter.sendReply(context, `Error: ${errorMessage}`);
        }
        }  };
}

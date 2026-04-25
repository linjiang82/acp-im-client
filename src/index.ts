import 'dotenv/config';
import { pino } from 'pino';
import { AgentProcess } from './agent/process.js';
import { AcpClient } from './agent/acpClient.js';
import { SessionManager } from './core/sessionManager.js';
import { SlackAdapter } from './adapters/slack.js';
import { DiscordAdapter } from './adapters/discord.js';
import { TelegramAdapter } from './adapters/telegram.js';
import { type MessageContext, BaseAdapter } from './adapters/types.js';
import { CommandHandler } from './core/commandHandler.js';

const logger = pino({
  level: process.env.LOG_LEVEL || 'debug',
  transport: {
    target: 'pino-pretty',
  },
});

async function main() {
  logger.info('Starting ACP IM Client');

  // 1. Start Agent Process
  const geminiPath = process.env.GEMINI_PATH || 'gemini';
  const agent = new AgentProcess(geminiPath);
  agent.start();
  logger.info(`Agent process started with PID: ${agent.getPid()}`);

  // 2. Initialize ACP Client
  const client = new AcpClient(agent);
  
  try {
    await client.initialize();
    logger.info('ACP Client initialized');
  } catch (_err) {
    logger.error('Failed to initialize ACP Client');
    process.exit(1);
  }

  // 3. Initialize Session Manager
  const sessionManager = new SessionManager(client);

  // 4. Initialize Adapters
  const adapters: BaseAdapter[] = [];

  if (process.env.SLACK_BOT_TOKEN && process.env.SLACK_BOT_TOKEN !== 'xoxb-your-bot-token') {
    if (process.env.SLACK_APP_TOKEN) {
      const slack = new SlackAdapter(process.env.SLACK_BOT_TOKEN, process.env.SLACK_APP_TOKEN);
      adapters.push(slack);
      logger.info('Slack adapter added');
    } else {
      logger.warn('Slack Bot Token provided but SLACK_APP_TOKEN is missing. Slack adapter skipped (Socket Mode requires an App Token).');
    }
  } else {
    logger.debug('Slack tokens not configured or default, skipping Slack adapter');
  }

  if (process.env.DISCORD_TOKEN && process.env.DISCORD_TOKEN !== 'your-discord-bot-token') {
    const discord = new DiscordAdapter(process.env.DISCORD_TOKEN);
    adapters.push(discord);
    logger.info('Discord adapter added');
  }

  if (process.env.TELEGRAM_TOKEN && process.env.TELEGRAM_TOKEN !== 'your-telegram-bot-token') {
    const telegram = new TelegramAdapter(process.env.TELEGRAM_TOKEN);
    adapters.push(telegram);
    logger.info('Telegram adapter added');
  }

  if (adapters.length === 0) {
    logger.warn('No IM adapters configured. Bot will not be accessible via IM.');
  }

  // Buffers to store streaming responses per session
  const messageBuffers = new Map<string, string>();
  const thoughtBuffers = new Map<string, string>();
  const toolOutputBuffers = new Map<string, string>();
  
  // Pending permissions: sessionId -> { requestId, options, context }
  const pendingPermissions = new Map<string, { id: string | number, options: any[], context: MessageContext }>();

  // Track if a turn is active (to stream terminal output)
  const activeTurnContexts = new Map<string, MessageContext>();

  client.on('notification:session/update', async (params: any) => {
    const { sessionId, update } = params;
    if (!sessionId || !update) return;

    logger.debug({ sessionId, updateType: update.sessionUpdate, rawUpdate: update }, 'Received session update');

    if (update.sessionUpdate === 'agent_message_chunk') {
      const text = update.content?.text || update.delta || (typeof update.content === 'string' ? update.content : '');
      const current = messageBuffers.get(sessionId) || '';
      messageBuffers.set(sessionId, current + text);
    } else if (update.sessionUpdate === 'usage_update') {
      if (update.usage) {
        sessionManager.updateUsage(sessionId, {
          used: update.usage.used || 0,
          size: update.usage.size || 0
        });
      }
    } else if (update.sessionUpdate === 'tool_call') {
      const toolName = update.title || update.name || 'Unknown tool';
      const toolInput = update.rawInput ? (typeof update.rawInput === 'string' ? update.rawInput : JSON.stringify(update.rawInput, null, 2)) : '';
      
      logger.info({ tool: toolName }, 'Agent is calling tool');
      const context = activeTurnContexts.get(sessionId);
      if (context) {
        const adapter = adapters.find(a => a.constructor.name.toLowerCase().includes(context.platform.toLowerCase()));
        if (adapter) {
          let msg = `🛠️ *Agent is calling tool:* \`${toolName}\``;
          if (toolInput) {
            msg += `\n\`\`\`\n${toolInput}\n\`\`\``;
          }
          await adapter.sendReply(context, msg);
        }
      }
    } else if (update.sessionUpdate === 'tool_call_update') {
      if (update.status === 'completed' && update.content) {
        for (const part of update.content) {
          if (part.type === 'content' && part.content?.text) {
            const resultText = `\n\n✅ *[${update.title || 'Tool Result'}]*:\n\`\`\`\n${part.content.text}\n\`\`\``;
            const current = toolOutputBuffers.get(sessionId) || '';
            toolOutputBuffers.set(sessionId, current + resultText);
            
            const context = activeTurnContexts.get(sessionId);
            if (context) {
              const adapter = adapters.find(a => a.constructor.name.toLowerCase().includes(context.platform.toLowerCase()));
              if (adapter) {
                await adapter.sendReply(context, resultText);
              }
            }
          }
        }
      }
    }
  });

  client.on('notification:terminal/output', async (params: any) => {
    const { sessionId, output } = params;
    if (!sessionId || !output) return;
    
    logger.debug({ sessionId, output }, 'Received terminal output');
    const current = toolOutputBuffers.get(sessionId) || '';
    toolOutputBuffers.set(sessionId, current + output);

    const context = activeTurnContexts.get(sessionId);
    if (context) {
      const adapter = adapters.find(a => a.constructor.name.toLowerCase().includes(context.platform.toLowerCase()));
      if (adapter) {
        // Only stream if it's significant or after a delay to avoid spamming
        // For now, just forward it.
        await adapter.sendReply(context, `\`\`\`\n${output}\n\`\`\``);
      }
    }
  });

  client.on('request', (request: any) => {
    // Log all incoming requests to find missing handlers
    if (!['session/request_permission'].includes(request.method)) {
      logger.warn({ request }, 'Received unhandled request from agent');
      // Always respond to avoid hanging the agent, even if it's an error
      client.respondError(request.id, -32601, `Method not implemented: ${request.method}`);
    }
  });

  client.on('request:session/request_permission', async (request: any) => {
    const { sessionId, toolCall, options } = request.params;
    logger.info({ sessionId, toolCall, options }, 'Received permission request');
    
    const context = sessionManager.getContextForSession(sessionId);
    if (!context) {
      logger.error({ sessionId }, 'Received permission request for unknown session');
      client.respondError(request.id, -32603, 'Session not found');
      return;
    }

    pendingPermissions.set(sessionId, { id: request.id, options: options || [], context });
    
    // Find adapter
    const adapter = adapters.find(a => a.constructor.name.toLowerCase().includes(context.platform.toLowerCase()));
    if (adapter) {
      const description = toolCall?.title || toolCall?.content?.[0]?.text || 'Sensitive action';
      await adapter.sendReply(context, `🔒 *Agent needs permission:* ${description}\n\nType *yes* to approve, *always* to always allow, or *no* to reject.`);
    }
  });

  // 5. Unified Message Handler
  const commandHandler = new CommandHandler(
    client,
    sessionManager,
    adapters,
    messageBuffers,
    thoughtBuffers,
    pendingPermissions,
    activeTurnContexts
  );

  const handleMessage = commandHandler.handleMessage;

  // 6. Start Adapters
  for (const adapter of adapters) {
    adapter.setMessageHandler(handleMessage);
    await adapter.start();
  }

  logger.info('All adapters started and ready');

  // Graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('Shutting down...');
    for (const adapter of adapters) {
      await adapter.stop();
    }
    agent.stop();
    process.exit(0);
  });
}

main().catch(err => {
  logger.error(`Main error: ${err}`);
  process.exit(1);
});

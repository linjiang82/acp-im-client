import { Telegraf } from 'telegraf';
import { BaseAdapter, type MessageContext } from './types.js';
import { pino } from 'pino';
import { splitText } from '../utils/text.js';

const logger = pino({
  transport: {
    target: 'pino-pretty',
  },
});

export class TelegramAdapter extends BaseAdapter {
  private bot: Telegraf;
  private readonly MAX_MESSAGE_LENGTH = 4096;

  constructor(token: string) {
    super();
    this.bot = new Telegraf(token);

    this.bot.on('text', async (ctx) => {
      const context: MessageContext = {
        platform: 'telegram',
        channelId: ctx.chat.id.toString(),
        userId: ctx.from.id.toString(),
        text: ctx.message.text,
        threadId: (ctx.message as any).message_thread_id?.toString(),
      };

      if (this.onMessage) {
        await this.onMessage(context);
      }
    });
  }

  public async start(): Promise<void> {
    logger.info('Starting Telegram adapter');
    this.bot.launch();
  }

  public async stop(): Promise<void> {
    logger.info('Stopping Telegram adapter');
    this.bot.stop();
  }

  public async sendReply(context: MessageContext, text: string): Promise<void> {
    const chunks = splitText(text, this.MAX_MESSAGE_LENGTH);
    for (const chunk of chunks) {
      if (chunk.trim()) {
        await this.bot.telegram.sendMessage(context.channelId, chunk, {
          message_thread_id: context.threadId ? parseInt(context.threadId) : undefined
        });
      }
    }
  }

  public override async sendTyping(context: MessageContext): Promise<void> {
    try {
      await this.bot.telegram.sendChatAction(context.channelId, 'typing');
    } catch (err) {
      logger.error({ err, context }, 'Failed to send Telegram typing indicator');
    }
  }
}

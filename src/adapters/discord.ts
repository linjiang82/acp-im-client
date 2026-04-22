import { Client, GatewayIntentBits, Message, Partials } from 'discord.js';
import { BaseAdapter, type MessageContext } from './types.js';
import { pino } from 'pino';
import { splitText } from '../utils/text.js';

const logger = pino({
  transport: {
    target: 'pino-pretty',
  },
});

export class DiscordAdapter extends BaseAdapter {
  private client: Client;
  private token: string;
  private readonly MAX_MESSAGE_LENGTH = 2000;

  constructor(token: string) {
    super();
    this.token = token;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel, Partials.Message],
    });

    this.client.on('messageCreate', async (message: Message) => {
      if (message.partial) {
        try {
          await message.fetch();
        } catch (err) {
          logger.error({ err }, 'Error fetching partial message');
          return;
        }
      }
      if (message.author.bot) return;

      const context: MessageContext = {
        platform: 'discord',
        channelId: message.channelId,
        userId: message.author.id,
        text: message.content,
        threadId: message.thread?.id,
      };

      if (this.onMessage) {
        await this.onMessage(context);
      }
    });
  }

  public async start(): Promise<void> {
    logger.info('Starting Discord adapter');
    await this.client.login(this.token);
  }

  public async stop(): Promise<void> {
    logger.info('Stopping Discord adapter');
    this.client.destroy();
  }

  public async sendReply(context: MessageContext, text: string): Promise<void> {
    const channel = await this.client.channels.fetch(context.channelId);
    if (channel && 'send' in channel && typeof channel.send === 'function') {
      const chunks = splitText(text, this.MAX_MESSAGE_LENGTH);
      for (const chunk of chunks) {
        if (chunk.trim()) {
          // If threadId is present and different from channelId, we might want to send to thread
          // But in Discord, thread is a channel. If we are already in the thread channel, channel.send works.
          // If we want to reply to a specific message to start a thread, it's different.
          // For now, simple send to the channel/thread provided in channelId.
          await (channel as any).send(chunk);
        }
      }
    }
  }
}

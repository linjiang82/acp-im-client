import { Client, GatewayIntentBits, Message, TextChannel } from 'discord.js';
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
    });

    this.client.on('messageCreate', async (message: Message) => {
      if (message.author.bot) return;

      const context: MessageContext = {
        platform: 'discord',
        channelId: message.channelId,
        userId: message.author.id,
        text: message.content,
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
    if (channel instanceof TextChannel) {
      const chunks = splitText(text, this.MAX_MESSAGE_LENGTH);
      for (const chunk of chunks) {
        if (chunk.trim()) {
          await channel.send(chunk);
        }
      }
    }
  }
}

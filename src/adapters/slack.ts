import pkg from '@slack/bolt';
const { App } = pkg;
import { BaseAdapter, type MessageContext } from './types.js';
import { pino } from 'pino';
import { splitText } from '../utils/text.js';

const logger = pino({
  transport: {
    target: 'pino-pretty',
  },
});

export class SlackAdapter extends BaseAdapter {
  private app: any;
  private readonly MAX_MESSAGE_LENGTH = 4000;

  constructor(token: string, appToken: string) {
    super();
    this.app = new App({
      token: token,
      appToken: appToken,
      socketMode: true,
    });

    this.app.message(async ({ message }: any) => {
      if (!message.text || message.bot_id) return;

      const context: MessageContext = {
        platform: 'slack',
        channelId: message.channelId || message.channel,
        userId: message.user,
        text: message.text,
        threadId: message.thread_ts,
      };

      if (this.onMessage) {
        await this.onMessage(context);
      }
    });
  }

  public async start(): Promise<void> {
    logger.info('Starting Slack adapter');
    await this.app.start();
  }

  public async stop(): Promise<void> {
    logger.info('Stopping Slack adapter');
    await this.app.stop();
  }

  public async sendReply(context: MessageContext, text: string): Promise<void> {
    const chunks = splitText(text, this.MAX_MESSAGE_LENGTH);
    for (const chunk of chunks) {
      if (chunk.trim()) {
        await this.app.client.chat.postMessage({
          channel: context.channelId,
          text: chunk,
          thread_ts: context.threadId,
        });
      }
    }
  }
}

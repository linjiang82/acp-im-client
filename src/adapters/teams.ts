import { BotFrameworkAdapter, TurnContext } from 'botbuilder';
import { BaseAdapter, type MessageContext } from './types.js';
import { pino } from 'pino';

const logger = pino({
  transport: {
    target: 'pino-pretty',
  },
});

export class TeamsAdapter extends BaseAdapter {
  private adapter: BotFrameworkAdapter;

  constructor(appId: string, appPassword: string) {
    super();
    this.adapter = new BotFrameworkAdapter({
      appId: appId,
      appPassword: appPassword,
    });
  }

  public async start(): Promise<void> {
    logger.info('Teams adapter started (server should be listening for incoming requests)');
  }

  public async stop(): Promise<void> {
    logger.info('Stopping Teams adapter');
  }

  // Note: Teams usually requires an HTTP endpoint to receive messages.
  // This processMessage would be called by the HTTP server.
  public async processMessage(req: any, res: any): Promise<void> {
    await this.adapter.processActivity(req, res, async (turnContext: TurnContext) => {
      if (turnContext.activity.type === 'message' && turnContext.activity.text) {
        const context: MessageContext = {
          platform: 'teams',
          channelId: turnContext.activity.conversation.id,
          userId: turnContext.activity.from.id,
          text: turnContext.activity.text,
        };

        if (this.onMessage) {
          await this.onMessage(context);
        }
      }
    });
  }

  public async sendReply(_context: MessageContext, _text: string): Promise<void> {
    // This is simplified. Normally we'd need the original TurnContext or service URL.
    logger.warn('sendReply for Teams is not fully implemented: requires TurnContext state management');
  }
}

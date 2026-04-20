import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandHandler } from '../core/commandHandler.js';
import { SessionManager } from '../core/sessionManager.js';
import { AcpClient } from '../agent/acpClient.js';
import { type MessageContext, BaseAdapter } from '../adapters/types.js';

class MockAdapter extends BaseAdapter {
  public async start() {}
  public async stop() {}
  public sendReply = vi.fn();
}

describe('CommandHandler', () => {
  let mockClient: any;
  let mockSessionManager: any;
  let mockAdapter: MockAdapter;
  let commandHandler: CommandHandler;
  
  const messageBuffers = new Map<string, string>();
  const thoughtBuffers = new Map<string, string>();
  const pendingPermissions = new Map<string, any>();
  const activeTurnContexts = new Map<string, MessageContext>();

  beforeEach(() => {
    mockClient = {
      prompt: vi.fn(),
      respond: vi.fn(),
    };
    mockSessionManager = {
      getSessionForContext: vi.fn(),
      createNewSessionForContext: vi.fn(),
      listAllSessions: vi.fn(),
      getCurrentSessionId: vi.fn(),
      getContextForSession: vi.fn(),
      switchSession: vi.fn(),
    };
    mockAdapter = new MockAdapter();
    
    commandHandler = new CommandHandler(
      mockClient as any,
      mockSessionManager as any,
      [mockAdapter],
      messageBuffers,
      thoughtBuffers,
      pendingPermissions,
      activeTurnContexts
    );

    vi.clearAllMocks();
    messageBuffers.clear();
    thoughtBuffers.clear();
    pendingPermissions.clear();
    activeTurnContexts.clear();
  });

  it('should handle /session ls command', async () => {
    const context: MessageContext = { platform: 'mock', channelId: 'c1', userId: 'u1', text: '/session ls' };
    mockSessionManager.listAllSessions.mockResolvedValue(['s1', 's2']);
    mockSessionManager.getCurrentSessionId.mockReturnValue('s1');
    mockSessionManager.getContextForSession.mockReturnValue({ platform: 'mock' });

    await commandHandler.handleMessage(context);

    expect(mockAdapter.sendReply).toHaveBeenCalledWith(
      context,
      expect.stringContaining('Active Sessions')
    );
    expect(mockAdapter.sendReply).toHaveBeenCalledWith(
      context,
      expect.stringContaining('0. `s1` (mock) ✅')
    );
  });

  it('should handle session ls command (without slash)', async () => {
    const context: MessageContext = { platform: 'mock', channelId: 'c1', userId: 'u1', text: 'session ls' };
    mockSessionManager.listAllSessions.mockResolvedValue(['s1']);
    mockSessionManager.getCurrentSessionId.mockReturnValue('s1');
    mockSessionManager.getContextForSession.mockReturnValue({ platform: 'mock' });

    await commandHandler.handleMessage(context);

    expect(mockAdapter.sendReply).toHaveBeenCalledWith(
      context,
      expect.stringContaining('Active Sessions')
    );
    expect(mockAdapter.sendReply).toHaveBeenCalledWith(
      context,
      expect.stringContaining('0. `s1` (mock) ✅')
    );
  });

  it('should handle /session new command', async () => {
    const context: MessageContext = { platform: 'mock', channelId: 'c1', userId: 'u1', text: '/session new' };
    mockSessionManager.createNewSessionForContext.mockResolvedValue('new-session-id');

    await commandHandler.handleMessage(context);

    expect(mockSessionManager.createNewSessionForContext).toHaveBeenCalledWith(context);
    expect(mockAdapter.sendReply).toHaveBeenCalledWith(
      context,
      expect.stringContaining('New session started')
    );
  });

  it('should handle session new command (without slash)', async () => {
    const context: MessageContext = { platform: 'mock', channelId: 'c1', userId: 'u1', text: 'session new' };
    mockSessionManager.createNewSessionForContext.mockResolvedValue('new-session-id');

    await commandHandler.handleMessage(context);

    expect(mockSessionManager.createNewSessionForContext).toHaveBeenCalledWith(context);
    expect(mockAdapter.sendReply).toHaveBeenCalledWith(
      context,
      expect.stringContaining('New session started')
    );
  });
});

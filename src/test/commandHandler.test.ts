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
      getUsage: vi.fn(),
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

    expect(mockSessionManager.createNewSessionForContext).toHaveBeenCalledWith(context, undefined);
    expect(mockAdapter.sendReply).toHaveBeenCalledWith(
      context,
      expect.stringContaining('New session started')
    );
  });

  it('should handle session new command (without slash)', async () => {
    const context: MessageContext = { platform: 'mock', channelId: 'c1', userId: 'u1', text: 'session new' };
    mockSessionManager.createNewSessionForContext.mockResolvedValue('new-session-id');

    await commandHandler.handleMessage(context);

    expect(mockSessionManager.createNewSessionForContext).toHaveBeenCalledWith(context, undefined);
    expect(mockAdapter.sendReply).toHaveBeenCalledWith(
      context,
      expect.stringContaining('New session started')
    );
  });

  it('should handle /session new with path command', async () => {
    const context: MessageContext = { platform: 'mock', channelId: 'c1', userId: 'u1', text: '/session new /tmp/project' };
    mockSessionManager.createNewSessionForContext.mockResolvedValue('new-session-id');

    await commandHandler.handleMessage(context);

    expect(mockSessionManager.createNewSessionForContext).toHaveBeenCalledWith(context, '/tmp/project');
    expect(mockAdapter.sendReply).toHaveBeenCalledWith(
      context,
      expect.stringContaining('New session started')
    );
  });

  it('should handle /session status command with usage data', async () => {
    const context: MessageContext = { platform: 'mock', channelId: 'c1', userId: 'u1', text: '/session status' };
    mockSessionManager.getCurrentSessionId.mockReturnValue('s1');
    mockSessionManager.getUsage.mockReturnValue({ used: 5000, size: 1000000 });

    await commandHandler.handleMessage(context);

    expect(mockAdapter.sendReply).toHaveBeenCalledTimes(1);
    const call = mockAdapter.sendReply.mock.calls[0];
    expect(call[0]).toEqual(context);
    expect(call[1]).toContain('Session Status:* `s1`');
    expect(call[1]).toContain('Tokens Used: `5,000`');
    expect(call[1]).toContain('Context Size: `1,000,000`');
    expect(call[1]).toContain('Usage Rate: `0.50%`');
  });

  it('should handle /session status command without usage data', async () => {
    const context: MessageContext = { platform: 'mock', channelId: 'c1', userId: 'u1', text: '/session status' };
    mockSessionManager.getCurrentSessionId.mockReturnValue('s1');
    mockSessionManager.getUsage.mockReturnValue(undefined);

    await commandHandler.handleMessage(context);

    expect(mockAdapter.sendReply).toHaveBeenCalledWith(
      context,
      expect.stringContaining('No usage data available yet')
    );
  });

  it('should include token usage in the response', async () => {
    const context: MessageContext = { platform: 'mock', channelId: 'c1', userId: 'u1', text: 'hello' };
    mockSessionManager.getSessionForContext.mockResolvedValue('s1');
    mockClient.prompt.mockResolvedValue({
      text: 'Hi there!',
      stop_reason: 'end_turn',
      usage: {
        total_tokens: 150,
        prompt_tokens: 100,
        completion_tokens: 50
      }
    });

    await commandHandler.handleMessage(context);

    expect(mockAdapter.sendReply).toHaveBeenCalledWith(
      context,
      expect.stringContaining('Hi there!')
    );
    expect(mockAdapter.sendReply).toHaveBeenCalledWith(
      context,
      expect.stringContaining('150/ 100/ 50 usage')
    );
  });
});

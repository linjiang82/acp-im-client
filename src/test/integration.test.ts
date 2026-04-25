import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AcpClient } from '../agent/acpClient.js';
import { SessionManager } from '../core/sessionManager.js';
import { CommandHandler } from '../core/commandHandler.js';
import { EventEmitter } from 'events';

describe('Integration: Session Turn', () => {
  let mockAgent: any;
  let client: AcpClient;
  let sessionManager: SessionManager;

  beforeEach(() => {
    mockAgent = new EventEmitter();
    mockAgent.send = vi.fn((msg) => {
      const parsed = JSON.parse(msg);
      if (parsed.method === 'session/new') {
        setTimeout(() => {
          mockAgent.emit('stdout', Buffer.from(JSON.stringify({
            jsonrpc: '2.0',
            id: parsed.id,
            result: { sessionId: 'test-session-id' }
          }) + '\n'));
        }, 10);
      } else if (parsed.method === 'session/prompt') {
        // Simulate streaming
        setTimeout(() => {
          mockAgent.emit('stdout', Buffer.from(JSON.stringify({
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              sessionId: 'test-session-id',
              update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Thinking...' } }
            }
          }) + '\n'));
        }, 20);

        setTimeout(() => {
          mockAgent.emit('stdout', Buffer.from(JSON.stringify({
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              sessionId: 'test-session-id',
              update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello ' } }
            }
          }) + '\n'));
        }, 40);

        setTimeout(() => {
          mockAgent.emit('stdout', Buffer.from(JSON.stringify({
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              sessionId: 'test-session-id',
              update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'world!' } }
            }
          }) + '\n'));
        }, 60);

        setTimeout(() => {
          mockAgent.emit('stdout', Buffer.from(JSON.stringify({
            jsonrpc: '2.0',
            id: parsed.id,
            result: { 
              stop_reason: 'end_turn',
              usage: {
                total_tokens: 150,
                prompt_tokens: 100,
                completion_tokens: 50
              }
            }
          }) + '\n'));
        }, 80);
      }
    });
    client = new AcpClient(mockAgent as any);
    sessionManager = new SessionManager(client);
  });

  it('should collect all chunks and return the full message', async () => {
    const messageBuffers = new Map<string, string>();
    const thoughtBuffers = new Map<string, string>();
    const pendingPermissions = new Map<string, any>();
    const activeTurnContexts = new Map<string, any>();
    
    client.on('notification:session/update', (params) => {
      if (params.update.sessionUpdate === 'agent_message_chunk') {
        const current = messageBuffers.get(params.sessionId) || '';
        messageBuffers.set(params.sessionId, current + (params.update.content?.text || ''));
      }
    });

    const mockAdapter: any = {
      constructor: { name: 'TestAdapter' },
      sendReply: vi.fn()
    };

    const commandHandler = new CommandHandler(
      client,
      sessionManager,
      [mockAdapter],
      messageBuffers,
      thoughtBuffers,
      pendingPermissions,
      activeTurnContexts
    );

    const context = {
      platform: 'test',
      channelId: 'c1',
      userId: 'u1',
      text: 'hi'
    };

    await commandHandler.handleMessage(context);

    expect(mockAdapter.sendReply).toHaveBeenCalledWith(
      context,
      expect.stringContaining('Hello world!')
    );
    expect(mockAdapter.sendReply).toHaveBeenCalledWith(
      context,
      expect.stringContaining('150/ 100/ 50 usage')
    );
  });

  it('should handle usage_update and show status', async () => {
    const messageBuffers = new Map<string, string>();
    const thoughtBuffers = new Map<string, string>();
    const pendingPermissions = new Map<string, any>();
    const activeTurnContexts = new Map<string, any>();

    // Handle the notification manually since we are not using index.ts's listener here
    client.on('notification:session/update', (params) => {
      const { sessionId, update } = params;
      if (update.sessionUpdate === 'usage_update' && update.usage) {
        sessionManager.updateUsage(sessionId, {
          used: update.usage.used,
          size: update.usage.size
        });
      }
    });

    const mockAdapter: any = {
      constructor: { name: 'TestAdapter' },
      sendReply: vi.fn()
    };

    const commandHandler = new CommandHandler(
      client,
      sessionManager,
      [mockAdapter],
      messageBuffers,
      thoughtBuffers,
      pendingPermissions,
      activeTurnContexts
    );

    // 1. Simulate usage update notification
    mockAgent.emit('stdout', Buffer.from(JSON.stringify({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'test-session-id',
        update: { 
          sessionUpdate: 'usage_update', 
          usage: { used: 1234, size: 1000000 } 
        }
      }
    }) + '\n'));

    // 2. We need to make sure the session is registered in the session manager first
    // by sending a regular message first.
    mockAgent.send.mockImplementationOnce((msg) => {
      const parsed = JSON.parse(msg);
      if (parsed.method === 'session/new') {
        mockAgent.emit('stdout', Buffer.from(JSON.stringify({
          jsonrpc: '2.0',
          id: parsed.id,
          result: { sessionId: 'test-session-id' }
        }) + '\n'));
      }
    });
    mockAgent.send.mockImplementationOnce((msg) => {
      const parsed = JSON.parse(msg);
      if (parsed.method === 'session/prompt') {
        mockAgent.emit('stdout', Buffer.from(JSON.stringify({
          jsonrpc: '2.0',
          id: parsed.id,
          result: { stop_reason: 'end_turn' }
        }) + '\n'));
      }
    });

    const initContext = {
      platform: 'test',
      channelId: 'c1',
      userId: 'u1',
      text: 'hello'
    };
    await commandHandler.handleMessage(initContext);

    const statusContext = {
      platform: 'test',
      channelId: 'c1',
      userId: 'u1',
      text: '/session status'
    };

    await commandHandler.handleMessage(statusContext);

    expect(mockAdapter.sendReply).toHaveBeenCalledWith(
      statusContext,
      expect.stringContaining('Session Status:* `test-session-id`')
    );
    expect(mockAdapter.sendReply).toHaveBeenCalledWith(
      statusContext,
      expect.stringContaining('Tokens Used: `1,234`')
    );
    expect(mockAdapter.sendReply).toHaveBeenCalledWith(
      statusContext,
      expect.stringContaining('Usage Rate: `0.12%`')
    );
  });
});

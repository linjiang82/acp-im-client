import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager } from '../core/sessionManager.js';

describe('SessionManager', () => {
  let mockClient: any;
  let manager: SessionManager;

  beforeEach(() => {
    mockClient = {
      newSession: vi.fn().mockResolvedValue({ sessionId: 'session-123' })
    };
    manager = new SessionManager(mockClient as any);
  });

  it('should track sessions in a registry', async () => {
    const context = { platform: 'slack', channelId: 'C1', userId: 'U1', text: 'hi' };
    const id = await manager.getSessionForContext(context);
    
    expect(id).toBe('session-123');
    const sessions = await manager.listAllSessions();
    expect(sessions).toContain('session-123');
    expect(sessions.indexOf('session-123')).toBe(0);
  });

  it('should allow switching between sessions', async () => {
    // Create first session
    mockClient.newSession.mockResolvedValueOnce({ sessionId: 's1' });
    await manager.getSessionForContext({ platform: 'slack', channelId: 'C1', userId: 'U1', text: 'hi' });

    // Create second session via "new" logic
    mockClient.newSession.mockResolvedValueOnce({ sessionId: 's2' });
    await manager.createNewSessionForContext({ platform: 'slack', channelId: 'C1', userId: 'U1', text: 'new' });

    const sessions = await manager.listAllSessions();
    expect(sessions).toEqual(['s1', 's2']);

    // Switch back to s1 (index 0)
    const switched = manager.switchSession({ platform: 'slack', channelId: 'C1', userId: 'U1', text: 'use 0' }, 0);
    expect(switched).toBe('s1');

    // Verify s1 is now returned for this context
    const current = await manager.getSessionForContext({ platform: 'slack', channelId: 'C1', userId: 'U1', text: 'msg' });
    expect(current).toBe('s1');
  });

  it('should return null for invalid switch index', async () => {
    const context = { platform: 'slack', channelId: 'C1', userId: 'U1', text: 'hi' };
    await manager.getSessionForContext(context);
    
    const result = manager.switchSession(context, 99);
    expect(result).toBeNull();
  });

  it('should pass cwd to client.newSession', async () => {
    const context = { platform: 'slack', channelId: 'C1', userId: 'U1', text: 'hi' };
    const customPath = '/custom/path';
    
    await manager.createNewSessionForContext(context, customPath);
    
    expect(mockClient.newSession).toHaveBeenCalledWith(customPath);
  });
});

import { DisconnectReason } from 'livekit-client';
import { disconnectOutcome, disconnectReasonName, isAuthorizationError } from './disconnect-reason';

describe('disconnectOutcome', () => {
  it.each([
    [undefined, 'rejoin'],
    [DisconnectReason.CLIENT_INITIATED, 'rejoin'],
    [DisconnectReason.UNKNOWN_REASON, 'rejoin'],
    [DisconnectReason.JOIN_FAILURE, 'rejoin'],
    [DisconnectReason.STATE_MISMATCH, 'rejoin'],
    [DisconnectReason.SIGNAL_CLOSE, 'rejoin'],
    [DisconnectReason.CONNECTION_TIMEOUT, 'rejoin'],
    [DisconnectReason.MEDIA_FAILURE, 'rejoin'],
    [DisconnectReason.SERVER_SHUTDOWN, 'rejoin'],
    [DisconnectReason.MIGRATION, 'rejoin'],
    [DisconnectReason.ROOM_CLOSED, 'rejoin'],
    [DisconnectReason.USER_REJECTED, 'rejoin'],
    [DisconnectReason.DUPLICATE_IDENTITY, 'replaced'],
    [DisconnectReason.PARTICIPANT_REMOVED, 'removed'],
    [DisconnectReason.ROOM_DELETED, 'removed'],
  ])('%s → %s', (reason, outcome) => {
    expect(disconnectOutcome(reason)).toBe(outcome);
  });

  it('names reasons for logs', () => {
    expect(disconnectReasonName(undefined)).toBe('gave-up');
    expect(disconnectReasonName(DisconnectReason.DUPLICATE_IDENTITY)).toBe('DUPLICATE_IDENTITY');
    expect(disconnectReasonName(999 as DisconnectReason)).toBe('reason-999');
  });
});

describe('isAuthorizationError', () => {
  it.each([
    [{ status: 401 }, true],
    [{ status: 403 }, true],
    [Object.assign(new Error('Forbidden'), { status: 403 }), true],
    [{ status: 500 }, false],
    [{ status: '403' }, false],
    [new Error('Failed to fetch'), false],
    [null, false],
    ['403', false],
  ])('%j → %s', (error, expected) => {
    expect(isAuthorizationError(error)).toBe(expected);
  });
});

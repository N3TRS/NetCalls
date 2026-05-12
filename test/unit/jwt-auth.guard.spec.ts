import { UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from '../../src/auth-integration/guards/jwt-auth.guard';

const makeContext = (authHeader?: string) => {
  const request: any = {
    headers: authHeader ? { authorization: authHeader } : {},
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    request,
  } as any;
};

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  const mockJwtService = { verifyAsync: jest.fn() };

  beforeEach(() => {
    guard = new JwtAuthGuard(mockJwtService as any);
    jest.clearAllMocks();
  });

  it('throws when authorization header is missing', async () => {
    await expect(guard.canActivate(makeContext())).rejects.toThrow(UnauthorizedException);
  });

  it('throws when header does not start with Bearer', async () => {
    await expect(guard.canActivate(makeContext('Basic abc123'))).rejects.toThrow(UnauthorizedException);
  });

  it('throws when token is empty after Bearer', async () => {
    await expect(guard.canActivate(makeContext('Bearer '))).rejects.toThrow(UnauthorizedException);
  });

  it('returns true and sets request.user when token is valid', async () => {
    const user = { id: 'user-1', email: 'test@test.com' };
    mockJwtService.verifyAsync.mockResolvedValue(user);

    const ctx = makeContext('Bearer valid-token');
    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(ctx.request.user).toEqual(user);
    expect(mockJwtService.verifyAsync).toHaveBeenCalledWith('valid-token');
  });

  it('throws UnauthorizedException when token is invalid or expired', async () => {
    mockJwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));
    await expect(guard.canActivate(makeContext('Bearer bad-token'))).rejects.toThrow(UnauthorizedException);
  });
});

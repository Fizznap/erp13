const { OAuth2Client } = require('google-auth-library');
const { verifyGoogleIdToken } = require('../src/services/googleIdentity');

jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: jest.fn(),
  })),
}));

describe('Google ID token validation', () => {
  let client;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GOOGLE_CLIENT_ID = 'snippet-web-client.apps.googleusercontent.com';
    client = { verifyIdToken: jest.fn() };
    OAuth2Client.mockImplementation(() => client);
  });

  test('asks google-auth-library to verify the ID token for the configured audience', async () => {
    client.verifyIdToken.mockResolvedValue({
      getPayload: () => ({
        iss: 'https://accounts.google.com',
        aud: process.env.GOOGLE_CLIENT_ID,
        exp: Math.floor(Date.now() / 1000) + 300,
        email: '  STUDENT@USTU.EDU.IN ',
        email_verified: true,
        hd: 'ustu.edu.in',
        name: 'Student Name',
      }),
    });

    const identity = await verifyGoogleIdToken('google-id-token');

    expect(client.verifyIdToken).toHaveBeenCalledWith({
      idToken: 'google-id-token',
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    expect(identity).toEqual({ email: 'student@ustu.edu.in', fullName: 'Student Name' });
  });

  test.each([
    { email: 'student@gmail.com', email_verified: true, hd: 'ustu.edu.in' },
    { email: 'student@ustu.edu.in.evil', email_verified: true, hd: 'ustu.edu.in' },
    { email: 'student@ustu.edu.in', email_verified: false, hd: 'ustu.edu.in' },
    { email: 'student@ustu.edu.in', email_verified: true, hd: 'gmail.com' },
    { email: 'student@ustu.edu.in', email_verified: true },
  ])('rejects unverified or ineligible Google claims', async (claims) => {
    client.verifyIdToken.mockResolvedValue({ getPayload: () => claims });

    await expect(verifyGoogleIdToken('google-id-token')).rejects.toThrow();
  });

  test('rejects signatures, issuers, audiences, or expirations that Google verification rejects', async () => {
    client.verifyIdToken.mockRejectedValue(new Error('Invalid token signature or claims'));

    await expect(verifyGoogleIdToken('invalid-google-id-token')).rejects.toThrow('Invalid token signature or claims');
  });

  test('fails closed if the server has no Google client ID configured', async () => {
    delete process.env.GOOGLE_CLIENT_ID;

    await expect(verifyGoogleIdToken('google-id-token')).rejects.toThrow('Google sign-in is not configured');
    expect(OAuth2Client).not.toHaveBeenCalled();
  });
});

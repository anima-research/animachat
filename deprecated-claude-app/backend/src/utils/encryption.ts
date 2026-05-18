import crypto from 'crypto';

/**
 * Encryption service for sensitive data (API keys, credentials)
 * Uses AES-256-GCM for authenticated encryption
 */
export class EncryptionService {
  private readonly algorithm: crypto.CipherGCMTypes = 'aes-256-gcm';
  private key: Buffer;
  private legacyKey: Buffer | null;

  constructor(secretKey?: string) {
    // Use dedicated ENCRYPTION_KEY, falling back to JWT_SECRET for backwards compatibility
    const secret = secretKey || process.env.ENCRYPTION_KEY || process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('ENCRYPTION_KEY or JWT_SECRET environment variable is required for API key encryption.');
    }

    // Derive key using scrypt (proper KDF, resistant to brute force)
    const salt = crypto.createHash('sha256').update('arc-encryption-salt:' + secret).digest().subarray(0, 16);
    this.key = crypto.scryptSync(secret, salt, 32, { N: 16384, r: 8, p: 1 });

    // Keep legacy SHA-256 key for decrypting data encrypted before the scrypt migration
    this.legacyKey = crypto.createHash('sha256').update(secret).digest();
  }

  /**
   * Encrypt data and return base64-encoded string with IV and auth tag
   * Format: iv:authTag:encryptedData (all base64)
   */
  encrypt(data: any): string {
    try {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
      const jsonData = JSON.stringify(data);
      let encrypted = cipher.update(jsonData, 'utf8', 'base64');
      encrypted += cipher.final('base64');
      const authTag = cipher.getAuthTag();
      return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
    } catch (error) {
      console.error('Encryption error:', error);
      throw new Error('Failed to encrypt data');
    }
  }

  private decryptWithKey(encryptedString: string, key: Buffer): any {
    const parts = encryptedString.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }
    const [ivBase64, authTagBase64, encryptedData] = parts;
    const iv = Buffer.from(ivBase64, 'base64');
    const authTag = Buffer.from(authTagBase64, 'base64');
    const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedData, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
  }

  /**
   * Decrypt base64-encoded encrypted string.
   * Tries the current scrypt-derived key first, then falls back to the legacy
   * SHA-256 key for data encrypted before the migration.
   */
  decrypt(encryptedString: string): any {
    try {
      return this.decryptWithKey(encryptedString, this.key);
    } catch {
      // Fall back to legacy SHA-256 derived key for pre-migration data
      if (this.legacyKey) {
        try {
          return this.decryptWithKey(encryptedString, this.legacyKey);
        } catch {
          // Neither key works
        }
      }
      throw new Error('Failed to decrypt data');
    }
  }

  /**
   * Test if encryption/decryption works
   */
  test(): boolean {
    try {
      const testData = { test: 'data', nested: { value: 123 } };
      const encrypted = this.encrypt(testData);
      const decrypted = this.decrypt(encrypted);
      return JSON.stringify(testData) === JSON.stringify(decrypted);
    } catch {
      return false;
    }
  }
}

// Export singleton instance
export const encryption = new EncryptionService();

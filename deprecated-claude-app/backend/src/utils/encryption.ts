import crypto from 'crypto';

/**
 * Encryption service for sensitive data (API keys, credentials)
 * Uses AES-256-GCM for authenticated encryption
 */
export class EncryptionService {
  private readonly algorithm: crypto.CipherGCMTypes = 'aes-256-gcm';
  private key: Buffer;

  constructor(secretKey?: string) {
    // Use JWT_SECRET from environment or provided key
    const secret = secretKey || process.env.JWT_SECRET || 'your-secret-key-change-in-production';
    
    // Derive a 32-byte key from the secret using SHA-256
    this.key = crypto.createHash('sha256').update(secret).digest();
  }

  /**
   * Encrypt data and return base64-encoded string with IV and auth tag
   * Format: iv:authTag:encryptedData (all base64)
   */
  encrypt(data: any): string {
    try {
      // Generate random IV (12 bytes for GCM)
      const iv = crypto.randomBytes(12);
      
      // Create cipher
      const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
      
      // Encrypt the data
      const jsonData = JSON.stringify(data);
      let encrypted = cipher.update(jsonData, 'utf8', 'base64');
      encrypted += cipher.final('base64');
      
      // Get auth tag
      const authTag = cipher.getAuthTag();
      
      // Return format: iv:authTag:encryptedData
      return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
    } catch (error) {
      console.error('Encryption error:', error);
      throw new Error('Failed to encrypt data');
    }
  }

  /**
   * Decrypt base64-encoded encrypted string
   */
  decrypt(encryptedString: string): any {
    try {
      // Parse the encrypted string
      const parts = encryptedString.split(':');
      if (parts.length !== 3) {
        throw new Error('Invalid encrypted data format');
      }
      
      const [ivBase64, authTagBase64, encryptedData] = parts;
      
      // Convert from base64
      const iv = Buffer.from(ivBase64, 'base64');
      const authTag = Buffer.from(authTagBase64, 'base64');
      
      // Create decipher
      const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
      decipher.setAuthTag(authTag);
      
      // Decrypt the data
      let decrypted = decipher.update(encryptedData, 'base64', 'utf8');
      decrypted += decipher.final('utf8');
      
      // Parse JSON
      return JSON.parse(decrypted);
    } catch (error) {
      console.error('Decryption error:', error);
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


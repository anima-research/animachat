import { describe, it, expect } from 'vitest';
import { EncryptionService } from './encryption.js';

describe('EncryptionService', () => {
  const service = new EncryptionService('test-secret-key');

  describe('encrypt', () => {
    it('returns a string in iv:authTag:data format', () => {
      const result = service.encrypt('hello');
      const parts = result.split(':');
      expect(parts).toHaveLength(3);
      // All three parts should be valid base64
      for (const part of parts) {
        expect(part.length).toBeGreaterThan(0);
        expect(() => Buffer.from(part, 'base64')).not.toThrow();
      }
    });

    it('produces output that differs from the input', () => {
      const input = 'sensitive-api-key';
      const encrypted = service.encrypt(input);
      expect(encrypted).not.toBe(input);
      expect(encrypted).not.toContain(input);
    });

    it('produces different ciphertexts for the same input (random IV)', () => {
      const input = 'same-data';
      const encrypted1 = service.encrypt(input);
      const encrypted2 = service.encrypt(input);
      expect(encrypted1).not.toBe(encrypted2);
    });

    it('encrypts a string value', () => {
      const encrypted = service.encrypt('hello world');
      expect(typeof encrypted).toBe('string');
      expect(encrypted.split(':')).toHaveLength(3);
    });

    it('encrypts a number value', () => {
      const encrypted = service.encrypt(42);
      expect(typeof encrypted).toBe('string');
      expect(encrypted.split(':')).toHaveLength(3);
    });

    it('encrypts a boolean value', () => {
      const encrypted = service.encrypt(true);
      expect(typeof encrypted).toBe('string');
    });

    it('encrypts null', () => {
      const encrypted = service.encrypt(null);
      expect(typeof encrypted).toBe('string');
    });

    it('encrypts a nested object', () => {
      const obj = { key: 'value', nested: { a: 1, b: [1, 2, 3] } };
      const encrypted = service.encrypt(obj);
      expect(typeof encrypted).toBe('string');
      expect(encrypted.split(':')).toHaveLength(3);
    });

    it('encrypts an array', () => {
      const arr = [1, 'two', { three: 3 }];
      const encrypted = service.encrypt(arr);
      expect(typeof encrypted).toBe('string');
    });

    it('encrypts an empty string', () => {
      const encrypted = service.encrypt('');
      expect(typeof encrypted).toBe('string');
      expect(encrypted.split(':')).toHaveLength(3);
    });

    it('encrypts a very long string', () => {
      const longString = 'x'.repeat(100000);
      const encrypted = service.encrypt(longString);
      expect(typeof encrypted).toBe('string');
      expect(encrypted.split(':')).toHaveLength(3);
    });
  });

  describe('decrypt', () => {
    it('roundtrips a string', () => {
      const input = 'hello world';
      const encrypted = service.encrypt(input);
      const decrypted = service.decrypt(encrypted);
      expect(decrypted).toBe(input);
    });

    it('roundtrips a number', () => {
      const input = 42;
      const encrypted = service.encrypt(input);
      const decrypted = service.decrypt(encrypted);
      expect(decrypted).toBe(42);
    });

    it('roundtrips a boolean', () => {
      const encrypted = service.encrypt(false);
      expect(service.decrypt(encrypted)).toBe(false);
    });

    it('roundtrips null', () => {
      const encrypted = service.encrypt(null);
      expect(service.decrypt(encrypted)).toBeNull();
    });

    it('roundtrips a nested object preserving structure', () => {
      const input = { key: 'value', nested: { a: 1, b: [1, 2, 3] } };
      const encrypted = service.encrypt(input);
      const decrypted = service.decrypt(encrypted);
      expect(decrypted).toEqual(input);
    });

    it('roundtrips an array', () => {
      const input = [1, 'two', { three: 3 }];
      const encrypted = service.encrypt(input);
      const decrypted = service.decrypt(encrypted);
      expect(decrypted).toEqual(input);
    });

    it('roundtrips an empty string', () => {
      const encrypted = service.encrypt('');
      expect(service.decrypt(encrypted)).toBe('');
    });

    it('roundtrips a very long string', () => {
      const longString = 'x'.repeat(100000);
      const encrypted = service.encrypt(longString);
      expect(service.decrypt(encrypted)).toBe(longString);
    });

    it('roundtrips unicode content', () => {
      const input = '日本語テスト 🎉 émojis Ñ';
      const encrypted = service.encrypt(input);
      expect(service.decrypt(encrypted)).toBe(input);
    });

    it('throws on decrypt with wrong key', () => {
      const otherService = new EncryptionService('different-key');
      const encrypted = service.encrypt('secret data');
      expect(() => otherService.decrypt(encrypted)).toThrow('Failed to decrypt data');
    });

    it('throws on malformed input with missing parts', () => {
      expect(() => service.decrypt('onlyonepart')).toThrow('Failed to decrypt data');
    });

    it('throws on malformed input with only two parts', () => {
      expect(() => service.decrypt('part1:part2')).toThrow('Failed to decrypt data');
    });

    it('throws on malformed input with four parts', () => {
      expect(() => service.decrypt('a:b:c:d')).toThrow('Failed to decrypt data');
    });

    it('throws on tampered ciphertext', () => {
      const encrypted = service.encrypt('important data');
      const parts = encrypted.split(':');
      // Tamper with the encrypted data portion
      const tamperedData = Buffer.from('tampered-content').toString('base64');
      const tampered = `${parts[0]}:${parts[1]}:${tamperedData}`;
      expect(() => service.decrypt(tampered)).toThrow('Failed to decrypt data');
    });

    it('throws on tampered auth tag', () => {
      const encrypted = service.encrypt('important data');
      const parts = encrypted.split(':');
      // Tamper with the auth tag
      const tamperedTag = Buffer.from('0000000000000000').toString('base64');
      const tampered = `${parts[0]}:${tamperedTag}:${parts[2]}`;
      expect(() => service.decrypt(tampered)).toThrow('Failed to decrypt data');
    });

    it('throws on tampered IV', () => {
      const encrypted = service.encrypt('important data');
      const parts = encrypted.split(':');
      // Tamper with IV
      const tamperedIV = Buffer.from('000000000000').toString('base64');
      const tampered = `${tamperedIV}:${parts[1]}:${parts[2]}`;
      expect(() => service.decrypt(tampered)).toThrow('Failed to decrypt data');
    });

    it('throws on empty string', () => {
      expect(() => service.decrypt('')).toThrow('Failed to decrypt data');
    });
  });

  describe('test', () => {
    it('returns true when encryption roundtrip works', () => {
      expect(service.test()).toBe(true);
    });

    it('verifies the test method checks nested objects', () => {
      // The test method internally uses { test: 'data', nested: { value: 123 } }
      // A new instance with a valid key should pass
      const freshService = new EncryptionService('another-valid-key');
      expect(freshService.test()).toBe(true);
    });
  });

  describe('constructor', () => {
    it('derives a consistent key from the same secret', () => {
      const service1 = new EncryptionService('same-secret');
      const service2 = new EncryptionService('same-secret');
      // Encrypt with one, decrypt with the other
      const encrypted = service1.encrypt('cross-instance test');
      const decrypted = service2.decrypt(encrypted);
      expect(decrypted).toBe('cross-instance test');
    });

    it('derives different keys from different secrets', () => {
      const serviceA = new EncryptionService('secret-a');
      const serviceB = new EncryptionService('secret-b');
      const encrypted = serviceA.encrypt('data');
      expect(() => serviceB.decrypt(encrypted)).toThrow('Failed to decrypt data');
    });

    it('uses a default key when no secret is provided and JWT_SECRET is unset', () => {
      const originalJwtSecret = process.env.JWT_SECRET;
      delete process.env.JWT_SECRET;
      try {
        const defaultService = new EncryptionService();
        // Should still work with the default fallback key
        expect(defaultService.test()).toBe(true);
      } finally {
        if (originalJwtSecret !== undefined) {
          process.env.JWT_SECRET = originalJwtSecret;
        }
      }
    });

    it('uses JWT_SECRET from environment when no key is provided', () => {
      const originalJwtSecret = process.env.JWT_SECRET;
      process.env.JWT_SECRET = 'env-secret-key';
      try {
        const envService = new EncryptionService();
        const encrypted = envService.encrypt('env test');

        // A service with the same key should decrypt it
        const matchingService = new EncryptionService('env-secret-key');
        expect(matchingService.decrypt(encrypted)).toBe('env test');
      } finally {
        if (originalJwtSecret !== undefined) {
          process.env.JWT_SECRET = originalJwtSecret;
        } else {
          delete process.env.JWT_SECRET;
        }
      }
    });
  });
});

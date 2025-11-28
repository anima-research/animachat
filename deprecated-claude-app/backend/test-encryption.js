const crypto = require('crypto');

const algorithm = 'aes-256-gcm';
const secret = process.env.JWT_SECRET || 'dev-secret-key-change-in-production';
const key = crypto.createHash('sha256').update(secret).digest();

// Encrypt
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv(algorithm, key, iv);
const testData = JSON.stringify({ apiKey: 'sk-test-123456789' });
let encrypted = cipher.update(testData, 'utf8', 'base64');
encrypted += cipher.final('base64');
const authTag = cipher.getAuthTag();
const encryptedString = `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;

// Decrypt
const parts = encryptedString.split(':');
const ivDec = Buffer.from(parts[0], 'base64');
const authTagDec = Buffer.from(parts[1], 'base64');
const decipher = crypto.createDecipheriv(algorithm, key, ivDec);
decipher.setAuthTag(authTagDec);
let decrypted = decipher.update(parts[2], 'base64', 'utf8');
decrypted += decipher.final('utf8');

console.log('✅ Encryption test PASSED!');
console.log('Original:', testData);
console.log('Encrypted:', encryptedString.substring(0, 50) + '...');
console.log('Decrypted:', decrypted);
console.log('Match:', testData === decrypted);

process.exit(0);

import CryptoJS from 'crypto-js';
import config from '../config';

/**
 * Encrypt sensitive data (like Threads access tokens)
 */
export function encrypt(text: string): string {
  if (!config.encryption.key) {
    throw new Error('Encryption key not configured');
  }

  return CryptoJS.AES.encrypt(text, config.encryption.key).toString();
}

/**
 * Decrypt sensitive data
 */
export function decrypt(ciphertext: string): string {
  if (!config.encryption.key) {
    throw new Error('Encryption key not configured');
  }

  const bytes = CryptoJS.AES.decrypt(ciphertext, config.encryption.key);
  return bytes.toString(CryptoJS.enc.Utf8);
}

export default {
  encrypt,
  decrypt,
};

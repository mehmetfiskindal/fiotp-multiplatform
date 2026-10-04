package com.fiskindal.fiotp;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/** Vault envelope primitives shared with the Apple, Linux, and Windows hosts. */
final class FiOtpCrypto {
  static final int MIN_ITERATIONS = 100_000;
  static final int MAX_ITERATIONS = 5_000_000;
  static final int DEFAULT_ITERATIONS = 600_000;
  static final int SALT_BYTES = 16;
  static final int KEY_BYTES = 32;
  static final int NONCE_BYTES = 12;
  static final int TAG_BYTES = 16;
  static final int MAX_FILE_BYTES = 32 * 1024 * 1024;

  private static final SecureRandom RANDOM = new SecureRandom();
  private static final char[] BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".toCharArray();

  private FiOtpCrypto() {}

  static void checkIterations(int iterations) {
    if (iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
      throw new IllegalArgumentException("Kasa KDF bilgileri geçersiz.");
    }
  }

  static byte[] random(int length) {
    byte[] bytes = new byte[length];
    if (length > 0) RANDOM.nextBytes(bytes);
    return bytes;
  }

  static byte[] derive(String password, byte[] salt, int iterations) {
    checkIterations(iterations);
    if (salt == null || salt.length != SALT_BYTES) throw new IllegalArgumentException("Kasa KDF bilgileri geçersiz.");
    byte[] passwordBytes = password.getBytes(StandardCharsets.UTF_8);
    byte[] firstBlock = new byte[salt.length + 4];
    System.arraycopy(salt, 0, firstBlock, 0, salt.length);
    firstBlock[firstBlock.length - 1] = 1;
    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(passwordBytes, "HmacSHA256"));
      byte[] u = mac.doFinal(firstBlock);
      byte[] result = u.clone();
      try {
        for (int round = 1; round < iterations; round++) {
          byte[] next = mac.doFinal(u);
          for (int i = 0; i < result.length; i++) result[i] = (byte) (result[i] ^ next[i]);
          wipe(u);
          u = next;
        }
        return result.clone();
      } finally {
        wipe(u);
        wipe(result);
      }
    } catch (GeneralSecurityException error) {
      throw new IllegalArgumentException("Parola anahtarı türetilemedi.");
    } finally {
      wipe(passwordBytes);
      wipe(firstBlock);
    }
  }

  static byte[] encrypt(byte[] plaintext, byte[] key, byte[] nonce) {
    if (key == null || key.length != KEY_BYTES || nonce == null || nonce.length != NONCE_BYTES) {
      throw new IllegalArgumentException("Kasa şifreleme alanları bozuk.");
    }
    try {
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, nonce));
      return cipher.doFinal(plaintext == null ? new byte[0] : plaintext);
    } catch (GeneralSecurityException error) {
      throw new IllegalArgumentException("Kasa şifrelenemedi.");
    }
  }

  static byte[] decrypt(byte[] ciphertext, byte[] tag, byte[] key, byte[] nonce) {
    if (key == null || key.length != KEY_BYTES || nonce == null || nonce.length != NONCE_BYTES || tag == null || tag.length != TAG_BYTES) {
      throw new IllegalArgumentException("Kasa şifreleme alanları bozuk.");
    }
    byte[] sealed = new byte[(ciphertext == null ? 0 : ciphertext.length) + tag.length];
    if (ciphertext != null && ciphertext.length > 0) System.arraycopy(ciphertext, 0, sealed, 0, ciphertext.length);
    System.arraycopy(tag, 0, sealed, sealed.length - tag.length, tag.length);
    try {
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, nonce));
      return cipher.doFinal(sealed);
    } catch (GeneralSecurityException error) {
      throw new IllegalArgumentException("Parola hatalı veya kasa bozulmuş/kurcalanmış.");
    } finally {
      wipe(sealed);
    }
  }

  static byte[] hmac(String algorithm, byte[] key, byte[] message) {
    String macName = "HmacSHA1";
    if ("SHA256".equals(algorithm)) macName = "HmacSHA256";
    else if ("SHA512".equals(algorithm)) macName = "HmacSHA512";
    try {
      Mac mac = Mac.getInstance(macName);
      mac.init(new SecretKeySpec(key == null ? new byte[0] : key, macName));
      return mac.doFinal(message == null ? new byte[0] : message);
    } catch (GeneralSecurityException error) {
      throw new IllegalArgumentException("HMAC üretilemedi.");
    }
  }

  static String base64(byte[] bytes) {
    if (bytes == null || bytes.length == 0) return "";
    StringBuilder out = new StringBuilder(((bytes.length + 2) / 3) * 4);
    int i = 0;
    while (i < bytes.length) {
      int a = bytes[i++] & 255;
      boolean hasB = i < bytes.length;
      int b = hasB ? bytes[i++] & 255 : 0;
      boolean hasC = i < bytes.length;
      int c = hasC ? bytes[i++] & 255 : 0;
      out.append(BASE64[a >>> 2]);
      out.append(BASE64[((a & 3) << 4) | (b >>> 4)]);
      out.append(hasB ? BASE64[((b & 15) << 2) | (c >>> 6)] : '=');
      out.append(hasC ? BASE64[c & 63] : '=');
    }
    return out.toString();
  }

  static byte[] base64Decode(String value) {
    if (value == null || value.length() == 0) return new byte[0];
    StringBuilder clean = new StringBuilder(value.length());
    for (int i = 0; i < value.length(); i++) {
      char ch = value.charAt(i);
      if (ch == ' ' || ch == '\n' || ch == '\r' || ch == '\t') continue;
      clean.append(ch);
    }
    int padding = 0;
    int end = clean.length();
    while (end > 0 && clean.charAt(end - 1) == '=') {
      padding++;
      end--;
    }
    if (padding > 2 || end % 4 == 1) throw new IllegalArgumentException("Kasa Base64 alanı bozuk.");
    int outLength = (end * 6) / 8;
    byte[] out = new byte[outLength];
    int buffer = 0;
    int bits = 0;
    int offset = 0;
    for (int i = 0; i < end; i++) {
      int symbol = base64Index(clean.charAt(i));
      if (symbol < 0) throw new IllegalArgumentException("Kasa Base64 alanı bozuk.");
      buffer = (buffer << 6) | symbol;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out[offset++] = (byte) (buffer >>> bits);
      }
    }
    return out;
  }

  static void wipe(byte[] bytes) {
    if (bytes == null) return;
    for (int i = 0; i < bytes.length; i++) bytes[i] = 0;
  }

  private static int base64Index(char ch) {
    if (ch >= 'A' && ch <= 'Z') return ch - 'A';
    if (ch >= 'a' && ch <= 'z') return ch - 'a' + 26;
    if (ch >= '0' && ch <= '9') return ch - '0' + 52;
    if (ch == '+') return 62;
    if (ch == '/') return 63;
    return -1;
  }
}

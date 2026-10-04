package com.fiskindal.fiotp;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

/** Filesystem vault used by the Android host and the desktop envelope tests. */
final class FiOtpVaultFiles {
  private static byte[] key = new byte[0];
  private static String vaultPath = "";

  private FiOtpVaultFiles() {}

  static String invoke(String method, String payload, String defaultPath) {
    try {
      return dispatch(method, payload, defaultPath);
    } catch (IllegalStateException error) {
      return FiOtpJson.fail(error.getMessage(), "locked");
    } catch (RuntimeException error) {
      String message = error.getMessage() == null ? "Android işlemi başarısız oldu." : error.getMessage();
      return FiOtpJson.fail(message, codeFor(method, message));
    }
  }

  private static String dispatch(String method, String payload, String defaultPath) {
    Map<String, Object> args = payload == null || payload.length() == 0
      ? FiOtpJson.object("{}")
      : FiOtpJson.object(payload);
    if ("vault.defaultPath".equals(method)) return FiOtpJson.ok(FiOtpJson.pathData(defaultPath));
    if ("vault.status".equals(method)) {
      String path = expand(FiOtpJson.string(args, "path"), defaultPath);
      return FiOtpJson.ok("{\"exists\":" + new File(path).isFile() + ",\"path\":" + FiOtpJson.quote(path) + "}");
    }
    if ("vault.discover".equals(method)) {
      String preferred = expand(FiOtpJson.string(args, "preferredPath"), defaultPath);
      String path = new File(preferred).isFile() ? preferred : defaultPath;
      return FiOtpJson.ok("{\"exists\":" + new File(path).isFile() + ",\"path\":" + FiOtpJson.quote(path) + "}");
    }
    if ("vault.create".equals(method)) {
      String password = FiOtpJson.string(args, "password");
      if (password.length() < 8) throw new IllegalArgumentException("Master parola en az 8 karakter olmalıdır.");
      String path = expand(FiOtpJson.string(args, "path"), defaultPath);
      if (new File(path).exists()) {
        throw new IllegalArgumentException("Bu konumda zaten bir kasa var. Mevcut kasayı açın veya başka bir konum seçin.");
      }
      byte[] salt = FiOtpCrypto.random(FiOtpCrypto.SALT_BYTES);
      byte[] derived = FiOtpCrypto.derive(password, salt, FiOtpCrypto.DEFAULT_ITERATIONS);
      try {
        byte[] envelope = seal(FiOtpJson.string(args, "plaintext"), derived, salt, FiOtpCrypto.DEFAULT_ITERATIONS);
        writeAtomic(new File(path), envelope, true);
        replaceKey(derived, path);
        derived = null;
        return FiOtpJson.ok(FiOtpJson.pathData(path));
      } finally {
        FiOtpCrypto.wipe(salt);
        if (derived != null) FiOtpCrypto.wipe(derived);
      }
    }
    if ("vault.open".equals(method) || "vault.readExternal".equals(method)) {
      String path = expand(FiOtpJson.string(args, "path"), defaultPath);
      boolean keep = "vault.open".equals(method);
      try {
        return FiOtpJson.ok(openAt(path, FiOtpJson.string(args, "password"), keep, false));
      } catch (RuntimeException original) {
        if (!keep) throw original;
        try {
          String recovered = openAt(path + ".bak", FiOtpJson.string(args, "password"), true, true);
          vaultPath = path;
          return FiOtpJson.ok(recovered);
        } catch (RuntimeException ignored) {
          throw original;
        }
      }
    }
    if ("vault.save".equals(method)) {
      if (key.length == 0) throw new IllegalStateException("Kasa kilitli.");
      String path = expand(FiOtpJson.string(args, "path"), vaultPath.length() == 0 ? defaultPath : vaultPath);
      savePlaintext(path, FiOtpJson.string(args, "plaintext"), key);
      return FiOtpJson.ok("{}");
    }
    if ("vault.lock".equals(method)) {
      clearKey();
      return FiOtpJson.ok("{}");
    }
    if ("vault.changePassword".equals(method)) {
      String path = expand(FiOtpJson.string(args, "path"), vaultPath.length() == 0 ? defaultPath : vaultPath);
      openAt(path, FiOtpJson.string(args, "currentPassword"), false, false);
      String next = FiOtpJson.string(args, "newPassword");
      if (next.length() < 8) throw new IllegalArgumentException("Yeni parola en az 8 karakter olmalıdır.");
      byte[] salt = FiOtpCrypto.random(FiOtpCrypto.SALT_BYTES);
      byte[] derived = FiOtpCrypto.derive(next, salt, FiOtpCrypto.DEFAULT_ITERATIONS);
      try {
        byte[] envelope = seal(FiOtpJson.string(args, "plaintext"), derived, salt, FiOtpCrypto.DEFAULT_ITERATIONS);
        writeAtomic(new File(path), envelope, true);
        replaceKey(derived, path);
        derived = null;
        return FiOtpJson.ok("{}");
      } finally {
        FiOtpCrypto.wipe(salt);
        if (derived != null) FiOtpCrypto.wipe(derived);
      }
    }
    if ("vault.export".equals(method)) {
      File source = new File(expand(FiOtpJson.string(args, "source"), defaultPath));
      File destination = new File(expand(FiOtpJson.string(args, "destination"), defaultPath));
      byte[] bytes = readLimited(source);
      writeAtomic(destination, bytes, false);
      return FiOtpJson.ok(FiOtpJson.pathData(destination.getAbsolutePath()));
    }
    throw new IllegalArgumentException("Bilinmeyen Android işlemi: " + method);
  }

  private static String codeFor(String method, String message) {
    if (message.indexOf("en az 8") >= 0) return "weak_password";
    if (message.indexOf("zaten bir kasa") >= 0) return "vault_exists";
    if (message.indexOf("kilitli") >= 0) return "locked";
    if ("vault.open".equals(method) || "vault.readExternal".equals(method)) return "open_failed";
    if (message.indexOf("Geçersiz istek") >= 0) return "invalid_request";
    return "native_error";
  }

  static String openBytes(byte[] envelope, String password, boolean keep, String path, boolean recovered) {
    Opened opened = unlock(envelope, password);
    try {
      if (keep) replaceKey(opened.key, path);
      else FiOtpCrypto.wipe(opened.key);
      opened.key = null;
      String plaintext = new String(opened.plaintext, StandardCharsets.UTF_8);
      FiOtpCrypto.wipe(opened.plaintext);
      opened.plaintext = null;
      int count = accountCount(plaintext);
      return "{\"path\":" + FiOtpJson.quote(path)
        + ",\"plaintext\":" + FiOtpJson.quote(plaintext)
        + ",\"accountCount\":" + count
        + (recovered ? ",\"recoveredFromBackup\":true" : "")
        + "}";
    } finally {
      if (opened.key != null) FiOtpCrypto.wipe(opened.key);
      if (opened.plaintext != null) FiOtpCrypto.wipe(opened.plaintext);
    }
  }

  static byte[] sealPlaintext(String plaintext, byte[] vaultKey, byte[] existingEnvelope) {
    Map<String, Object> old = FiOtpJson.object(new String(existingEnvelope, StandardCharsets.UTF_8));
    byte[] salt = requiredField(old, "salt", FiOtpCrypto.SALT_BYTES);
    int iterations = iterationsOf(old);
    try {
      return seal(plaintext, vaultKey, salt, iterations);
    } finally {
      FiOtpCrypto.wipe(salt);
    }
  }

  static byte[] currentKey() {
    return key.clone();
  }

  static void clearKeyForTest() {
    clearKey();
  }

  private static String openAt(String path, String password, boolean keep, boolean recovered) {
    return openBytes(readLimited(new File(path)), password, keep, path, recovered);
  }

  private static void savePlaintext(String path, String plaintext, byte[] vaultKey) {
    byte[] updated = sealPlaintext(plaintext, vaultKey, readLimited(new File(path)));
    writeAtomic(new File(path), updated, true);
  }

  private static final class Opened {
    byte[] key;
    byte[] plaintext;
  }

  private static Opened unlock(byte[] envelopeBytes, String password) {
    if (envelopeBytes.length > FiOtpCrypto.MAX_FILE_BYTES) {
      throw new IllegalArgumentException("Kasa dosyası geçersiz boyutta.");
    }
    Map<String, Object> envelope;
    try {
      envelope = FiOtpJson.object(new String(envelopeBytes, StandardCharsets.UTF_8));
    } catch (IllegalArgumentException error) {
      throw new IllegalArgumentException("Kasa dosyası geçerli JSON değil.");
    }
    if (!Long.valueOf(1).equals(envelope.get("version")) || !"AES-256-GCM".equals(envelope.get("cipher"))
        || !"PBKDF2-HMAC-SHA256".equals(envelope.get("kdf"))) {
      throw new IllegalArgumentException("Desteklenmeyen veya geçersiz kasa formatı.");
    }
    byte[] salt = requiredField(envelope, "salt", FiOtpCrypto.SALT_BYTES);
    int iterations = iterationsOf(envelope);
    byte[] derived = FiOtpCrypto.derive(password, salt, iterations);
    FiOtpCrypto.wipe(salt);
    byte[] nonce = requiredField(envelope, "nonce", FiOtpCrypto.NONCE_BYTES);
    byte[] ciphertext = requiredField(envelope, "ciphertext", -1);
    byte[] tag = requiredField(envelope, "tag", FiOtpCrypto.TAG_BYTES);
    try {
      Opened opened = new Opened();
      opened.key = derived;
      opened.plaintext = FiOtpCrypto.decrypt(ciphertext, tag, derived, nonce);
      accountCount(new String(opened.plaintext, StandardCharsets.UTF_8));
      return opened;
    } catch (RuntimeException error) {
      FiOtpCrypto.wipe(derived);
      throw error;
    } finally {
      FiOtpCrypto.wipe(nonce);
      FiOtpCrypto.wipe(ciphertext);
      FiOtpCrypto.wipe(tag);
    }
  }

  private static int iterationsOf(Map<String, Object> envelope) {
    Object raw = envelope.get("iterations");
    if (!(raw instanceof Long)) throw new IllegalArgumentException("Kasa KDF bilgileri geçersiz.");
    long iterations = ((Long) raw).longValue();
    if (iterations < FiOtpCrypto.MIN_ITERATIONS || iterations > FiOtpCrypto.MAX_ITERATIONS) {
      throw new IllegalArgumentException("Kasa KDF bilgileri geçersiz.");
    }
    return (int) iterations;
  }

  private static byte[] requiredField(Map<String, Object> envelope, String field, int expected) {
    Object raw = envelope.get(field);
    if (!(raw instanceof String) || ((String) raw).length() == 0) {
      throw new IllegalArgumentException("Kasa şifreleme alanları bozuk.");
    }
    byte[] bytes = FiOtpCrypto.base64Decode((String) raw);
    if (expected >= 0 && bytes.length != expected) throw new IllegalArgumentException("Kasa şifreleme alanları bozuk.");
    return bytes;
  }

  private static byte[] seal(String plaintext, byte[] vaultKey, byte[] salt, int iterations) {
    byte[] nonce = FiOtpCrypto.random(FiOtpCrypto.NONCE_BYTES);
    byte[] sealed = FiOtpCrypto.encrypt(plaintext.getBytes(StandardCharsets.UTF_8), vaultKey, nonce);
    byte[] ciphertext = Arrays.copyOf(sealed, sealed.length - FiOtpCrypto.TAG_BYTES);
    byte[] tag = Arrays.copyOfRange(sealed, sealed.length - FiOtpCrypto.TAG_BYTES, sealed.length);
    try {
      String json = "{\"version\":1,\"cipher\":\"AES-256-GCM\",\"kdf\":\"PBKDF2-HMAC-SHA256\",\"iterations\":"
        + iterations
        + ",\"salt\":" + FiOtpJson.quote(FiOtpCrypto.base64(salt))
        + ",\"nonce\":" + FiOtpJson.quote(FiOtpCrypto.base64(nonce))
        + ",\"ciphertext\":" + FiOtpJson.quote(FiOtpCrypto.base64(ciphertext))
        + ",\"tag\":" + FiOtpJson.quote(FiOtpCrypto.base64(tag))
        + "}";
      return json.getBytes(StandardCharsets.UTF_8);
    } finally {
      FiOtpCrypto.wipe(nonce);
      FiOtpCrypto.wipe(sealed);
      FiOtpCrypto.wipe(ciphertext);
      FiOtpCrypto.wipe(tag);
    }
  }

  @SuppressWarnings("unchecked")
  private static int accountCount(String plaintext) {
    Map<String, Object> payload;
    try {
      payload = FiOtpJson.object(plaintext);
    } catch (IllegalArgumentException error) {
      throw new IllegalArgumentException("Kasa içeriği geçerli JSON değil.");
    }
    Object accounts = payload.get("accounts");
    if (!(accounts instanceof List)) throw new IllegalArgumentException("Kasa hesap listesi içermiyor.");
    return ((List<Object>) accounts).size();
  }

  private static String expand(String path, String fallback) {
    if (path == null || path.length() == 0) return fallback;
    return path;
  }

  private static byte[] readLimited(File file) {
    if (!file.isFile()) throw new IllegalArgumentException("Kasa dosyası açılamadı: " + file.getPath());
    if (file.length() > FiOtpCrypto.MAX_FILE_BYTES) throw new IllegalArgumentException("Kasa dosyası geçersiz boyutta.");
    byte[] bytes = new byte[(int) file.length()];
    try (FileInputStream input = new FileInputStream(file)) {
      int offset = 0;
      while (offset < bytes.length) {
        int read = input.read(bytes, offset, bytes.length - offset);
        if (read < 0) break;
        offset += read;
      }
      if (offset != bytes.length) throw new IllegalArgumentException("Kasa dosyası açılamadı: " + file.getPath());
      return bytes;
    } catch (IOException error) {
      throw new IllegalArgumentException("Kasa dosyası açılamadı: " + file.getPath());
    }
  }

  static void writeAtomic(File destination, byte[] contents, boolean backup) {
    File parent = destination.getParentFile();
    if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
      throw new IllegalArgumentException("Kasa klasörü oluşturulamadı.");
    }
    File temp;
    try {
      temp = File.createTempFile(destination.getName(), ".tmp", parent);
    } catch (IOException error) {
      throw new IllegalArgumentException("Geçici kasa dosyası oluşturulamadı.");
    }
    try (FileOutputStream output = new FileOutputStream(temp)) {
      output.write(contents);
      output.getFD().sync();
    } catch (IOException error) {
      temp.delete();
      throw new IllegalArgumentException("Kasa dosyası yazılamadı.");
    }
    restrict(temp);
    if (backup && destination.isFile()) {
      File bak = new File(destination.getPath() + ".bak");
      try {
        writeAtomic(bak, readLimited(destination), false);
      } catch (RuntimeException error) {
        temp.delete();
        throw new IllegalArgumentException("Önceki kasa yedeği yazılamadı: " + error.getMessage());
      }
    }
    if (!temp.renameTo(destination)) {
      temp.delete();
      throw new IllegalArgumentException("Kasa dosyası atomik olarak kaydedilemedi.");
    }
    restrict(destination);
  }

  private static void restrict(File file) {
    file.setReadable(false, false);
    file.setWritable(false, false);
    file.setExecutable(false, false);
    file.setReadable(true, true);
    file.setWritable(true, true);
  }

  private static void replaceKey(byte[] next, String path) {
    clearKey();
    key = next;
    vaultPath = path;
  }

  private static void clearKey() {
    FiOtpCrypto.wipe(key);
    key = new byte[0];
    vaultPath = "";
  }
}

package com.fiskindal.fiotp;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.Map;

/** Desktop checks for the vault envelope previously covered by the Kotlin unit tests. */
public final class FiOtpVaultTest {
  public static void main(String[] args) throws Exception {
    appleEnvelopeFixture();
    tamperAndWrongPasswordRejected();
    iterationBounds();
    malformedVaultRecoversBak();
    wrongPasswordMessage();
    savePreservesKdf();
    unsupportedIterationsRejected();
    System.out.println("Android vault envelope tests passed");
  }

  private static void appleEnvelopeFixture() {
    byte[] salt = rising(16);
    byte[] nonce = rising(12);
    byte[] plaintext = "{\"schema\":1,\"accounts\":[]}".getBytes(StandardCharsets.UTF_8);
    byte[] key = FiOtpCrypto.derive("correct horse battery", salt, 600_000);
    assertEquals("bb06c8c0b1dd5bfd4e40f4e297a2d0e64da7ef94b4b8ec20989021c8b41536ad", hex(key));
    byte[] sealed = FiOtpCrypto.encrypt(plaintext, key, nonce);
    byte[] ciphertext = Arrays.copyOf(sealed, sealed.length - 16);
    byte[] tag = Arrays.copyOfRange(sealed, sealed.length - 16, sealed.length);
    assertEquals("Uey4LovVhkH0r/3jb1jll1U5bm4XUj55o7s=", FiOtpCrypto.base64(ciphertext));
    assertEquals("S4SdjH1EZaEukuykAE1InQ==", FiOtpCrypto.base64(tag));
    assertTrue(Arrays.equals(plaintext, FiOtpCrypto.decrypt(ciphertext, tag, key, nonce)));
    FiOtpCrypto.wipe(key);
    FiOtpCrypto.wipe(sealed);
  }

  private static void tamperAndWrongPasswordRejected() {
    byte[] salt = rising(16);
    byte[] nonce = rising(12);
    byte[] plaintext = "{\"schema\":1,\"accounts\":[]}".getBytes(StandardCharsets.UTF_8);
    byte[] key = FiOtpCrypto.derive("correct horse battery", salt, 600_000);
    byte[] sealed = FiOtpCrypto.encrypt(plaintext, key, nonce);
    byte[] ciphertext = Arrays.copyOf(sealed, sealed.length - 16);
    byte[] tag = Arrays.copyOfRange(sealed, sealed.length - 16, sealed.length);
    byte[] wrong = FiOtpCrypto.derive("wrong password", salt, 600_000);
    assertThrows(new Attempt() { public void run() { FiOtpCrypto.decrypt(ciphertext, tag, wrong, nonce); } });
    byte[] alteredCiphertext = ciphertext.clone();
    alteredCiphertext[0] ^= 1;
    assertThrows(new Attempt() { public void run() { FiOtpCrypto.decrypt(alteredCiphertext, tag, key, nonce); } });
    byte[] alteredTag = tag.clone();
    alteredTag[0] ^= 1;
    assertThrows(new Attempt() { public void run() { FiOtpCrypto.decrypt(ciphertext, alteredTag, key, nonce); } });
    FiOtpCrypto.wipe(key);
    FiOtpCrypto.wipe(wrong);
  }

  private static void iterationBounds() {
    FiOtpCrypto.checkIterations(100_000);
    FiOtpCrypto.checkIterations(5_000_000);
    assertThrows(new Attempt() { public void run() { FiOtpCrypto.checkIterations(99_999); } });
    assertThrows(new Attempt() { public void run() { FiOtpCrypto.checkIterations(5_000_001); } });
  }

  private static void malformedVaultRecoversBak() throws Exception {
    File root = Files.createTempDirectory("fiotp-vault-test").toFile();
    try {
      File vault = new File(root, "kasa.json");
      String plaintext = "{\"schema\":1,\"accounts\":[{\"id\":\"one\",\"secret\":\"JBSWY3DPEHPK3PXP\"}]}";
      FiOtpVaultFiles.clearKeyForTest();
      assertTrue(ok(FiOtpVaultFiles.invoke("vault.create", jsonPathPassword(vault, "correct horse battery", plaintext), vault.getPath())));
      String second = "{\"schema\":1,\"accounts\":[{\"id\":\"one\"},{\"id\":\"two\"}]}";
      assertTrue(ok(FiOtpVaultFiles.invoke("vault.save", "{\"path\":" + FiOtpJson.quote(vault.getPath()) + ",\"plaintext\":" + FiOtpJson.quote(plaintext) + "}", vault.getPath())));
      assertTrue(ok(FiOtpVaultFiles.invoke("vault.save", "{\"path\":" + FiOtpJson.quote(vault.getPath()) + ",\"plaintext\":" + FiOtpJson.quote(second) + "}", vault.getPath())));
      Files.write(vault.toPath(), "not a valid envelope".getBytes(StandardCharsets.UTF_8));
      FiOtpVaultFiles.clearKeyForTest();
      String opened = FiOtpVaultFiles.invoke("vault.open", "{\"path\":" + FiOtpJson.quote(vault.getPath()) + ",\"password\":\"correct horse battery\"}", vault.getPath());
      assertTrue(opened.contains("\"recoveredFromBackup\":true"));
      assertTrue(opened.contains("\"accountCount\":1"));
      assertTrue(new File(vault.getPath() + ".bak").isFile());
    } finally {
      FiOtpVaultFiles.clearKeyForTest();
      deleteTree(root);
    }
  }

  private static void wrongPasswordMessage() throws Exception {
    File root = Files.createTempDirectory("fiotp-vault-password").toFile();
    try {
      File vault = new File(root, "kasa.json");
      FiOtpVaultFiles.clearKeyForTest();
      assertTrue(ok(FiOtpVaultFiles.invoke("vault.create", jsonPathPassword(vault, "correct horse battery", "{\"schema\":1,\"accounts\":[]}"), vault.getPath())));
      FiOtpVaultFiles.clearKeyForTest();
      String opened = FiOtpVaultFiles.invoke("vault.open", "{\"path\":" + FiOtpJson.quote(vault.getPath()) + ",\"password\":\"incorrect password\"}", vault.getPath());
      assertTrue(!ok(opened));
      assertTrue(opened.contains("Parola hatalı"));
    } finally {
      FiOtpVaultFiles.clearKeyForTest();
      deleteTree(root);
    }
  }

  private static void savePreservesKdf() throws Exception {
    File root = Files.createTempDirectory("fiotp-vault-interop").toFile();
    try {
      File vault = new File(root, "kasa.json");
      byte[] salt = rising(16);
      byte[] key = FiOtpCrypto.derive("correct horse battery", salt, 100_000);
      byte[] nonce = rising(12);
      byte[] sealed = FiOtpCrypto.encrypt("{\"schema\":1,\"accounts\":[]}".getBytes(StandardCharsets.UTF_8), key, nonce);
      String envelope = "{\"version\":1,\"cipher\":\"AES-256-GCM\",\"kdf\":\"PBKDF2-HMAC-SHA256\",\"iterations\":100000"
        + ",\"salt\":" + FiOtpJson.quote(FiOtpCrypto.base64(salt))
        + ",\"nonce\":" + FiOtpJson.quote(FiOtpCrypto.base64(nonce))
        + ",\"ciphertext\":" + FiOtpJson.quote(FiOtpCrypto.base64(Arrays.copyOf(sealed, sealed.length - 16)))
        + ",\"tag\":" + FiOtpJson.quote(FiOtpCrypto.base64(Arrays.copyOfRange(sealed, sealed.length - 16, sealed.length)))
        + "}";
      Files.write(vault.toPath(), envelope.getBytes(StandardCharsets.UTF_8));
      FiOtpVaultFiles.clearKeyForTest();
      assertTrue(ok(FiOtpVaultFiles.invoke("vault.open", "{\"path\":" + FiOtpJson.quote(vault.getPath()) + ",\"password\":\"correct horse battery\"}", vault.getPath())));
      String savedPlaintext = "{\"schema\":1,\"accounts\":[{\"id\":\"one\"}]}";
      assertTrue(ok(FiOtpVaultFiles.invoke("vault.save", "{\"path\":" + FiOtpJson.quote(vault.getPath()) + ",\"plaintext\":" + FiOtpJson.quote(savedPlaintext) + "}", vault.getPath())));
      Map<String, Object> stored = FiOtpJson.object(new String(Files.readAllBytes(vault.toPath()), StandardCharsets.UTF_8));
      assertTrue(Long.valueOf(100_000).equals(stored.get("iterations")));
      assertEquals(FiOtpCrypto.base64(salt), (String) stored.get("salt"));
      FiOtpCrypto.wipe(key);
    } finally {
      FiOtpVaultFiles.clearKeyForTest();
      deleteTree(root);
    }
  }

  private static void unsupportedIterationsRejected() throws Exception {
    File root = Files.createTempDirectory("fiotp-vault-kdf").toFile();
    try {
      File vault = new File(root, "kasa.json");
      String envelope = "{\"version\":1,\"cipher\":\"AES-256-GCM\",\"kdf\":\"PBKDF2-HMAC-SHA256\",\"iterations\":99999"
        + ",\"salt\":" + FiOtpJson.quote(FiOtpCrypto.base64(rising(16)))
        + ",\"nonce\":" + FiOtpJson.quote(FiOtpCrypto.base64(rising(12)))
        + ",\"ciphertext\":\"\",\"tag\":" + FiOtpJson.quote(FiOtpCrypto.base64(new byte[16])) + "}";
      Files.write(vault.toPath(), envelope.getBytes(StandardCharsets.UTF_8));
      String opened = FiOtpVaultFiles.invoke("vault.readExternal", "{\"path\":" + FiOtpJson.quote(vault.getPath()) + ",\"password\":\"correct horse battery\"}", vault.getPath());
      assertTrue(!ok(opened));
      assertTrue(opened.contains("Kasa KDF"));
    } finally {
      deleteTree(root);
    }
  }

  private static String jsonPathPassword(File vault, String password, String plaintext) {
    return "{\"path\":" + FiOtpJson.quote(vault.getPath()) + ",\"password\":" + FiOtpJson.quote(password) + ",\"plaintext\":" + FiOtpJson.quote(plaintext) + "}";
  }

  private static boolean ok(String response) {
    return response.startsWith("{\"ok\":true");
  }

  private static byte[] rising(int length) {
    byte[] bytes = new byte[length];
    for (int i = 0; i < length; i++) bytes[i] = (byte) i;
    return bytes;
  }

  private static String hex(byte[] bytes) {
    StringBuilder out = new StringBuilder(bytes.length * 2);
    for (byte value : bytes) out.append(String.format("%02x", Integer.valueOf(value & 255)));
    return out.toString();
  }

  private static void assertEquals(String expected, String actual) {
    if (!expected.equals(actual)) throw new AssertionError(expected + " != " + actual);
  }

  private static void assertTrue(boolean value) {
    if (!value) throw new AssertionError("expected true");
  }

  private static void assertThrows(Attempt attempt) {
    try {
      attempt.run();
    } catch (RuntimeException error) {
      return;
    }
    throw new AssertionError("expected failure");
  }

  private static void deleteTree(File file) {
    File[] children = file.listFiles();
    if (children != null) for (File child : children) deleteTree(child);
    file.delete();
  }

  private interface Attempt { void run(); }
}

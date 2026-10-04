#include "fiotp_host.h"

#include <SDL.h>
#include <nlohmann/json.hpp>
#include <openssl/crypto.h>
#include <openssl/evp.h>
#include <openssl/hmac.h>
#include <openssl/rand.h>

#include <algorithm>
#include <array>
#include <cerrno>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <optional>
#include <spawn.h>
#include <stdexcept>
#include <string>
#include <vector>
#include <utility>
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

extern char **environ;

namespace {
using Json = nlohmann::json;
namespace fs = std::filesystem;
constexpr uint32_t kIterations = 600000;
constexpr size_t kKeyLength = 32;
constexpr size_t kSaltLength = 16;
constexpr size_t kNonceLength = 12;
constexpr size_t kTagLength = 16;
constexpr size_t kMaxFileSize = 32 * 1024 * 1024;

std::vector<unsigned char> gKey;
std::string gVaultPath;

struct CleanseOnExit {
  std::vector<unsigned char> &bytes;
  ~CleanseOnExit() { if (!bytes.empty()) OPENSSL_cleanse(bytes.data(), bytes.size()); }
};

std::string homeDirectory() {
  const char *home = std::getenv("HOME");
  return home && *home ? home : "/tmp";
}

std::string defaultVaultPath() {
  const char *xdg = std::getenv("XDG_DATA_HOME");
  fs::path root = xdg && *xdg ? fs::path(xdg) : fs::path(homeDirectory()) / ".local" / "share";
#ifdef FIOTP_SAILFISH
  return (root / "com.fiskindal" / "fiotp" / "kasa.json").string();
#else
  return (root / "fiotp" / "kasa.json").string();
#endif
}

std::string settingsPath() {
  const char *xdg = std::getenv("XDG_CONFIG_HOME");
  fs::path root = xdg && *xdg ? fs::path(xdg) : fs::path(homeDirectory()) / ".config";
#ifdef FIOTP_SAILFISH
  return (root / "com.fiskindal" / "fiotp" / "settings.json").string();
#else
  return (root / "fiotp" / "settings.json").string();
#endif
}

std::string expandPath(std::string path) {
  if (path.empty()) return defaultVaultPath();
  if (path == "~") return homeDirectory();
  if (path.rfind("~/", 0) == 0) return (fs::path(homeDirectory()) / path.substr(2)).lexically_normal().string();
  return fs::absolute(fs::path(path)).lexically_normal().string();
}

std::string stringArg(const Json &args, const char *key, std::string fallback = {}) {
  auto it = args.find(key);
  if (it == args.end() || it->is_null()) return fallback;
  if (!it->is_string()) throw std::runtime_error(std::string("Geçersiz istek alanı: ") + key);
  return it->get<std::string>();
}

std::vector<unsigned char> randomBytes(size_t length) {
  std::vector<unsigned char> out(length);
  if (length && RAND_bytes(out.data(), static_cast<int>(length)) != 1) {
    throw std::runtime_error("Güvenli rastgele veri üretilemedi.");
  }
  return out;
}

std::string base64Encode(const unsigned char *bytes, size_t length) {
  if (length == 0) return {};
  std::string out(4 * ((length + 2) / 3), '\0');
  int written = EVP_EncodeBlock(reinterpret_cast<unsigned char *>(out.data()), bytes, static_cast<int>(length));
  if (written < 0) throw std::runtime_error("Base64 kodlama başarısız oldu.");
  out.resize(static_cast<size_t>(written));
  return out;
}

std::string base64Encode(const std::vector<unsigned char> &bytes) {
  return base64Encode(bytes.data(), bytes.size());
}

std::vector<unsigned char> base64Decode(const std::string &text) {
  if (text.empty()) return {};
  if (text.size() % 4 != 0) throw std::runtime_error("Kasa Base64 alanı bozuk.");
  std::vector<unsigned char> out((text.size() / 4) * 3);
  int written = EVP_DecodeBlock(out.data(), reinterpret_cast<const unsigned char *>(text.data()), static_cast<int>(text.size()));
  if (written < 0) throw std::runtime_error("Kasa Base64 alanı bozuk.");
  if (!text.empty() && text.back() == '=') --written;
  if (text.size() > 1 && text[text.size() - 2] == '=') --written;
  out.resize(static_cast<size_t>(std::max(written, 0)));
  return out;
}

std::vector<unsigned char> deriveKey(const std::string &password, const std::vector<unsigned char> &salt, uint32_t iterations) {
  std::vector<unsigned char> key(kKeyLength);
  if (PKCS5_PBKDF2_HMAC(password.data(), static_cast<int>(password.size()), salt.data(), static_cast<int>(salt.size()),
                        static_cast<int>(iterations), EVP_sha256(), static_cast<int>(key.size()), key.data()) != 1) {
    throw std::runtime_error("Parola anahtarı türetilemedi.");
  }
  return key;
}

struct CipherText {
  std::vector<unsigned char> ciphertext;
  std::vector<unsigned char> tag;
};

CipherText encryptGcm(const std::string &plaintext, const std::vector<unsigned char> &key,
                      const std::vector<unsigned char> &nonce) {
  EVP_CIPHER_CTX *ctx = EVP_CIPHER_CTX_new();
  if (!ctx) throw std::runtime_error("Şifreleme başlatılamadı.");
  CipherText result;
  result.ciphertext.resize(plaintext.size() + EVP_MAX_BLOCK_LENGTH);
  result.tag.resize(kTagLength);
  int count = 0, total = 0;
  bool ok = EVP_EncryptInit_ex(ctx, EVP_aes_256_gcm(), nullptr, nullptr, nullptr) == 1 &&
            EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_IVLEN, static_cast<int>(nonce.size()), nullptr) == 1 &&
            EVP_EncryptInit_ex(ctx, nullptr, nullptr, key.data(), nonce.data()) == 1;
  if (ok && !plaintext.empty()) {
    ok = EVP_EncryptUpdate(ctx, result.ciphertext.data(), &count,
                           reinterpret_cast<const unsigned char *>(plaintext.data()), static_cast<int>(plaintext.size())) == 1;
    total = count;
  }
  if (ok) {
    ok = EVP_EncryptFinal_ex(ctx, result.ciphertext.data() + total, &count) == 1;
    total += count;
  }
  if (ok) ok = EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_GET_TAG, static_cast<int>(result.tag.size()), result.tag.data()) == 1;
  EVP_CIPHER_CTX_free(ctx);
  if (!ok) throw std::runtime_error("Kasa şifrelenemedi.");
  result.ciphertext.resize(static_cast<size_t>(total));
  return result;
}

std::string decryptGcm(const std::vector<unsigned char> &ciphertext, const std::vector<unsigned char> &key,
                       const std::vector<unsigned char> &nonce, const std::vector<unsigned char> &tag) {
  if (key.size() != kKeyLength || nonce.size() != kNonceLength || tag.size() != kTagLength) {
    throw std::runtime_error("Kasa şifreleme alanları bozuk.");
  }
  EVP_CIPHER_CTX *ctx = EVP_CIPHER_CTX_new();
  if (!ctx) throw std::runtime_error("Kasa açılamadı.");
  std::vector<unsigned char> plaintext(ciphertext.size() + EVP_MAX_BLOCK_LENGTH);
  int count = 0, total = 0;
  bool ok = EVP_DecryptInit_ex(ctx, EVP_aes_256_gcm(), nullptr, nullptr, nullptr) == 1 &&
            EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_IVLEN, static_cast<int>(nonce.size()), nullptr) == 1 &&
            EVP_DecryptInit_ex(ctx, nullptr, nullptr, key.data(), nonce.data()) == 1;
  if (ok && !ciphertext.empty()) {
    ok = EVP_DecryptUpdate(ctx, plaintext.data(), &count, ciphertext.data(), static_cast<int>(ciphertext.size())) == 1;
    total = count;
  }
  if (ok) ok = EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_TAG, static_cast<int>(tag.size()), const_cast<unsigned char *>(tag.data())) == 1;
  if (ok) {
    ok = EVP_DecryptFinal_ex(ctx, plaintext.data() + total, &count) == 1;
    total += count;
  }
  EVP_CIPHER_CTX_free(ctx);
  if (!ok) {
    OPENSSL_cleanse(plaintext.data(), plaintext.size());
    throw std::runtime_error("Parola hatalı veya kasa bozulmuş/kurcalanmış.");
  }
  std::string out(reinterpret_cast<const char *>(plaintext.data()), static_cast<size_t>(total));
  OPENSSL_cleanse(plaintext.data(), plaintext.size());
  return out;
}

Json encryptPayload(const std::string &plaintext, const std::vector<unsigned char> &key) {
  const auto nonce = randomBytes(kNonceLength);
  const auto encrypted = encryptGcm(plaintext, key, nonce);
  return Json{{"version", 1}, {"cipher", "AES-256-GCM"}, {"kdf", "PBKDF2-HMAC-SHA256"},
              {"iterations", kIterations}, {"nonce", base64Encode(nonce)},
              {"ciphertext", base64Encode(encrypted.ciphertext)}, {"tag", base64Encode(encrypted.tag)}};
}

Json readEnvelope(const std::string &path) {
  std::ifstream input(path, std::ios::binary);
  if (!input) throw std::runtime_error("Kasa dosyası açılamadı: " + path);
  input.seekg(0, std::ios::end);
  const std::streamoff size = input.tellg();
  if (size < 0 || static_cast<uint64_t>(size) > kMaxFileSize) throw std::runtime_error("Kasa dosyası geçersiz boyutta.");
  input.seekg(0, std::ios::beg);
  std::string bytes(static_cast<size_t>(size), '\0');
  if (!bytes.empty()) input.read(bytes.data(), static_cast<std::streamsize>(bytes.size()));
  try {
    Json envelope = Json::parse(bytes);
    if (!envelope.is_object()) throw std::runtime_error("Kasa dosyası geçerli JSON değil.");
    return envelope;
  } catch (const Json::exception &) {
    throw std::runtime_error("Kasa dosyası geçerli JSON değil.");
  }
}

void writeAtomic(const std::string &path, const std::string &contents, bool backup) {
  fs::path destination(path);
  fs::create_directories(destination.parent_path());
  // Use mkstemp so a pre-existing symlink or guessed temporary name cannot redirect a write.
  std::string pattern = path + ".tmp-XXXXXX";
  std::vector<char> mutablePattern(pattern.begin(), pattern.end());
  mutablePattern.push_back('\0');
  int fd = mkstemp(mutablePattern.data());
  if (fd < 0) throw std::runtime_error("Geçici kasa dosyası oluşturulamadı.");
  const std::string actualTemp(mutablePattern.data());
  fchmod(fd, S_IRUSR | S_IWUSR);
  size_t offset = 0;
  while (offset < contents.size()) {
    const ssize_t written = ::write(fd, contents.data() + offset, contents.size() - offset);
    if (written < 0 && errno == EINTR) continue;
    if (written <= 0) { close(fd); unlink(actualTemp.c_str()); throw std::runtime_error("Kasa dosyası yazılamadı."); }
    offset += static_cast<size_t>(written);
  }
  const int syncResult = fsync(fd);
  const int closeResult = close(fd);
  if (syncResult != 0 || closeResult != 0) { unlink(actualTemp.c_str()); throw std::runtime_error("Kasa dosyası diske yazılamadı."); }
  if (backup && fs::exists(destination)) {
    const fs::path bak(path + ".bak");
    std::error_code ec;
    fs::copy_file(destination, bak, fs::copy_options::overwrite_existing, ec);
    if (ec) { unlink(actualTemp.c_str()); throw std::runtime_error("Önceki kasa yedeği yazılamadı: " + ec.message()); }
    chmod(bak.c_str(), S_IRUSR | S_IWUSR);
  }
  if (::rename(actualTemp.c_str(), path.c_str()) != 0) {
    const int savedErrno = errno;
    unlink(actualTemp.c_str());
    throw std::runtime_error("Kasa dosyası atomik olarak kaydedilemedi: " + std::string(std::strerror(savedErrno)));
  }
  chmod(path.c_str(), S_IRUSR | S_IWUSR);
  int dirFd = open(destination.parent_path().c_str(), O_RDONLY | O_DIRECTORY);
  if (dirFd >= 0) { fsync(dirFd); close(dirFd); }
}

Json encryptWithSaltAndIterations(const std::string &plaintext, const std::vector<unsigned char> &key,
                                 const std::vector<unsigned char> &salt, uint32_t iterations) {
  Json envelope = encryptPayload(plaintext, key);
  envelope["salt"] = base64Encode(salt);
  envelope["iterations"] = iterations;
  return envelope;
}

std::pair<std::vector<unsigned char>, uint32_t> kdfMetadata(const Json &envelope) {
  if (envelope.value("version", 0) != 1 || envelope.value("cipher", std::string()) != "AES-256-GCM") {
    throw std::runtime_error("Desteklenmeyen veya geçersiz kasa formatı.");
  }
  if (!envelope.contains("salt") || !envelope["salt"].is_string() || !envelope.contains("iterations") ||
      (!envelope["iterations"].is_number_unsigned() && !envelope["iterations"].is_number_integer())) {
    throw std::runtime_error("Kasa KDF bilgileri geçersiz.");
  }
  const auto salt = base64Decode(envelope["salt"].get<std::string>());
  const int64_t iterationsRaw = envelope["iterations"].get<int64_t>();
  if (salt.size() != kSaltLength || iterationsRaw < 100000 || iterationsRaw > 5000000) {
    throw std::runtime_error("Kasa KDF bilgileri geçersiz.");
  }
  return {salt, static_cast<uint32_t>(iterationsRaw)};
}

std::string decryptPayload(const Json &envelope, const std::vector<unsigned char> &key) {
  for (const char *field : {"nonce", "ciphertext", "tag"}) {
    if (!envelope.contains(field) || !envelope[field].is_string()) throw std::runtime_error("Kasa şifreleme alanları bozuk.");
  }
  const auto nonce = base64Decode(envelope["nonce"].get<std::string>());
  const auto ciphertext = base64Decode(envelope["ciphertext"].get<std::string>());
  const auto tag = base64Decode(envelope["tag"].get<std::string>());
  return decryptGcm(ciphertext, key, nonce, tag);
}

Json openAtPath(const std::string &path, const std::string &password, bool keepKey) {
  const Json envelope = readEnvelope(path);
  const auto [salt, iterations] = kdfMetadata(envelope);
  auto key = deriveKey(password, salt, iterations);
  CleanseOnExit cleanseKey{key};
  const std::string plaintext = decryptPayload(envelope, key);
  Json payload;
  try { payload = Json::parse(plaintext); }
  catch (const Json::exception &) { throw std::runtime_error("Kasa içeriği geçerli JSON değil."); }
  if (!payload.is_object() || !payload.contains("accounts") || !payload["accounts"].is_array()) {
    throw std::runtime_error("Kasa hesap listesi içermiyor.");
  }
  if (keepKey) {
    if (!gKey.empty()) OPENSSL_cleanse(gKey.data(), gKey.size());
    gKey = std::move(key);
    gVaultPath = path;
  } else if (!key.empty()) {
    OPENSSL_cleanse(key.data(), key.size());
  }
  Json result = {{"path", path}, {"plaintext", plaintext}, {"accountCount", payload["accounts"].size()}};
  return result;
}

void savePlaintext(const std::string &path, const std::string &plaintext, const std::vector<unsigned char> &key) {
  const Json old = readEnvelope(path);
  const auto [salt, iterations] = kdfMetadata(old);
  Json updated = encryptWithSaltAndIterations(plaintext, key, salt, iterations);
  writeAtomic(path, updated.dump(), true);
}

std::optional<std::string> choosePath(bool save, const std::string &title, const std::string &defaultName) {
#ifdef FIOTP_SAILFISH
  (void)title;
  (void)defaultName;
  const std::string path = defaultVaultPath();
  if (save || fs::exists(path)) return path;
  throw std::runtime_error("Sailfish üzerinde kasa dosyasını uygulama veri klasörüne kopyalayın: " + path);
#else
  int pipeFd[2];
  if (pipe(pipeFd) != 0) throw std::runtime_error("Dosya seçici başlatılamadı.");
  std::vector<std::string> args = {"zenity", "--file-selection", "--title", title,
                                   "--file-filter=FiOTP kasa ve yedek (*.json) | *.json"};
  if (save) {
    args.push_back("--save"); args.push_back("--confirm-overwrite");
    args.push_back("--filename=" + defaultName);
  }
  std::vector<char *> argv;
  for (auto &arg : args) argv.push_back(arg.data());
  argv.push_back(nullptr);

  posix_spawn_file_actions_t actions;
  posix_spawn_file_actions_init(&actions);
  posix_spawn_file_actions_adddup2(&actions, pipeFd[1], STDOUT_FILENO);
  posix_spawn_file_actions_addclose(&actions, pipeFd[0]);
  posix_spawn_file_actions_addclose(&actions, pipeFd[1]);
  pid_t child = -1;
  const int spawnError = posix_spawnp(&child, "zenity", &actions, nullptr, argv.data(), ::environ);
  posix_spawn_file_actions_destroy(&actions);
  close(pipeFd[1]);
  if (spawnError != 0) {
    close(pipeFd[0]);
    throw std::runtime_error("Dosya seçici (zenity) başlatılamadı: " + std::string(std::strerror(spawnError)));
  }

  std::string selected;
  char buffer[512];
  for (;;) {
    ssize_t n = read(pipeFd[0], buffer, sizeof(buffer));
    if (n > 0) selected.append(buffer, static_cast<size_t>(n));
    else if (n < 0 && errno == EINTR) continue;
    else break;
  }
  close(pipeFd[0]);
  int status = 0;
  while (waitpid(child, &status, 0) < 0 && errno == EINTR) {}
  if (!WIFEXITED(status)) throw std::runtime_error("Linux dosya seçici beklenmedik biçimde kapandı.");
  const int exitCode = WEXITSTATUS(status);
  if (exitCode == 1) return std::nullopt;
  if (exitCode != 0) throw std::runtime_error("Dosya seçici hata verdi.");
  while (!selected.empty() && (selected.back() == '\n' || selected.back() == '\r')) selected.pop_back();
  if (selected.empty()) return std::nullopt;
  return selected;
#endif
}

void clearVaultKey() {
  if (!gKey.empty()) OPENSSL_cleanse(gKey.data(), gKey.size());
  gKey.clear();
  gKey.shrink_to_fit();
  gVaultPath.clear();
}

std::string jsonResponse(bool ok, Json data = Json::object(), const std::string &message = {}, const std::string &code = {}) {
  Json root = {{"ok", ok}};
  if (ok) root["data"] = std::move(data);
  else { root["error"] = message; root["code"] = code; }
  return root.dump();
}
}

std::string fiotp_host_invoke(const std::string &method, const std::string &payload) {
  try {
    Json args = Json::parse(payload.empty() ? "{}" : payload);
    if (!args.is_object()) return jsonResponse(false, {}, "Geçersiz istek.", "invalid_request");

    if (method == "platform.info") return jsonResponse(true, {{"platform", "linux"}});
    if (method == "vault.defaultPath") return jsonResponse(true, {{"path", defaultVaultPath()}});
    if (method == "vault.selectedPath") {
      Json settings = Json::object();
      try { settings = readEnvelope(settingsPath()); } catch (...) {}
      return jsonResponse(true, {{"path", settings.value("selectedVaultPath", std::string())}});
    }
    if (method == "vault.rememberPath") {
      const std::string path = expandPath(stringArg(args, "path"));
      if (path.empty()) return jsonResponse(false, {}, "Kasa yolu geçersiz.", "invalid_path");
      writeAtomic(settingsPath(), Json{{"selectedVaultPath", path}}.dump(), false);
      return jsonResponse(true, {{"path", path}});
    }
    if (method == "vault.status") {
      const std::string path = expandPath(stringArg(args, "path"));
      return jsonResponse(true, {{"exists", fs::exists(path)}, {"path", path}});
    }
    if (method == "vault.discover") {
      std::string path = expandPath(stringArg(args, "preferredPath"));
      if (!fs::exists(path)) path = defaultVaultPath();
      return jsonResponse(true, {{"exists", fs::exists(path)}, {"path", path}});
    }
    if (method == "vault.create") {
      const std::string password = stringArg(args, "password");
      if (password.size() < 8) return jsonResponse(false, {}, "Master parola en az 8 karakter olmalıdır.", "weak_password");
      const std::string path = expandPath(stringArg(args, "path"));
      if (fs::exists(path)) return jsonResponse(false, {}, "Bu konumda zaten bir kasa var. Mevcut kasayı açın veya başka bir konum seçin.", "vault_exists");
      const auto salt = randomBytes(kSaltLength);
      auto key = deriveKey(password, salt, kIterations);
      CleanseOnExit cleanseKey{key};
      Json envelope = encryptWithSaltAndIterations(stringArg(args, "plaintext"), key, salt, kIterations);
      writeAtomic(path, envelope.dump(), true);
      if (!gKey.empty()) OPENSSL_cleanse(gKey.data(), gKey.size());
      gKey = std::move(key);
      gVaultPath = path;
      return jsonResponse(true, {{"path", path}});
    }
    if (method == "vault.open" || method == "vault.readExternal") {
      const std::string path = expandPath(stringArg(args, "path"));
      const bool keep = method == "vault.open";
      try {
        return jsonResponse(true, openAtPath(path, stringArg(args, "password"), keep));
      } catch (const std::exception &original) {
        if (!keep) throw;
        try {
          Json recovered = openAtPath(path + ".bak", stringArg(args, "password"), true);
          recovered["path"] = path;
          recovered["recoveredFromBackup"] = true;
          gVaultPath = path;
          return jsonResponse(true, std::move(recovered));
        } catch (...) {
          return jsonResponse(false, {}, original.what(), "open_failed");
        }
      }
    }
    if (method == "vault.save") {
      if (gKey.empty()) return jsonResponse(false, {}, "Kasa kilitli.", "locked");
      const std::string path = expandPath(stringArg(args, "path", gVaultPath));
      savePlaintext(path, stringArg(args, "plaintext"), gKey);
      return jsonResponse(true);
    }
    if (method == "vault.lock") { clearVaultKey(); return jsonResponse(true); }
    if (method == "vault.changePassword") {
      const std::string path = expandPath(stringArg(args, "path", gVaultPath));
      openAtPath(path, stringArg(args, "currentPassword"), false);
      const std::string newPassword = stringArg(args, "newPassword");
      if (newPassword.size() < 8) return jsonResponse(false, {}, "Yeni parola en az 8 karakter olmalıdır.", "weak_password");
      const auto salt = randomBytes(kSaltLength);
      auto key = deriveKey(newPassword, salt, kIterations);
      CleanseOnExit cleanseKey{key};
      const Json envelope = encryptWithSaltAndIterations(stringArg(args, "plaintext"), key, salt, kIterations);
      writeAtomic(path, envelope.dump(), true);
      if (!gKey.empty()) OPENSSL_cleanse(gKey.data(), gKey.size());
      gKey = std::move(key);
      gVaultPath = path;
      return jsonResponse(true);
    }
    if (method == "vault.export") {
      const std::string source = expandPath(stringArg(args, "source"));
      const std::string destination = expandPath(stringArg(args, "destination"));
      fs::create_directories(fs::path(destination).parent_path());
      fs::copy_file(source, destination, fs::copy_options::overwrite_existing);
      chmod(destination.c_str(), S_IRUSR | S_IWUSR);
      return jsonResponse(true, {{"path", destination}});
    }
    if (method == "clipboard.copy") {
      const std::string text = stringArg(args, "text");
      if (SDL_SetClipboardText(text.c_str()) != 0) return jsonResponse(false, {}, SDL_GetError(), "clipboard_failed");
      return jsonResponse(true);
    }
    if (method == "crypto.hmac") {
      auto key = base64Decode(stringArg(args, "key"));
      const auto message = base64Decode(stringArg(args, "message"));
      CleanseOnExit cleanseHmacKey{key};
      const std::string algorithm = stringArg(args, "algorithm", "SHA1");
      const EVP_MD *md = algorithm == "SHA256" ? EVP_sha256() : algorithm == "SHA512" ? EVP_sha512() : EVP_sha1();
      unsigned int length = EVP_MAX_MD_SIZE;
      std::array<unsigned char, EVP_MAX_MD_SIZE> digest{};
      if (!HMAC(md, key.data(), static_cast<int>(key.size()), message.data(), message.size(), digest.data(), &length)) {
        return jsonResponse(false, {}, "HMAC üretilemedi.", "crypto_failed");
      }
      return jsonResponse(true, {{"digest", base64Encode(digest.data(), length)}});
    }
    if (method == "qr.scanCamera") {
      return jsonResponse(false, {}, "Bu Linux hedefinde kamera ile QR tarama desteklenmiyor. Hesabı otpauth:// URI ile ekleyebilirsiniz.", "camera_unavailable");
    }
    if (method.rfind("dialog.", 0) == 0) {
      const bool save = method == "dialog.saveVault" || method == "dialog.saveBackup";
      const bool backup = method.find("Backup") != std::string::npos;
      const auto selected = choosePath(save, backup ? "FiOTP şifreli yedeği" : "FiOTP kasası",
                                       backup ? "fiotp-backup.json" : "kasa.json");
      if (!selected) return jsonResponse(false, {}, "İşlem iptal edildi.", "cancelled");
      return jsonResponse(true, {{"path", *selected}});
    }
    return jsonResponse(false, {}, "Bilinmeyen Linux işlemi: " + method, "unknown_method");
  } catch (const Json::exception &) {
    return jsonResponse(false, {}, "Geçersiz istek veya JSON verisi.", "invalid_request");
  } catch (const std::exception &error) {
    return jsonResponse(false, {}, error.what(), "native_error");
  }
}

#ifndef FIOTP_HOST_STANDALONE
namespace {
std::string fiotp_host_thunk(void *, std::string method, std::string payload) {
  return fiotp_host_invoke(method, payload);
}
}
gea::CallableObject<std::string(std::string, std::string)> fiotpHostInvoke{fiotp_host_thunk, nullptr};
#endif

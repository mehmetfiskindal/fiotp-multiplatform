#include "fiotp_host.h"

#include <jni.h>

#include <string>

namespace {
JavaVM *g_vm = nullptr;
jclass g_host = nullptr;
jmethodID g_invoke = nullptr;

std::string utf8FromJava(JNIEnv *env, jstring value) {
  if (!value) return {};
  jclass stringClass = env->FindClass("java/lang/String");
  jmethodID getBytes = env->GetMethodID(stringClass, "getBytes", "(Ljava/lang/String;)[B");
  jstring charset = env->NewStringUTF("UTF-8");
  jbyteArray bytes = static_cast<jbyteArray>(env->CallObjectMethod(value, getBytes, charset));
  env->DeleteLocalRef(charset);
  env->DeleteLocalRef(stringClass);
  if (!bytes || env->ExceptionCheck()) {
    env->ExceptionClear();
    return {};
  }
  jsize length = env->GetArrayLength(bytes);
  std::string out(static_cast<size_t>(length), '\0');
  if (length > 0) env->GetByteArrayRegion(bytes, 0, length, reinterpret_cast<jbyte *>(out.data()));
  env->DeleteLocalRef(bytes);
  return out;
}

jstring javaFromUtf8(JNIEnv *env, const std::string &value) {
  jbyteArray bytes = env->NewByteArray(static_cast<jsize>(value.size()));
  if (!bytes) return nullptr;
  if (!value.empty()) env->SetByteArrayRegion(bytes, 0, static_cast<jsize>(value.size()), reinterpret_cast<const jbyte *>(value.data()));
  jclass stringClass = env->FindClass("java/lang/String");
  jmethodID constructor = env->GetMethodID(stringClass, "<init>", "([BLjava/lang/String;)V");
  jstring charset = env->NewStringUTF("UTF-8");
  jstring out = static_cast<jstring>(env->NewObject(stringClass, constructor, bytes, charset));
  env->DeleteLocalRef(charset);
  env->DeleteLocalRef(stringClass);
  env->DeleteLocalRef(bytes);
  return out;
}

std::string callHost(const std::string &method, const std::string &payload) {
  const char *unavailable = "{\"ok\":false,\"error\":\"Android host hazır değil.\",\"code\":\"host_unavailable\"}";
  if (!g_vm || !g_host || !g_invoke) return unavailable;
  JNIEnv *env = nullptr;
  bool attached = false;
  if (g_vm->GetEnv(reinterpret_cast<void **>(&env), JNI_VERSION_1_6) != JNI_OK) {
    if (g_vm->AttachCurrentThread(&env, nullptr) != JNI_OK || !env) return unavailable;
    attached = true;
  }
  jstring jMethod = javaFromUtf8(env, method);
  jstring jPayload = javaFromUtf8(env, payload);
  if (!jMethod || !jPayload) {
    if (jMethod) env->DeleteLocalRef(jMethod);
    if (jPayload) env->DeleteLocalRef(jPayload);
    if (attached) g_vm->DetachCurrentThread();
    return "{\"ok\":false,\"error\":\"Android host çağrısı kurulamadı.\",\"code\":\"native_error\"}";
  }
  jstring result = static_cast<jstring>(env->CallStaticObjectMethod(g_host, g_invoke, jMethod, jPayload));
  env->DeleteLocalRef(jMethod);
  env->DeleteLocalRef(jPayload);
  if (env->ExceptionCheck() || !result) {
    env->ExceptionClear();
    if (attached) g_vm->DetachCurrentThread();
    return "{\"ok\":false,\"error\":\"Android host çağrısı başarısız oldu.\",\"code\":\"native_error\"}";
  }
  std::string out = utf8FromJava(env, result);
  env->DeleteLocalRef(result);
  if (attached) g_vm->DetachCurrentThread();
  if (out.empty()) return "{\"ok\":false,\"error\":\"Android host boş yanıt verdi.\",\"code\":\"native_error\"}";
  return out;
}
}

extern "C" JNIEXPORT void JNICALL Java_com_fiskindal_fiotp_FiOtpHost_nativeRegister(JNIEnv *env, jclass cls) {
  env->GetJavaVM(&g_vm);
  if (g_host) env->DeleteGlobalRef(g_host);
  g_host = static_cast<jclass>(env->NewGlobalRef(cls));
  g_invoke = env->GetStaticMethodID(cls, "invoke", "(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;");
}

std::string fiotp_host_invoke(const std::string &method, const std::string &payload) {
  return callHost(method, payload);
}

#ifndef FIOTP_HOST_STANDALONE
namespace {
std::string fiotp_host_thunk(void *, std::string method, std::string payload) {
  return fiotp_host_invoke(method, payload);
}
}
gea::CallableObject<std::string(std::string, std::string)> fiotpHostInvoke{fiotp_host_thunk, nullptr};
#endif

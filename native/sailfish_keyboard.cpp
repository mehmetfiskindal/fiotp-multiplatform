#include "sailfish_keyboard.h"

#include <maliit-glib/maliitbus.h>
#include <maliit-glib/maliitinputmethod.h>

#include <cstdio>
#include <cstring>

namespace {
MaliitInputMethod *inputMethod = nullptr;
MaliitContext *context = nullptr;
MaliitServer *server = nullptr;
bool (*appendTextCallback)(const char *) = nullptr;
bool (*backspaceCallback)() = nullptr;
bool keyboardVisible = false;
int focusedInputId = -1;

gboolean commitString(MaliitContext *source, GDBusMethodInvocation *invocation,
                      const gchar *text, gint, gint, gint, gpointer) {
  if (text && appendTextCallback) appendTextCallback(text);
  maliit_context_complete_commit_string(source, invocation);
  return TRUE;
}

gboolean keyEvent(MaliitContext *source, GDBusMethodInvocation *invocation,
                  gint, gint key, gint, const gchar *, gboolean, gint, guchar,
                  gpointer) {
  // Qt::Key_Backspace and Qt::Key_Return/Enter.
  if (key == 0x01000003 && backspaceCallback) backspaceCallback();
  maliit_context_complete_key_event(source, invocation);
  return TRUE;
}
}

void sailfish_keyboard_init(bool (*appendText)(const char *), bool (*backspace)()) {
  appendTextCallback = appendText;
  backspaceCallback = backspace;
  GError *error = nullptr;
  context = maliit_get_context_sync(nullptr, &error);
  if (!context) {
    std::fprintf(stderr, "[sailfish keyboard] context unavailable: %s\n", error ? error->message : "unknown");
    if (error) g_error_free(error);
    return;
  }
  g_signal_connect(context, "handle-commit-string", G_CALLBACK(commitString), nullptr);
  g_signal_connect(context, "handle-key-event", G_CALLBACK(keyEvent), nullptr);
  inputMethod = maliit_input_method_new();
  server = maliit_get_server_sync(nullptr, &error);
  if (error) {
    std::fprintf(stderr, "[sailfish keyboard] server unavailable: %s\n", error->message);
    g_error_free(error);
  }
  std::fprintf(stderr, "[sailfish keyboard] Maliit ready\n");
}

void sailfish_keyboard_pump() {
  while (g_main_context_iteration(nullptr, FALSE)) {}
}

void sailfish_keyboard_update(int activeInputId, const char *inputType) {
  if (!inputMethod) return;
  const bool shouldShow = activeInputId >= 0;
  if (shouldShow == keyboardVisible && activeInputId == focusedInputId) return;
  focusedInputId = activeInputId;
  if (server) {
    const bool hidden = inputType && std::strcmp(inputType, "password") == 0;
    GVariantBuilder builder;
    g_variant_builder_init(&builder, G_VARIANT_TYPE_VARDICT);
    g_variant_builder_add(&builder, "{sv}", "focusState", g_variant_new_boolean(shouldShow));
    g_variant_builder_add(&builder, "{sv}", "hiddenText", g_variant_new_boolean(hidden));
    g_variant_builder_add(&builder, "{sv}", "predictionEnabled", g_variant_new_boolean(!hidden));
    GVariant *state = g_variant_ref_sink(g_variant_builder_end(&builder));
    GError *error = nullptr;
    if (!maliit_server_call_update_widget_information_sync(server, state, TRUE, nullptr, &error)) {
      std::fprintf(stderr, "[sailfish keyboard] widget update failed: %s\n", error ? error->message : "unknown");
      if (error) g_error_free(error);
    }
    g_variant_unref(state);
  }
  if (shouldShow == keyboardVisible) return;
  keyboardVisible = shouldShow;
  if (shouldShow) maliit_input_method_show(inputMethod);
  else maliit_input_method_hide(inputMethod);
  std::fprintf(stderr, "[sailfish keyboard] %s input=%d\n", shouldShow ? "show" : "hide", activeInputId);
}

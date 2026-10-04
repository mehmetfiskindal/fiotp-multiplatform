#pragma once

void sailfish_keyboard_init(bool (*appendText)(const char *), bool (*backspace)());
void sailfish_keyboard_pump();
void sailfish_keyboard_update(int activeInputId, const char *inputType);

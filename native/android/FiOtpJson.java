package com.fiskindal.fiotp;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Flat and nested JSON for vault envelopes and host requests. No Android APIs. */
final class FiOtpJson {
  private final String text;
  private int index;

  private FiOtpJson(String text) {
    this.text = text == null ? "" : text;
  }

  static Map<String, Object> object(String text) {
    Object value = new FiOtpJson(text).parseValue();
    if (!(value instanceof Map)) throw new IllegalArgumentException("Geçersiz istek.");
    @SuppressWarnings("unchecked")
    Map<String, Object> object = (Map<String, Object>) value;
    return object;
  }

  static String string(Map<String, Object> object, String key) {
    Object value = object.get(key);
    if (value == null) return "";
    if (!(value instanceof String)) throw new IllegalArgumentException("Geçersiz istek alanı: " + key);
    return (String) value;
  }

  static long integer(Map<String, Object> object, String key) {
    Object value = object.get(key);
    if (!(value instanceof Long)) throw new IllegalArgumentException("Geçersiz istek alanı: " + key);
    return ((Long) value).longValue();
  }

  static String quote(String value) {
    String text = value == null ? "" : value;
    StringBuilder out = new StringBuilder(text.length() + 2);
    out.append('"');
    for (int i = 0; i < text.length(); i++) {
      char ch = text.charAt(i);
      switch (ch) {
        case '"': out.append("\\\""); break;
        case '\\': out.append("\\\\"); break;
        case '\b': out.append("\\b"); break;
        case '\f': out.append("\\f"); break;
        case '\n': out.append("\\n"); break;
        case '\r': out.append("\\r"); break;
        case '\t': out.append("\\t"); break;
        default:
          if (ch < 0x20) {
            out.append(String.format("\\u%04x", Integer.valueOf(ch)));
          } else {
            out.append(ch);
          }
      }
    }
    out.append('"');
    return out.toString();
  }

  static String ok(String dataJson) {
    return "{\"ok\":true,\"data\":" + dataJson + "}";
  }

  static String fail(String message, String code) {
    return "{\"ok\":false,\"error\":" + quote(message) + ",\"code\":" + quote(code) + "}";
  }

  static String pathData(String path) {
    return "{\"path\":" + quote(path) + "}";
  }

  private Object parseValue() {
    skip();
    if (index >= text.length()) throw new IllegalArgumentException("Geçersiz istek veya JSON verisi.");
    char ch = text.charAt(index);
    if (ch == '{') return parseObject();
    if (ch == '[') return parseArray();
    if (ch == '"') return parseString();
    if (ch == 't' || ch == 'f') return parseBoolean();
    if (ch == 'n') return parseNull();
    if (ch == '-' || (ch >= '0' && ch <= '9')) return parseNumber();
    throw new IllegalArgumentException("Geçersiz istek veya JSON verisi.");
  }

  private Map<String, Object> parseObject() {
    expect('{');
    Map<String, Object> object = new LinkedHashMap<String, Object>();
    skip();
    if (peek('}')) {
      index++;
      return object;
    }
    while (index < text.length()) {
      skip();
      String key = parseString();
      skip();
      expect(':');
      object.put(key, parseValue());
      skip();
      if (peek('}')) {
        index++;
        return object;
      }
      expect(',');
    }
    throw new IllegalArgumentException("Geçersiz istek veya JSON verisi.");
  }

  private List<Object> parseArray() {
    expect('[');
    List<Object> list = new ArrayList<Object>();
    skip();
    if (peek(']')) {
      index++;
      return list;
    }
    while (index < text.length()) {
      list.add(parseValue());
      skip();
      if (peek(']')) {
        index++;
        return list;
      }
      expect(',');
    }
    throw new IllegalArgumentException("Geçersiz istek veya JSON verisi.");
  }

  private String parseString() {
    expect('"');
    StringBuilder out = new StringBuilder();
    while (index < text.length()) {
      char ch = text.charAt(index++);
      if (ch == '"') return out.toString();
      if (ch != '\\') {
        out.append(ch);
        continue;
      }
      if (index >= text.length()) break;
      char escaped = text.charAt(index++);
      switch (escaped) {
        case '"':
        case '\\':
        case '/':
          out.append(escaped);
          break;
        case 'b': out.append('\b'); break;
        case 'f': out.append('\f'); break;
        case 'n': out.append('\n'); break;
        case 'r': out.append('\r'); break;
        case 't': out.append('\t'); break;
        case 'u':
          if (index + 4 > text.length()) throw new IllegalArgumentException("Geçersiz istek veya JSON verisi.");
          int code = Integer.parseInt(text.substring(index, index + 4), 16);
          index += 4;
          out.append((char) code);
          break;
        default:
          throw new IllegalArgumentException("Geçersiz istek veya JSON verisi.");
      }
    }
    throw new IllegalArgumentException("Geçersiz istek veya JSON verisi.");
  }

  private Boolean parseBoolean() {
    if (text.startsWith("true", index)) {
      index += 4;
      return Boolean.TRUE;
    }
    if (text.startsWith("false", index)) {
      index += 5;
      return Boolean.FALSE;
    }
    throw new IllegalArgumentException("Geçersiz istek veya JSON verisi.");
  }

  private Object parseNull() {
    if (!text.startsWith("null", index)) throw new IllegalArgumentException("Geçersiz istek veya JSON verisi.");
    index += 4;
    return null;
  }

  private Long parseNumber() {
    int start = index;
    if (peek('-')) index++;
    while (index < text.length()) {
      char ch = text.charAt(index);
      if ((ch >= '0' && ch <= '9') || ch == '+' || ch == '-' || ch == '.' || ch == 'e' || ch == 'E') {
        index++;
        continue;
      }
      break;
    }
    String token = text.substring(start, index);
    if (token.indexOf('.') >= 0 || token.indexOf('e') >= 0 || token.indexOf('E') >= 0) {
      throw new IllegalArgumentException("Geçersiz istek veya JSON verisi.");
    }
    return Long.valueOf(token);
  }

  private void skip() {
    while (index < text.length()) {
      char ch = text.charAt(index);
      if (ch != ' ' && ch != '\n' && ch != '\r' && ch != '\t') return;
      index++;
    }
  }

  private boolean peek(char expected) {
    return index < text.length() && text.charAt(index) == expected;
  }

  private void expect(char expected) {
    if (!peek(expected)) throw new IllegalArgumentException("Geçersiz istek veya JSON verisi.");
    index++;
  }
}

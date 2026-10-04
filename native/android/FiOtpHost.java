package com.fiskindal.fiotp;

import android.app.Activity;
import android.app.Dialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.ImageFormat;
import android.graphics.SurfaceTexture;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.media.Image;
import android.media.ImageReader;
import android.net.Uri;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Size;
import android.view.Gravity;
import android.view.TextureView;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import com.google.zxing.BinaryBitmap;
import com.google.zxing.PlanarYUVLuminanceSource;
import com.google.zxing.Result;
import com.google.zxing.common.HybridBinarizer;
import com.google.zxing.qrcode.QRCodeReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

/** Android host bridge. UI stays in the shared Gea view tree; this class owns vault, SAF, clipboard, and QR. */
public final class FiOtpHost {
  private static final String PREFS = "FiOTP";
  private static final String SELECTED_PATH = "FiOTPSelectedVaultPath";
  private static final int OPEN_VAULT = 4701;
  private static final int OPEN_BACKUP = 4702;
  private static final int SAVE_BACKUP = 4703;
  private static final int CAMERA_PERMISSION = 4704;

  private static Activity activity;
  private static final ConcurrentHashMap<String, String> results = new ConcurrentHashMap<String, String>();
  private static final ConcurrentHashMap<Integer, String> requests = new ConcurrentHashMap<Integer, String>();
  private static String pendingCameraId;
  private static Scanner scanner;

  private FiOtpHost() {}

  public static void attach(Activity hostActivity) {
    activity = hostActivity;
    nativeRegister();
  }

  public static void onActivityResult(int requestCode, int resultCode, Intent data) {
    String id = requests.remove(Integer.valueOf(requestCode));
    if (id == null) return;
    if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
      finish(id, FiOtpJson.fail("İşlem iptal edildi.", "cancelled"));
      return;
    }
    Uri uri = data.getData();
    int flags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
    if (flags != 0) {
      try {
        activity.getContentResolver().takePersistableUriPermission(uri, flags);
      } catch (SecurityException ignored) {
        // Some providers grant only the one-shot permission carried by the result.
      }
    }
    finish(id, FiOtpJson.ok(FiOtpJson.pathData(uri.toString())));
  }

  public static void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
    if (requestCode != CAMERA_PERMISSION) return;
    String id = pendingCameraId;
    pendingCameraId = null;
    if (id == null) return;
    boolean granted = grantResults != null && grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
    if (!granted) {
      finish(id, FiOtpJson.fail("Kamera izni verilmedi.", "camera_permission_denied"));
      return;
    }
    openScanner(id);
  }

  public static String invoke(String method, String payload) {
    try {
      if ("platform.info".equals(method)) return FiOtpJson.ok("{\"platform\":\"android\"}");
      if ("ui.start".equals(method)) return startUi(payload);
      if ("ui.poll".equals(method)) return poll(payload);
      if ("clipboard.copy".equals(method)) return copy(payload);
      if ("crypto.hmac".equals(method)) return hmac(payload);
      if ("qr.scanCamera".equals(method)) {
        return FiOtpJson.fail("Kamera taraması arayüz isteği olarak başlatılmalıdır.", "unsupported_ui_action");
      }
      if ("vault.defaultPath".equals(method)) return FiOtpJson.ok(FiOtpJson.pathData(defaultPath()));
      if ("vault.selectedPath".equals(method)) {
        return FiOtpJson.ok(FiOtpJson.pathData(prefs().getString(SELECTED_PATH, "")));
      }
      if ("vault.rememberPath".equals(method)) {
        String path = FiOtpJson.string(FiOtpJson.object(payload), "path");
        if (path.length() == 0) return FiOtpJson.fail("Kasa yolu geçersiz.", "invalid_path");
        prefs().edit().putString(SELECTED_PATH, path).apply();
        return FiOtpJson.ok(FiOtpJson.pathData(path));
      }
      if ("vault.lock".equals(method)) return FiOtpVaultFiles.invoke(method, payload, defaultPath());
      if (usesContent(method, payload)) return contentInvoke(method, payload);
      return FiOtpVaultFiles.invoke(method, payload == null ? "{}" : payload, defaultPath());
    } catch (IllegalArgumentException error) {
      return FiOtpJson.fail(error.getMessage(), codeFor(method, error.getMessage()));
    } catch (IllegalStateException error) {
      return FiOtpJson.fail(error.getMessage(), "locked");
    } catch (RuntimeException error) {
      return FiOtpJson.fail(error.getMessage() == null ? "Android işlemi başarısız oldu." : error.getMessage(), "native_error");
    }
  }

  private static native void nativeRegister();

  private static String startUi(String payload) {
    Map<String, Object> args = FiOtpJson.object(payload == null ? "{}" : payload);
    final String method = FiOtpJson.string(args, "method");
    String inner = FiOtpJson.string(args, "payload");
    final Map<String, Object> uiArgs = FiOtpJson.object(inner.length() == 0 ? "{}" : inner);
    final String id = UUID.randomUUID().toString();
    if ("dialog.saveVault".equals(method)) {
      finish(id, FiOtpJson.ok(FiOtpJson.pathData(defaultPath())));
      return FiOtpJson.ok("{\"id\":" + FiOtpJson.quote(id) + "}");
    }
    activity.runOnUiThread(new Runnable() {
      @Override
      public void run() {
        if ("dialog.openVault".equals(method)) startOpen(id, OPEN_VAULT, "application/json");
        else if ("dialog.openBackup".equals(method)) startOpen(id, OPEN_BACKUP, "application/json");
        else if ("dialog.saveBackup".equals(method)) startCreate(id);
        else if ("qr.scanCamera".equals(method)) startCamera(id);
        else finish(id, FiOtpJson.fail("Android üzerinde bu kullanıcı arayüzü işlemi desteklenmiyor.", "unsupported_ui_action"));
      }
    });
    return FiOtpJson.ok("{\"id\":" + FiOtpJson.quote(id) + "}");
  }

  private static String poll(String payload) {
    String id = FiOtpJson.string(FiOtpJson.object(payload == null ? "{}" : payload), "id");
    String finished = results.remove(id);
    if (finished == null) return FiOtpJson.ok("{\"pending\":true}");
    return FiOtpJson.ok("{\"pending\":false,\"response\":" + FiOtpJson.quote(finished) + "}");
  }

  private static void startOpen(String id, int requestCode, String type) {
    requests.put(Integer.valueOf(requestCode), id);
    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
    intent.addCategory(Intent.CATEGORY_OPENABLE);
    intent.setType(type);
    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
    activity.startActivityForResult(intent, requestCode);
  }

  private static void startCreate(String id) {
    requests.put(Integer.valueOf(SAVE_BACKUP), id);
    Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
    intent.addCategory(Intent.CATEGORY_OPENABLE);
    intent.setType("application/json");
    intent.putExtra(Intent.EXTRA_TITLE, "fiotp-backup.json");
    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
    activity.startActivityForResult(intent, SAVE_BACKUP);
  }

  private static void startCamera(String id) {
    if (activity.checkSelfPermission(android.Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
      pendingCameraId = id;
      activity.requestPermissions(new String[] { android.Manifest.permission.CAMERA }, CAMERA_PERMISSION);
      return;
    }
    openScanner(id);
  }

  private static void openScanner(final String id) {
    if (scanner != null) scanner.close(false);
    scanner = new Scanner(activity, id);
    scanner.show();
  }

  private static String copy(String payload) {
    String text = FiOtpJson.string(FiOtpJson.object(payload == null ? "{}" : payload), "text");
    ClipboardManager clipboard = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
    if (clipboard == null) return FiOtpJson.fail("Pano açılamadı.", "clipboard_failed");
    clipboard.setPrimaryClip(ClipData.newPlainText("FiOTP", text));
    return FiOtpJson.ok("{}");
  }

  private static String hmac(String payload) {
    Map<String, Object> args = FiOtpJson.object(payload == null ? "{}" : payload);
    byte[] key = FiOtpCrypto.base64Decode(FiOtpJson.string(args, "key"));
    byte[] message = FiOtpCrypto.base64Decode(FiOtpJson.string(args, "message"));
    try {
      String algorithm = FiOtpJson.string(args, "algorithm");
      if (algorithm.length() == 0) algorithm = "SHA1";
      byte[] digest = FiOtpCrypto.hmac(algorithm, key, message);
      return FiOtpJson.ok("{\"digest\":" + FiOtpJson.quote(FiOtpCrypto.base64(digest)) + "}");
    } finally {
      FiOtpCrypto.wipe(key);
      FiOtpCrypto.wipe(message);
    }
  }

  private static boolean usesContent(String method, String payload) {
    if (!method.startsWith("vault.") || payload == null) return false;
    try {
      Map<String, Object> args = FiOtpJson.object(payload);
      return startsContent(args, "path") || startsContent(args, "preferredPath")
        || startsContent(args, "source") || startsContent(args, "destination");
    } catch (RuntimeException error) {
      return false;
    }
  }

  private static boolean startsContent(Map<String, Object> args, String key) {
    Object value = args.get(key);
    return value instanceof String && ((String) value).startsWith("content:");
  }

  private static String contentInvoke(String method, String payload) {
    Map<String, Object> args = FiOtpJson.object(payload);
    if ("vault.status".equals(method) || "vault.discover".equals(method)) {
      String preferred = FiOtpJson.string(args, "vault.discover".equals(method) ? "preferredPath" : "path");
      if (preferred.startsWith("content:") && exists(preferred)) {
        return FiOtpJson.ok("{\"exists\":true,\"path\":" + FiOtpJson.quote(preferred) + "}");
      }
      if ("vault.discover".equals(method)) return FiOtpVaultFiles.invoke(method, "{\"preferredPath\":\"\"}", defaultPath());
      return FiOtpJson.ok("{\"exists\":false,\"path\":" + FiOtpJson.quote(preferred) + "}");
    }
    if ("vault.open".equals(method) || "vault.readExternal".equals(method)) {
      String path = FiOtpJson.string(args, "path");
      boolean keep = "vault.open".equals(method);
      try {
        return FiOtpJson.ok(FiOtpVaultFiles.openBytes(readUri(path), FiOtpJson.string(args, "password"), keep, path, false));
      } catch (RuntimeException original) {
        if (!keep) throw original;
        File bak = contentBackup(path);
        if (!bak.isFile()) throw original;
        String recovered = FiOtpVaultFiles.openBytes(readFile(bak), FiOtpJson.string(args, "password"), true, path, true);
        return FiOtpJson.ok(recovered);
      }
    }
    if ("vault.save".equals(method)) {
      String path = FiOtpJson.string(args, "path");
      byte[] vaultKey = FiOtpVaultFiles.currentKey();
      try {
        if (vaultKey.length == 0) throw new IllegalStateException("Kasa kilitli.");
        byte[] previous = readUri(path);
        writeBackup(path, previous);
        byte[] updated = FiOtpVaultFiles.sealPlaintext(FiOtpJson.string(args, "plaintext"), vaultKey, previous);
        writeUri(path, updated);
        return FiOtpJson.ok("{}");
      } finally {
        FiOtpCrypto.wipe(vaultKey);
      }
    }
    if ("vault.create".equals(method) || "vault.changePassword".equals(method)) {
      throw new IllegalArgumentException("Yeni kasa ve parola değişimi uygulama alanında tutulur.");
    }
    if ("vault.export".equals(method)) {
      String source = FiOtpJson.string(args, "source");
      String destination = FiOtpJson.string(args, "destination");
      byte[] bytes = source.startsWith("content:") ? readUri(source) : readFile(new File(source));
      if (destination.startsWith("content:")) writeUri(destination, bytes);
      else FiOtpVaultFiles.writeAtomic(new File(destination), bytes, false);
      return FiOtpJson.ok(FiOtpJson.pathData(destination));
    }
    return FiOtpVaultFiles.invoke(method, payload, defaultPath());
  }

  private static boolean exists(String uri) {
    try {
      InputStream input = activity.getContentResolver().openInputStream(Uri.parse(uri));
      if (input == null) return false;
      input.close();
      return true;
    } catch (Exception error) {
      return false;
    }
  }

  private static byte[] readUri(String uri) {
    try (InputStream input = activity.getContentResolver().openInputStream(Uri.parse(uri))) {
      if (input == null) throw new IllegalArgumentException("Kasa dosyası açılamadı: " + uri);
      return readLimited(input, uri);
    } catch (IllegalArgumentException error) {
      throw error;
    } catch (Exception error) {
      throw new IllegalArgumentException("Kasa dosyası açılamadı: " + uri);
    }
  }

  private static byte[] readFile(File file) {
    try (InputStream input = new java.io.FileInputStream(file)) {
      return readLimited(input, file.getPath());
    } catch (Exception error) {
      throw new IllegalArgumentException("Kasa dosyası açılamadı: " + file.getPath());
    }
  }

  private static byte[] readLimited(InputStream input, String label) throws java.io.IOException {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    byte[] buffer = new byte[8192];
    int total = 0;
    while (true) {
      int read = input.read(buffer);
      if (read < 0) break;
      total += read;
      if (total > FiOtpCrypto.MAX_FILE_BYTES) throw new IllegalArgumentException("Kasa dosyası geçersiz boyutta: " + label);
      out.write(buffer, 0, read);
    }
    return out.toByteArray();
  }

  private static void writeUri(String uri, byte[] bytes) {
    try (OutputStream output = activity.getContentResolver().openOutputStream(Uri.parse(uri))) {
      if (output == null) throw new IllegalArgumentException("Kasa dosyası yazılamadı.");
      output.write(bytes);
    } catch (IllegalArgumentException error) {
      throw error;
    } catch (Exception error) {
      throw new IllegalArgumentException("Kasa dosyası yazılamadı.");
    }
  }

  private static void writeBackup(String uri, byte[] previous) {
    File bak = contentBackup(uri);
    File parent = bak.getParentFile();
    if (parent != null) parent.mkdirs();
    try (FileOutputStream output = new FileOutputStream(bak)) {
      output.write(previous);
      output.getFD().sync();
    } catch (Exception error) {
      throw new IllegalArgumentException("Önceki kasa yedeği yazılamadı.");
    }
  }

  private static File contentBackup(String uri) {
    return new File(new File(activity.getFilesDir(), "backups"), Integer.toHexString(uri.hashCode()) + ".bak");
  }

  private static String defaultPath() {
    return new File(activity.getFilesDir(), "kasa.json").getAbsolutePath();
  }

  private static SharedPreferences prefs() {
    return activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
  }

  private static void finish(String id, String response) {
    results.put(id, response);
  }

  private static String codeFor(String method, String message) {
    if (message != null && message.indexOf("en az 8") >= 0) return "weak_password";
    if (message != null && message.indexOf("zaten bir kasa") >= 0) return "vault_exists";
    if ("vault.open".equals(method) || "vault.readExternal".equals(method)) return "open_failed";
    if (message != null && message.indexOf("Geçersiz istek") >= 0) return "invalid_request";
    return "native_error";
  }

  private static final class Scanner {
    private final Activity host;
    private final String id;
    private final AtomicBoolean delivered = new AtomicBoolean(false);
    private Dialog dialog;
    private CameraDevice camera;
    private CameraCaptureSession session;
    private ImageReader reader;
    private android.view.Surface previewSurface;
    private HandlerThread thread;
    private Handler handler;

    Scanner(Activity host, String id) {
      this.host = host;
      this.id = id;
    }

    void show() {
      thread = new HandlerThread("fiotp-qr");
      thread.start();
      handler = new Handler(thread.getLooper());
      FrameLayout root = new FrameLayout(host);
      final TextureView preview = new TextureView(host);
      root.addView(preview, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
      Button cancel = new Button(host);
      cancel.setText("İptal");
      FrameLayout.LayoutParams cancelParams = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
      cancelParams.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
      cancelParams.topMargin = 48;
      root.addView(cancel, cancelParams);
      cancel.setOnClickListener(new View.OnClickListener() {
        @Override
        public void onClick(View view) {
          close(true);
        }
      });
      dialog = new Dialog(host, android.R.style.Theme_Black_NoTitleBar_Fullscreen);
      dialog.setContentView(root);
      dialog.setCancelable(true);
      dialog.setOnCancelListener(new android.content.DialogInterface.OnCancelListener() {
        @Override
        public void onCancel(android.content.DialogInterface dialogInterface) {
          close(true);
        }
      });
      preview.setSurfaceTextureListener(new TextureView.SurfaceTextureListener() {
        @Override
        public void onSurfaceTextureAvailable(SurfaceTexture surface, int width, int height) {
          openCamera(surface);
        }
        @Override
        public void onSurfaceTextureSizeChanged(SurfaceTexture surface, int width, int height) {}
        @Override
        public boolean onSurfaceTextureDestroyed(SurfaceTexture surface) { return true; }
        @Override
        public void onSurfaceTextureUpdated(SurfaceTexture surface) {}
      });
      dialog.show();
    }

    void close(boolean cancelled) {
      if (session != null) {
        session.close();
        session = null;
      }
      if (camera != null) {
        camera.close();
        camera = null;
      }
      if (reader != null) {
        reader.close();
        reader = null;
      }
      if (previewSurface != null) {
        previewSurface.release();
        previewSurface = null;
      }
      if (thread != null) {
        thread.quitSafely();
        thread = null;
      }
      if (dialog != null) {
        dialog.setOnCancelListener(null);
        dialog.dismiss();
        dialog = null;
      }
      if (scanner == this) scanner = null;
      if (cancelled && delivered.compareAndSet(false, true)) {
        finish(id, FiOtpJson.fail("QR tarama iptal edildi.", "cancelled"));
      }
    }

    private void openCamera(SurfaceTexture texture) {
      try {
        CameraManager manager = (CameraManager) host.getSystemService(Context.CAMERA_SERVICE);
        String cameraId = backCamera(manager);
        CameraCharacteristics characteristics = manager.getCameraCharacteristics(cameraId);
        Size size = previewSize(characteristics);
        texture.setDefaultBufferSize(size.getWidth(), size.getHeight());
        reader = ImageReader.newInstance(size.getWidth(), size.getHeight(), ImageFormat.YUV_420_888, 2);
        reader.setOnImageAvailableListener(new ImageReader.OnImageAvailableListener() {
          @Override
          public void onImageAvailable(ImageReader imageReader) {
            decode(imageReader);
          }
        }, handler);
        manager.openCamera(cameraId, new CameraDevice.StateCallback() {
          @Override
          public void onOpened(CameraDevice opened) {
            camera = opened;
            startSession(texture);
          }
          @Override
          public void onDisconnected(CameraDevice opened) {
            opened.close();
          }
          @Override
          public void onError(CameraDevice opened, int error) {
            opened.close();
            host.runOnUiThread(new Runnable() {
              @Override
              public void run() {
                fail("Kamera açılamadı.");
              }
            });
          }
        }, handler);
      } catch (SecurityException error) {
        fail("Kamera izni verilmedi.");
      } catch (Exception error) {
        fail(error.getMessage() == null ? "Kamera açılamadı." : error.getMessage());
      }
    }

    private void startSession(SurfaceTexture texture) {
      try {
        previewSurface = new android.view.Surface(texture);
        camera.createCaptureSession(Arrays.asList(previewSurface, reader.getSurface()), new CameraCaptureSession.StateCallback() {
          @Override
          public void onConfigured(CameraCaptureSession configured) {
            session = configured;
            try {
              CaptureRequest.Builder request = camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
              request.addTarget(previewSurface);
              request.addTarget(reader.getSurface());
              configured.setRepeatingRequest(request.build(), null, handler);
            } catch (CameraAccessException error) {
              fail("Kamera açılamadı.");
            }
          }
          @Override
          public void onConfigureFailed(CameraCaptureSession configured) {
            fail("Kamera açılamadı.");
          }
        }, handler);
      } catch (CameraAccessException error) {
        fail("Kamera açılamadı.");
      }
    }

    private void decode(ImageReader imageReader) {
      Image image = imageReader.acquireLatestImage();
      if (image == null || delivered.get()) {
        if (image != null) image.close();
        return;
      }
      try {
        byte[] nv21 = yuvToNv21(image);
        PlanarYUVLuminanceSource source = new PlanarYUVLuminanceSource(
          nv21, image.getWidth(), image.getHeight(), 0, 0, image.getWidth(), image.getHeight(), false);
        Result result = new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(source)));
        final String value = result.getText();
        if (value != null && delivered.compareAndSet(false, true)) {
          host.runOnUiThread(new Runnable() {
            @Override
            public void run() {
              finish(id, FiOtpJson.ok("{\"value\":" + FiOtpJson.quote(value) + "}"));
              close(false);
            }
          });
        }
      } catch (Exception ignored) {
        // Frames without a readable QR code are normal while the camera is open.
      } finally {
        image.close();
      }
    }

    private void fail(final String message) {
      if (!delivered.compareAndSet(false, true)) return;
      host.runOnUiThread(new Runnable() {
        @Override
        public void run() {
          String code = message.indexOf("izin") >= 0 ? "camera_permission_denied" : "camera_unavailable";
          finish(id, FiOtpJson.fail(message, code));
          close(false);
        }
      });
    }

    private static String backCamera(CameraManager manager) throws CameraAccessException {
      for (String id : manager.getCameraIdList()) {
        Integer facing = manager.getCameraCharacteristics(id).get(CameraCharacteristics.LENS_FACING);
        if (facing != null && facing.intValue() == CameraCharacteristics.LENS_FACING_BACK) return id;
      }
      String[] ids = manager.getCameraIdList();
      if (ids.length == 0) throw new IllegalArgumentException("Kamera bulunamadı.");
      return ids[0];
    }

    private static Size previewSize(CameraCharacteristics characteristics) {
      android.hardware.camera2.params.StreamConfigurationMap map =
        characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
      Size[] sizes = map == null ? null : map.getOutputSizes(ImageFormat.YUV_420_888);
      if (sizes == null || sizes.length == 0) return new Size(640, 480);
      Size chosen = null;
      for (Size size : sizes) {
        if (size.getWidth() <= 1280 && size.getHeight() <= 720) {
          if (chosen == null || size.getWidth() * size.getHeight() > chosen.getWidth() * chosen.getHeight()) chosen = size;
        }
      }
      return chosen == null ? sizes[0] : chosen;
    }

    private static byte[] yuvToNv21(Image image) {
      int width = image.getWidth();
      int height = image.getHeight();
      byte[] nv21 = new byte[width * height * 3 / 2];
      Image.Plane y = image.getPlanes()[0];
      Image.Plane u = image.getPlanes()[1];
      Image.Plane v = image.getPlanes()[2];
      copyPlane(y.getBuffer(), y.getRowStride(), y.getPixelStride(), width, height, nv21, 0, 1);
      copyPlane(v.getBuffer(), v.getRowStride(), v.getPixelStride(), width / 2, height / 2, nv21, width * height, 2);
      copyPlane(u.getBuffer(), u.getRowStride(), u.getPixelStride(), width / 2, height / 2, nv21, width * height + 1, 2);
      return nv21;
    }

    private static void copyPlane(ByteBuffer buffer, int rowStride, int pixelStride, int width, int height, byte[] out, int offset, int outStride) {
      int row = 0;
      for (int y = 0; y < height; y++) {
        int rowStart = y * rowStride;
        for (int x = 0; x < width; x++) {
          out[offset + row] = buffer.get(rowStart + x * pixelStride);
          row += outStride;
        }
      }
    }
  }
}

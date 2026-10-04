# `@geastack/linux` SailfishOS — kalan issue'lar

Bu dosya `GEASTACK_SAILFISH_TODO.md` içindeki işlerin **`@geastack/linux` deposunda** uygulanması içindir. FiOTP arayüzü, kasa akışı ve QR burada yoktur.

Kaynak gözlem: SailfishOS 5.1.0.11, aarch64, Redmi Note 8. RPM kuruldu, uygulama açıldı, dokunma ve kasa oluşturma çalıştı. Maliit'e bağlanan geçici kod klavyeyi açtı ve pencere küçüldü. Karakter girişi, Backspace ve parola alanı uçtan uca doğrulanmadı.

Geçici örnek `patches/geastack-sailfish-build.mjs` ve `native/sailfish_keyboard.cpp` içindedir. Bu yama paketin çözümü değildir: `fiotpHostInvoke`, `fiotp_host.h`, `FIOTP_SAILFISH`, OpenSSL ve vendor kopyası bu repoya taşınmaz. Klavye köprüsü target'ın kendi kaynaklarında durmalı; uygulama native dosyası olarak eklenmemeli.

Hedef ağaç (`@geastack/linux` 0.1.1):

- `targets/sailfish-os/main/sailfish_main.cpp`
- `targets/sailfish-os/main/sailfish_display.cpp`
- `targets/sailfish-os/prepare.mjs`
- `targets/sailfish-os/CMakeLists.txt`
- `targets/sailfish-os/build-sailfish-os.ps1`
- target README

Önerilen sıra: 3 → 1 → 2 → 6 → 4 → 5 → 7. UTF-8 düzeltmesi klavye köprüsünün üzerine oturur. Build kurtarma, npm'den derleme denemelerini boşa harcatmaz.

## P0 — telefonda kullanımı engelleyenler

### 1. Sailfish sistem klavyesi

**Sorun.** Target `SDL_StartTextInput()` ve Gea sanal klavyesini kullanıyor. Fiziksel cihazda input'a dokunmak sistem klavyesini açmadı; Gea klavyesi de kullanılamadı.

**Geçici örnekte olan.** `native/sailfish_keyboard.cpp` Maliit context'ine bağlanıyor, `handle-commit-string` ile metni ve `Qt::Key_Backspace` (`0x01000003`) ile silmeyi iletiyor. Odak varken `maliit_input_method_show`, kalkınca `hide` çağrılıyor. `type=password` için `hiddenText` ve `predictionEnabled=false` gönderiliyor. Ana döngüde `g_main_context_iteration` pompalanıyor.

**Eksik kalan.** `keyEvent` yorumunda Return/Enter var, kod yalnız Backspace işliyor. `Qt::Key_Return` (`0x01000004`) ve `Qt::Key_Enter` (`0x01000005`) Gea input olayına gitmiyor. Klavye açılınca küçülen pencerede odaklı alanın görünür kaldığı doğrulanmadı. `maliit-glib` Harbour için uygun mu, yoksa izinli bir DBus/GIO yolu mı gerekir, kontrol edilmedi.

**Pakette yapılacak.**

- Köprüyü `targets/sailfish-os/main/` altına al. `sailfish_main.cpp` odak değişince göster/gizle, commit metnini ve Backspace/Enter'ı mevcut input yardımcılarına bağlasın.
- `type=password` bilgisini Maliit widget state'ine ilet.
- Klavye yüzünden pencere daralınca odaklı alanı görünür tut.
- `CMakeLists.txt` ve RPM `BuildRequires` içine `maliit-glib` eklemeden önce Harbour uygunluğunu yaz. Uygun değilse seçilen DBus yolunu aynı yerde belgele.
- Gea sanal klavye bayrağını Sailfish varsayılanı yapma; sistem klavyesi birincil giriş olsun. Emülatör ve masaüstü SDL girişi aynı kalsın.

**Kabul.** aarch64 cihazda metin ve parola alanları Sailfish klavyesini açar. Türkçe yazma, silme, Enter ve odak kalkınca kapanma çalışır. Klavye formu kapatmaz. Emülatör ve masaüstü SDL girişi bozulmaz.

### 2. Dokunma koordinatları ve DPR

**Sorun.** `gea.sailfish.devicePixelRatio=2` iken düğme dokunuşları yanlış hedefe gitti. `SDL_WINDOW_ALLOW_HIGHDPI` kaldırılınca aynı cihazda düğmeler çalıştı. Bayrağı silmek dönüşümü tanımlamaz.

**Geçici örnekte olan.** `sailfish_display.cpp` pencere bayrağından `SDL_WINDOW_ALLOW_HIGHDPI` çıkarılmış. Yorum: canvas zaten yapılandırılmış DPR kullanıyor; high-DPI bayrağı, logical size açıkken parmak koordinatını ikinci kez ölçekliyor.

**Pakette yapılacak.**

- SDL pencere koordinatı, drawable piksel ve Gea CSS pikseli dönüşümünü tek yerde tanımla (`sailfish_display.cpp` ve dokunma/fare olayının okunduğu kod).
- DPR 1 ve 2, yeniden boyutlandırma ve klavye kaynaklı pencere değişiminde aynı dönüşümü kullan.
- Parmak, fare ve tekerlek olaylarını bu dönüşümden geçir.

**Kabul.** DPR 1 ve 2'de köşelerdeki düğmeler, input'lar, kaydırma ve sürükleme görünen yerlerinden çalışır. Klavye açılıp kapanınca hit test kaymaz.

### 3. Platform metin girişinde tam UTF-8

**Sorun.** 0.1.1 fiziksel klavye yolu yalnız ASCII basılabilir baytları alıyor ve Backspace son baytı siliyor. Çok baytlı karakter bozuluyor veya hiç girmiyor.

**Geçici örnekte olan.** `sailfish_main.cpp` içinde `append` yolu gelen UTF-8'i olduğu gibi ekliyor. Backspace, sondaki `10xxxxxx` devam baytlarını atıp ardından bir lead bayt siliyor. Bu bir kod noktası siler; grapheme kümesi silmez.

**Pakette yapılacak.**

- Geçerli UTF-8 metni input'a bütün olarak ekle. ASCII filtresini kaldır.
- Backspace en az son Unicode kod noktasını silsin. Grapheme kümesi tercih edilir; kod noktası da kabul ölçütünü karşılar.
- `input` ve klavye olay sırası Gea'nın beklediği sırada kalsın.
- Aynı yardımcıları hem fiziksel klavye hem Maliit commit yolu kullansın. İki ayrı silme mantığı bırakma.

**Kabul.** `ç, ğ, ı, İ, ö, ş, ü` girilir ve bozulmadan silinir. ASCII aynı kalır. Doğrulama fiziksel klavye ve Maliit commit yolunda yapılır.

## P1 — paketin kendi build'i

### 4. Ayrı `geastack/core` checkout'u olmadan derleme

**Sorun.** 0.1.1 hazırlığı eşleşen `geastack/core` checkout'u ve `@geastack/linux` geliştirme deposunun kendi `node_modules` dizinini varsayıyor. Uygulamanın `npm ci` kurulumundan build alınamadı.

**Geçici örnekte olan.** `prepare.mjs` core checkout'unu yalnız açık argüman varken istiyor; yoksa uygulamanın `node_modules/@geastack/*` paketlerini kullanıyor. Derleyici CLI'si de uygulama `node_modules` içinden çalışıyor. Üretilen dosyalar uygulamanın `.gea-sailfish/` dizinine yazılıyor. `build-sailfish-os.ps1` aynı dizini okuyor.

**Pakette yapılacak.**

- Varsayılan çözüm: uygulamanın kilitli `@geastack/*` paketleri ve manifesti.
- Kaynak checkout'u isteğe bağlı geliştirme yolu olarak kalsın. Sürüm uyuşmazlığında eksik veya uyuşmayan paketi hata metninde söyle.
- Çıktı yolu uygulama deposunda öngörülebilir bir build dizini olsun.

**Kabul.** Temiz uygulama checkout'unda `npm ci` ve belgelenmiş Sailfish komutu, ikinci kaynak checkout'u veya `node_modules` yaması olmadan aarch64 RPM üretir. Checkout seçeneği de çalışır.

### 5. Uygulamaya ait yerel kaynaklar ve hedef bağımlılıkları

**Sorun.** Target, uygulamanın Sailfish C/C++ dosyalarını, header'larını, include dizinlerini ve sistem kütüphanelerini belgelenmiş bir yolla CMake/RPM build'e almıyor. FiOTP bunu `prepare.mjs` ve `CMakeLists.txt` yamasıyla yaptı.

**Geçici örnekte olan ve taşınmayacak olan.** Sabit dosya listesi: `fiotp_host_linux.cpp`, `fiotp_host.h`, `sailfish_keyboard.cpp`, `native/vendor`. CMake'e `OpenSSL` ve `maliit-glib`. RPM'e `pkgconfig(openssl)` ve `pkgconfig(maliit-glib)`. `FIOTP_SAILFISH` define'ı.

**Pakette yapılacak.**

- Sailfish'e özel `nativeSources`, include path ve pkg-config/CMake link bağımlılıkları için açık yapılandırma veya hook.
- Yalnız bu target'a ait dosyalar girsin. Masaüstü, Apple ve Windows kaynakları otomatik eklenmesin.
- Uygulama header'ları ve gerekli vendor dosyaları staged projeye kopyalansın.
- Ek bağımlılık hem derleme link'ine hem RPM metadata'sına yansısın.
- Klavye köprüsü bu mekanizmanın örneği olmasın; o target'ın kendi kodudur. Örnek uygulama `native/host.cpp` ve header'ını bildirerek, paket dosyası düzenlemeden RPM alabilsin.

**Kabul.** Örnek uygulama kendi native dosyasını ve OpenSSL gibi bir bağımlılığı manifestten geçirir. Build ve runtime paket metadata'sı bunu gösterir.

### 6. Kesilen SDK derlemesinden kurtarma

**Sorun.** Docker/SDK kesilince staged ağaçta sıfır baytlık sekiz `.o` kaldı. Sonraki `sfdk build` bunları geçerli sayıp yüzlerce `undefined reference` verdi. Dosyalar silinince bağlama geçti.

**Pakette yapılacak.**

- Yeni build öncesi sıfır baytlık veya bozuk nesneleri bul ve yeniden ürettir.
- CMake build dizinini temizleyen belgelenmiş bir `clean` seçeneği ekle.
- Başarısız komutun exit code'unu ve son anlamlı hatasını üst betiğe taşı.

**Kabul.** Derleme sırasında SDK motoru kapatılıp açılınca aynı build komutu elle nesne silmeden biter.

### 7. Target belgeleri ve aarch64 cihaz doğrulaması

**Sorun.** 0.1.1 README'si i486 emülatör denemesini anlatıyor ve fiziksel cihazın test edilmediğini söylüyor. Betik `i486`, `armv7hl`, `aarch64` kabul ediyor. FiOTP aarch64 cihazda açıldı; klavye, UTF-8 ve Harbour yayını tam sınanmadı.

**Pakette yapılacak.**

- Desteklenen mimariler, SDK target, npm paketinden build komutu, RPM yolu, cihaz kurulumu ve bilinen sınırlar README'de güncellensin.
- En az bir aarch64 cihaz için kısa manuel smoke listesi ve sonuç kaydı eklensin: açılış, dokunma, DPR 2, metin, parola, Türkçe silme, Enter, klavye kapanınca hit test, yeniden boyutlandırma.
- Yayın hedefleniyorsa RPM üzerinde `sfdk check` ve kullanılan API'ler için Harbour kontrolü çalışsın.

**Kabul.** Yeni katkıcı README adımlarıyla aarch64 RPM üretip cihaza kurabilir. Giriş, dokunma, DPR, UTF-8, yeniden boyutlandırma ve paket kontrolünün sonucu belgede görünür.

## Bu pakette çözülmeyecek bağımlılıklar

FiOTP denemesinde görüldü. `@geastack/linux` içinde kalıcı yama yapma. Linux target katkısında takip notu veya entegrasyon testi olarak bırak:

- **`@geastack/engine`: runtime TTF glif atlası.** Gömülü Open Sans Türkçe glifleri içeriyor; eski atlas ASCII ve derece işaretiyle sınırlıydı, ekranda `?` çıktı. Geçici atlas genişletmesi `rasterized_font.cpp` içinde Latin-1, Türkçe harfler ve bir simge listesini sabit dizilerle ekliyor. Genel çözüm metindeki glifleri seçmeli ve eksik glifte fallback vermeli. Bazı simgeler hâlâ `?`. FiOTP yamasındaki sabit kod noktası listesini linux paketine kopyalama.
- **`@geastack/compiler` / codegen: yerel global bağlama.** `declare function fiotpHostInvoke(...)` üretilen C++'ta `throwReferenceError` oldu; `typeof` da false döndü. Geçici yama üretilmiş `index.cpp` üzerinde iki çağrıyı `fiotpHostInvoke` ile değiştiriyor, availability kontrolünü `return true` yapıyor ve `fiotp_host.h` ekliyor. Resmî bağlama mekanizması compiler/codegen tarafında olmalı. Issue 5'teki native kaynak kancası bu hatayı kapatmaz.

## Kapsam dışı

FiOTP'nin dar ekran düğme yerleşimi, kasa dosyası seçme akışı ve QR tarayıcı bu listeye girmez. Bunlar ancak Sailfish platform API'sinde somut bir eksik kanıtlanırsa ayrı issue olur.

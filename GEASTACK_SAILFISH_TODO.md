# `@geastack/linux` 0.1.1 — SailfishOS hedefinde yarım kalan işler

Bu liste **paketin SailfishOS target'ında yapılacak upstream işleri** içindir. FiOTP arayüzü veya uygulama özellikleri burada görev değildir. Dayanak: 0.1.1'in yayımlanmış README ve target kodu, FiOTP için gereken geçici `patches/geastack-sailfish-build.mjs` yamaları, SailfishOS 5.1.0.11 aarch64 telefondaki deneme. Geçici yama paketin çözümü olarak aynen taşınmamalı; FiOTP'ye özel semboller ve yollar çıkarılmalı.

Durum: aarch64 RPM derlenip Redmi Note 8'de açıldı. Dokunma ve kasa oluşturma akışı çalıştı. Maliit'e bağlanan geçici kod input odağında klavyeyi çağırdı ve pencere klavye açılınca küçüldü. Gerçek karakter girişi, Backspace ve parola alanı henüz uçtan uca doğrulanmadı.

## P0 — Telefon kullanımını engelleyenler

### [ ] 1. Sailfish sistem klavyesi

- **Mevcut eksik:** Target `SDL_StartTextInput()` ve Gea'nın kendi sanal klavyesini kullanıyor. Fiziksel Sailfish cihazda input'a dokunmak sistem klavyesini açmadı; Gea klavyesi de telefon ekranında kullanılamadı.
- **Paket işi:** Sailfish'e özgü input köprüsü ekle. Input odaklanınca Maliit'i aç, odak kalkınca kapat; UTF-8 commit metnini, Backspace'i ve Enter'ı Gea input olaylarına aktar. `type=password` için gizli metin ve tahmin kapatma bilgisini ilet. Klavye açılıp pencere daralınca odaklı alan görünür kalsın. `maliit-glib` bağımlılığının Harbour dağıtımına uygunluğunu kontrol et; gerekiyorsa izin verilen DBus/GIO yolu seç.
- **Kabul:** aarch64 cihazda metin ve parola alanları Sailfish klavyesini açar; Türkçe metin yazma, silme, Enter ve odağı kaldırınca kapanma çalışır. Klavye alanı formu erişilemez kılmaz. Emulator ve masaüstü SDL girişi gerilemez.
- **Geçici örnek:** `native/sailfish_keyboard.cpp` ve `patches/geastack-sailfish-build.mjs` içindeki `sailfish_main.cpp`/CMake değişiklikleri.

### [ ] 2. Dokunma koordinatları ve DPR

- **Gözlem:** `gea.sailfish.devicePixelRatio=2` ile arayüz çizilirken düğme dokunuşları yanlış hedefe gidiyordu. `SDL_WINDOW_ALLOW_HIGHDPI` kaldırılınca aynı cihazda düğmeler çalıştı. Bu, koordinat dönüşümünün hedefte tutarsız olduğuna işaret ediyor; kalıcı çözüm yalnızca bayrağı silmek olmayabilir.
- **Paket işi:** SDL pencere koordinatı, drawable pikseli ve Gea CSS pikseli arasındaki dönüşümü tek yerde tanımla. Parmak koordinatları ile fare/tekerlek olaylarını DPR ve yeniden boyutlandırma altında sınayıp düzelt.
- **Kabul:** DPR 1 ve 2'de köşelerdeki düğmeler, input'lar, kaydırma ve sürükleme görünen yerlerinden çalışır; klavye açılıp kapanınca hit test kaymaz.
- **Geçici örnek:** `patches/geastack-sailfish-build.mjs` içindeki `sailfish_display.cpp` bayrak yaması.

### [ ] 3. Platform metin girişinde tam UTF-8

- **Mevcut eksik:** 0.1.1'in fiziksel klavye yolu yalnızca ASCII basılabilir baytları kabul ediyordu ve Backspace son baytı siliyordu. Çok baytlı karakterler girilemiyor veya bozulabiliyor.
- **Paket işi:** Input'a geçerli UTF-8 metni bütün olarak ekle; Backspace en azından son Unicode kod noktasını, tercihen son grapheme kümesini silsin. `input`/klavye olayları Gea'nın beklediği sırada gönderilsin.
- **Kabul:** `ç, ğ, ı, İ, ö, ş, ü` girilip bozulmadan silinir; ASCII giriş aynı davranır. Bu doğrulama hem fiziksel klavyede hem Maliit commit yolunda yapılır.
- **Geçici örnek:** `patches/geastack-sailfish-build.mjs` içindeki `sailfish_main.cpp` metin/Backspace yaması.

## P1 — Paket olarak kullanılabilir build

### [ ] 4. Ayrı `geastack/core` checkout'u olmadan derleme

- **Mevcut eksik:** Yayımlanmış 0.1.1 hazırlama adımı eşleşen `geastack/core` checkout'u ve `@geastack/linux` geliştirme deposunun kendi `node_modules` dizinini varsayıyor. Bir uygulamanın normal `npm ci` kurulumundan doğrudan build etmek mümkün olmadı.
- **Paket işi:** Varsayılan olarak uygulamanın kilitli `@geastack/*` npm paketlerini ve manifestini çöz. Kaynak checkout'unu açıkça seçilen isteğe bağlı geliştirme yolu olarak koru. Üretilen dosyaları uygulama deposunda öngörülebilir bir build dizinine koy; hata iletilerinde eksik/uyuşmayan paketi belirt.
- **Kabul:** Temiz bir uygulama checkout'unda `npm ci` + belgelenmiş Sailfish build komutu, ikinci bir kaynak checkout'u veya `node_modules` yaması istemeden aarch64 RPM üretir. Kaynak checkout'u seçeneği de çalışır.
- **Geçici örnek:** `patches/geastack-sailfish-build.mjs` içindeki `prepare.mjs` ve `build-sailfish-os.ps1` yol yamaları.

### [ ] 5. Uygulamaya ait yerel kaynaklar ve hedef bağımlılıkları

- **Mevcut eksik:** Target aşaması uygulamanın Sailfish'e ait C/C++ dosyalarını, header'larını, include dizinlerini ve gerekli sistem kütüphanelerini belgelenmiş bir mekanizmayla CMake/RPM build'e almıyor. FiOTP'de bunlar `prepare.mjs` ve `CMakeLists.txt` yamasıyla eklendi.
- **Paket işi:** Sailfish'e özel `nativeSources`, include path ve pkg-config/CMake link bağımlılıkları için açık bir yapılandırma alanı veya hook sağla. Yalnızca bu target'a uygun dosyaları al; masaüstü/Apple/Windows kaynaklarını otomatik ekleme. Uygulama header'larını ve gereken vendor dosyalarını staged projeye güvenli kopyala.
- **Kabul:** Örnek bir uygulama `native/host.cpp` ve header'ını bildirerek paket dosyalarını düzenlemeden RPM üretir; OpenSSL gibi ek bağımlılık build ve runtime paket metadata'sına doğru yansır.
- **Geçici örnek:** `patches/geastack-sailfish-build.mjs` içindeki `app_native` kopyalama, CMake ve RPM `BuildRequires` yamaları.

### [ ] 6. Kesilen SDK derlemesinden kurtarma

- **Gözlem:** Docker/SDK işlemi kesildikten sonra staged ağaçta sıfır baytlık sekiz `.o` dosyası kaldı. Sonraki `sfdk build` bu dosyaları geçerli sayıp yüzlerce `undefined reference` verdi. Bunlar silinip yeniden derlenince bağlama geçti.
- **Paket işi:** Yeni build öncesi bozuk/sıfır baytlık nesneleri tespit edip güvenle yeniden üret; gerekiyorsa CMake build dizinini temizleyen belgelenmiş bir `clean` seçeneği ekle. Başarısız komutun exit code'unu ve son anlamlı hatasını üst betiğe taşı.
- **Kabul:** Derleme sırasında SDK motoru kapatılıp tekrar açıldığında aynı build komutu elle nesne silmeden tamamlanır.

### [ ] 7. Target belgeleri ve aarch64 cihaz doğrulaması

- **Mevcut durum:** 0.1.1 README'si i486 emülatör denemesini anlatıyor ve fiziksel cihazın test edilmediğini söylüyor; build betiği `i486`, `armv7hl`, `aarch64` kabul ediyor. Artık FiOTP aarch64 cihazda açıldı, fakat klavye/UTF-8 davranışı ve Harbour yayını henüz tam sınanmadı.
- **Paket işi:** Desteklenen mimarileri, SDK target gereksinimlerini, npm paketinden build komutunu, RPM konumunu, cihaz kurulumunu ve bilinen sınırlamaları güncelle. En az bir aarch64 fiziksel cihaz için küçük bir manuel smoke test listesi ve sonuç kaydı ekle. Yayın hedefleniyorsa RPM üzerinde `sfdk check` ve kullanılan API'ler için Harbour kontrolü çalıştır.
- **Kabul:** Yeni katkıcı temiz makinede README adımlarıyla aarch64 RPM üretip cihaza kurabilir; giriş, dokunma, DPR, UTF-8, yeniden boyutlandırma ve paket kontrolünün sonucu belgede görünür.

## Başka pakete açılacak bağımlı işler

Bu iki eksik FiOTP denemesinde görüldü; çözümün sahibi doğrudan `@geastack/linux` olmayabilir. Linux target katkısında takip bağlantısı veya entegrasyon testi olarak tutulmaları yeterli:

- **`@geastack/engine`: Runtime TTF glif atlası.** Gömülü Open Sans Türkçe glifleri içerdiği hâlde eski atlas ASCII ve derece işaretiyle sınırlıydı; ekranda `?` çıkıyordu. Geçici atlas genişletmesiyle `Tüm Kodlar` içindeki `ü` cihazda doğru çizildi. Metinde gereken glifleri seçen genel çözüm ve eksik glif fallback'i gerekli. Bazı simgeler hâlâ `?` görünüyor.
- **`@geastack/compiler`/codegen: Yerel global bağlama.** `declare function fiotpHostInvoke(...)` üretilen C++'ta `throwReferenceError` oldu; `typeof` da false döndü. Uygulama sembolünü bildirip çağırmak için resmî bir bağlama mekanizması gerekli. FiOTP'nin üretilmiş `index.cpp` üzerinde metin değiştiren geçici yaması bu pakette kalıcı çözüm olmamalı.

## Kapsam notu

FiOTP'nin dar ekrandaki düğme yerleşimi, kasa dosyası seçme akışı ve QR tarayıcı özelliği bu **paket backlog'una** dahil değildir. Bunlar ancak genel Sailfish platform API'sindeki somut bir eksik kanıtlanırsa ayrı issue olmalı.

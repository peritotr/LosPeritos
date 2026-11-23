# LosPeritos yol haritası

LosPeritos'un bugünkü hâli ve bundan sonrası için iş planı.

## LosPeritos'ta bugün ne var

- Masaüstü uygulaması (macOS, kaynak koddan ve paketlenmiş), tarayıcı sürümü.
- Lider + 7 perito; görev başına git dalı ve worktree; birleştirme mühürle.
- Heyet Masası (canlı büro katı), Dosyalar (liste, pano, diff, rapor),
  Yazışmalar, Bekleyenler, Arşiv, Mesai Defteri, Ayarlar, Kurulum, komut paleti.
- Günlük bütçe, güven modu, İngilizce ve Türkçe, açık ve koyu tema.
- Yalnızca Claude Code; ajan çıktısı satır satır metin olarak.

## Eksikler ve iş planı

Boyutlar kabadır: **K** bir oturumda biter, **O** iki-üç oturum, **B** daha
uzun ve önce tasarım kararı ister. Sıra, hedef kitleye (kod bilmeyen ya da az
bilen günlük kullanıcı) en çok değeri en erken verecek şekilde.

### 16. Büro türleri: yazılım dışı işler (O, sonra B)

Büro bugün yazılım işine göre döşenmiş: roller, liderin talimatı ve ekran dili
(dal, birleştir, diff) geliştiriciye göre. Omurga ise yazılıma özel değil;
uzmanlık serbest metin ve klasörün git deposu olması şart değil. Reklam, SEO,
içerik ve video işleri için büro türü eklenir. Sonraki maddelerin (7, 9, 10,
11, 12) kapsamını değiştirebileceği için öne alındı.

Birinci adım (O), yalnızca dosya üreten işler:

- Kurulumda büro türü seçimi: Yazılım, Pazarlama, İçerik.
- Türe göre roller (SEO uzmanı, metin yazarı, reklam uzmanı, editör…) ve
  liderin talimatı.
- Türe göre ekran dili: yazılım dışı büroda "dal" ve "birleştir" yerine
  "taslak" ve "onayla"; git ayrıntıları gizli.
- Görev raporunda üretilen dosyaların listesi; Markdown ve görsel önizleme.

Birinci adım yapıldı. Git olmayan klasörde yazılım dışı bürolar taslak
klasöründe çalışır; dosyalar mühürden sonra klasöre kopyalanır. Pazarlama
ve içerik büroları gerçek Claude ile uçtan uca denendi. Eksik kalan: taslak
yalıtımı talimata dayanıyor, teknik olarak zorlanmıyor.

İkinci adım (B):

- Bağlayıcı altyapısı: yapıldı. Ayarlar'dan büroya bir MCP sunucusu (komut ya
  da adres) bağlanır; gizli değerler makinede, yalnızca kullanıcının
  okuyabildiği bir dosyada durur. Sormadan kullanılabilir diye işaretlenmeyen
  her araç çağrısı mühür bekler. Gerçek Claude ile deneme servisi üzerinde
  doğrulandı (`scripts/e2e-connector.mjs`).
- Hazır bağlayıcılar: görsel ve video üretimi, Search Console, Google Ads,
  Meta Ads. Her biri hesap ve anahtar ister; sırayla eklenecek.
- Para harcayan çağrılar için bütçe sınırı (reklam bağlayıcılarıyla birlikte).
- Video ve PDF önizleme.

Bağlayıcıların eksikleri: bir sunucunun araç listesi ekranda gösterilmiyor,
araç adları mühür isteklerinden öğreniliyor; mühürde "bundan sonra sorma"
seçeneği yok; çalışan bir perito yeni bağlayıcıyı ancak yeniden oturunca görür.

### 1. Sohbet her ekranda (O)

Sohbet, hangi ekranda olursan ol açık kalmalı.

- Sağda kalıcı sohbet paneli; Yazışmalar ekranı bu panele taşınır.
- `@Geliştirici` yazarak doğrudan bir peritoya iş verme.
- Soru ve mühür isteklerinin sohbet içinde kart olarak gelmesi (hızlı cevap).
- Dosya ve ekran görüntüsü ekleme.

### 2. "Sen yokken" özeti (K)

Uygulamayı açınca: bitenler, yarım kalanlar, seni bekleyenler. Veriler omurgada
zaten var; yalnızca son bakıştan beri olanları derleyen bir özet gerekir.

### 3. Büro katı cilası (O)

- Sana ihtiyaç duyan perito masasından kalkıp mühür masana yürür.
- İşi biten perito sevinir; mühürde kısa bir kutlama.
- Üstüne gelince ne yaptığını gösteren ipucu; yakınlaştırma.
- Peritolara ad verme.
- Yürüme kareleri olan bir karakter paketi gerekir (MetroCity, CC0).

### 4. Kararlar ve gerçek güvenlik (O)

- Ajanın önerdiği seçeneği gösterme; "bir daha sorma" kuralı; karar geçmişi.
- Riskli komutlarda onayı **teknik olarak** zorunlu kılma. Bugün yalnızca
  birleştirme zorunlu; diğerleri ajana verilen talimata bağlı.
- Önerileri toplu kabul.

### 5. Takılmayan ekip (O)

- Kullanım limiti dolunca bekleyip kendiliğinden devam.
- Uygulama yeniden açılınca yarım kalan oturumları sürdürme.
- Ajanlar çalışırken bilgisayarı uyanık tutma.
- Basit işe ucuz, zor işe büyük model.

### 6. Görev yönetimi (O)

- Elle görev ekleme ve düzenleme; öncelik; etiket.
- Bağımlılık ve dalga: önce şunlar bitsin, sonra bunlar başlasın.
- Dağıtımı duraklat / durdur.
- GitHub issue'larından içe aktarma.
- Başlamadan önce kaba maliyet tahmini.

### 7. Gerçek terminal (B)

Bugün ajan çıktısı metin akışı. Seçenekler: (a) mevcut akışı zenginleştirmek
(araç çağrıları, diff'ler, katlanabilir bloklar), ucuz ve çoğu kullanıcıya
yeter; (b) her ajana gerçek terminal sekmesi, omurgada ajan sürücüsünün
değişmesini ister. Önce (a).

### 8. İkinci ajan aracı: Codex (O)

Adaptör arayüzü hazır. Codex eklendiğinde bir araç limite takılınca diğeri
devralabilir. Sonra OpenCode ve Gemini CLI.

### 9. Kod ve Git paneli (O)

- Dosya ağacı ve dosyalarda arama.
- Son commit'ten beri değişenler.
- Tek klasörde birden çok depo (bugün yalnızca klasörün kendisi depo ise dal açılıyor).

### 10. Belgeler (B)

- Proje sayfaları ve wiki (Markdown).
- Özellik planı sayfası: plan, görevleri, kararları tek yerde.
- Diyagramlar; ajan çizer, sen onaylarsın.
- Arşivdeki dersleri bu bölüme taşıma.

### 11. Önizleme (B)

- Geliştirme sunucusunu uygulama içinde bir bölmede gösterme.
- Ekrandan bir yeri işaretleyip "burayı düzelt" deme.
- iOS simülatörü ve Android emülatörü daha sonra.

### 12. Yayın (B)

- Adım adım yayın rehberleri (web sitesi, Mac uygulaması, mağazalar).
- Deploy'un mühürle onaylanması; Vercel gibi servislere bağlayıcılar.

### 13. Telefondan erişim (B)

Telefon tarayıcısından soru cevaplama ve mühürleme; bildirimler.

### 14. Çok projeli koordinatör (O)

Tüm büroların üstünde tek sohbet. Bekleyenler ekranı bunun yarısını zaten yapıyor.

### 15. İlk kullanım (K)

Karşılama turu, sade / gelişmiş mod, "ilk işini seç" kartları.

## LosPeritos'un kendi işleri

- **İmzalama ve noterlik:** Yapıldı. `npm run package` Developer ID sertifikasıyla
  imzalıyor ve notere gönderiyor; 23 Kasım 2026'da üretilen paket Gatekeeper'dan geçti.
- **Windows paketi (O):** Bir Windows makinede derleme ve deneme.
- **GitHub'a hazırlık (K):** Ekran görüntülü README, katkı rehberi, CI.
- **Otomatik güncelleme (O).**

## Bilerek dışarıda bırakılanlar

- Tanıtım videosu üretimi: ürünün çekirdeği değil.
- Diğer uygulamaların üstünde yüzen koordinatör.
- Lisans sunucusu ve ücretli plan: LosPeritos ücretsiz ve açık kaynak.

## Tamamlananlar

- 1 (sohbet her ekranda), 2 ("Sen yokken" özeti), 5 (takılmayan ekip): yapıldı.
  5. maddede limit sonrası devam gerçek bir limitle denenemedi; yalnızca
  otomatik testle doğrulandı.
- 3 (büro katı cilası): yakınlaştırma ve gerçek yürüme kareleri hariç yapıldı.
- 4 (kararlar ve gerçek güvenlik) ve 6 (görev yönetimi): yapıldı; etiketler,
  kaba maliyet tahmini ve önerileri toplu kabul 0.2.0 ile geldi.
- 7(a) (zengin ajan çıktısı): yapıldı. Araç çağrıları katlanabilir blok olarak
  görünüyor. Gerçek terminal sekmesi (7b) yapılmadı.
- 15 (ilk kullanım): tur ve ilk iş kartları yapıldı; sade / gelişmiş mod yapılmadı.
- 16 (büro türleri): birinci adım ve ikinci adımın bağlayıcı altyapısı yapıldı.

## Önerilen sıra

Sıradaki: 16'nın ikinci adımının kalanı (video ve PDF önizleme, hazır
bağlayıcılar) → 8 (Codex)
→ 9 (kod ve Git paneli). Sonrası kullanıcı geri bildirimine göre.

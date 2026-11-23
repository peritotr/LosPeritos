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
ve içerik büroları gerçek Claude ile uçtan uca denendi. Taslak yalıtımı artık
zorlanıyor: proje klasörü peritonun dosya araçlarına salt okunur, taslaklar
proje dışında tutuluyor ve klasörde taslak dışında değişen dosyalar mühürde
gösteriliyor. Kabuk komutları bu korumanın dışında; bu bir kum havuzu değil.

İkinci adım (B):

- Bağlayıcı altyapısı: yapıldı. Ayarlar'dan büroya bir MCP sunucusu (komut ya
  da adres) bağlanır; gizli değerler makinede, yalnızca kullanıcının
  okuyabildiği bir dosyada durur. Sormadan kullanılabilir diye işaretlenmeyen
  her araç çağrısı mühür bekler. Gerçek Claude ile deneme servisi üzerinde
  doğrulandı (`scripts/e2e-connector.mjs`).
- Hazır bağlayıcılar: görsel ve video üretimi için Replicate şablonu eklendi
  (resmi `replicate-mcp` paketi; gerçek hesapla deneme
  `scripts/e2e-replicate.mjs`). Gerçek hesapla denendi: bağlantı, araçlar ve
  mühür çalıştı; hesapta kredi olmadığı için görsel üretimi ve dosyanın
  taslağa inmesi doğrulanamadı. Sırada Search Console,
  Google Ads, Meta Ads; her biri hesap ve anahtar ister. fal yalnızca OAuth
  ile bağlandığı için önce OAuth desteği gerekir.
- Para harcayan çağrılar için bütçe sınırı (reklam bağlayıcılarıyla birlikte).
- Video, ses ve PDF önizleme: yapıldı (256 MB'a kadar).

Araç listesi Ayarlar'da görünüyor ve işaretlenebiliyor; mühürde "bundan sonra
sorma" seçeneği var; bağlayıcı değişikliği ekibe hemen ulaşıyor. Tarayıcıdan
giriş (OAuth) isteyen sunucular da bağlanıyor; akış sahte bir sağlayıcıyla
test edildi, gerçek bir hesapla henüz denenmedi. fal şablonu eklendi.

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

Zengin ajan çıktısı (a): yapıldı. Kullanıcının kendi terminali: yapıldı.
"Terminal" ekranı büro klasöründe gerçek kabuklar açar (sekmeli); kabuklar
pencereye değil çekirdeğe aittir, ekrandan çıkınca da sürer. Her ajana ayrı
terminal sekmesi yapılmadı; ajan çıktısı hâlâ katlanabilir bloklarla görünüyor.

### 8. İkinci ajan aracı: Codex (O)

Yapıldı, deneysel. Büro bazında seçilir (Ayarlar → Ajan aracı). Codex durup
sormadığı için hiçbir komut mühür beklemez; Codex heyetine bağlayıcı
verilmez. Codex'in kaynak ve belgelerine göre yazıldı, sahte bir `codex`
komutuyla test edildi; gerçek hesapla denenmedi. Bir araç limite takılınca
diğerinin devralması, OpenCode ve Gemini CLI yapılmadı.

### 9. Kod ve Git paneli (O)

- Dosya ağacı ve dosyalarda arama: yapıldı (git'in yok saydığı dosyalar hariç).
- Son commit'ten beri değişenler: yapıldı. "Kod" ekranı dalı, commit edilmemiş
  değişiklikleri, diğer dalları ve son commit'leri gösteriyor (yalnızca okur).
- Tek klasörde birden çok depo: yapıldı. Görev hangi alt klasördeki depoda
  çalışacağını söyler ve dalını orada açar; iki depoya dokunan iş iki görev olur.

### 10. Belgeler (B)

- Proje sayfaları ve wiki (Markdown): yapıldı. "Belgeler" ekranı büro
  defterini (heyetin yazdığı sayfalar), klasördeki Markdown dosyalarını ve
  dersleri bir arada gösteriyor. Sayfaları kullanıcı da yazıp düzenleyebiliyor.
- Özellik planı sayfası: plan, görevleri, kararları tek yerde.
- Diyagramlar: yapıldı. Sayfadaki ```mermaid bloğu çizim olarak görünür; heyete çizebileceği söylendi.
- Arşivdeki dersleri bu bölüme taşıma.

### 11. Önizleme (B)

- Geliştirme sunucusunu uygulama içinde gösterme: yapıldı ("Önizleme" ekranı;
  masaüstü, tablet ve telefon genişliği; terminalin yazdığı adres tek tıkla açılır).
- Ekrandan bir yeri işaretleyip "burayı düzelt" deme: yapılmadı; sayfa için
  Baş Perito'ya not başlatılabiliyor.
- iOS simülatörü ve Android emülatörü daha sonra.

### 12. Yayın (B)

- Adım adım yayın rehberleri: yapıldı (web sitesi, Mac uygulaması, iPhone,
  Android, npm paketi, yazı ya da kampanya). Rehber Baş Perito'ya iş olarak verilebilir.
- Deploy'un mühürle onaylanması: var. Vercel gibi servislere bağlayıcılar: yapılmadı.

### 13. Telefondan erişim (B)

Yapıldı. Ayarlardan açılır; aynı ağdaki telefonda soruları yanıtlamak,
mühürlemek ve Baş Perito'ya yazmak için küçük bir sayfa sunar. Anahtar
adresin içindedir ve şifrelenmeden gider: yalnızca güvenilen ağ için.
Uygulama kapalıyken bildirim ve ev dışından erişim (Tailscale dışında) yok.

### 14. Çok projeli koordinatör (O)

Tüm büroların üstünde tek sohbet: yapıldı. Bürolar arası devir: yapıldı. Bir
büronun başı diğer büroları görebilir (`peritos bureaus`) ve iş devredebilir
(`peritos send --to bureau:<ad>`); altı devirden sonra kullanıcının o büroya
yazması gerekir. Hepsinin üstünde ayrı bir koordinatör ajan yok.

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
- 3 (büro katı cilası): yapıldı; yakınlaştırma ve yürüme kareleri sonradan eklendi.
- 4 (kararlar ve gerçek güvenlik) ve 6 (görev yönetimi): yapıldı; etiketler,
  kaba maliyet tahmini ve önerileri toplu kabul 0.2.0 ile geldi.
- 7(a) (zengin ajan çıktısı): yapıldı. Araç çağrıları katlanabilir blok olarak
  görünüyor. Gerçek terminal sekmesi (7b) yapılmadı.
- 15 (ilk kullanım): tur, ilk iş kartları ve sade / gelişmiş görünüm yapıldı.
- 16 (büro türleri): birinci adım ve ikinci adımın bağlayıcı altyapısı yapıldı.

## Önerilen sıra

Hazır bağlayıcı şablonları (Higgsfield, Runway, Kling, Stability, Search
Console, Google Ads, Meta Ads) ve Codex yazıldı ama gerçek hesaplarla
denenmedi: sıradaki iş bunları gerçek hesaplarla doğrulamak. Sonrası kullanıcı
geri bildirimine göre.

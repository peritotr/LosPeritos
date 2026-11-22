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

- **İmzalama ve noterlik (K):** Apple Developer hesabıyla uygulamayı imzalayıp
  notere göndermek; başka Mac'lerde uyarısız açılır.
- **Windows paketi (O):** Bir Windows makinede derleme ve deneme.
- **GitHub'a hazırlık (K):** Ekran görüntülü README, katkı rehberi, CI.
- **Otomatik güncelleme (O).**

## Bilerek dışarıda bırakılanlar

- Tanıtım videosu üretimi: ürünün çekirdeği değil.
- Diğer uygulamaların üstünde yüzen koordinatör.
- Lisans sunucusu ve ücretli plan: LosPeritos ücretsiz ve açık kaynak.

## Tamamlananlar

1 (sohbet her ekranda), 2 ("Sen yokken" özeti), 3 (büro katı cilası; yakınlaştırma ve gerçek yürüme kareleri hariç) 4 (kararlar ve gerçek güvenlik; önerileri toplu kabul hariç) ve 5 (takılmayan ekip) yapıldı. 5. maddede limit sonrası devam gerçek bir limitle denenemedi; yalnızca otomatik testle doğrulandı.

## Önerilen sıra

1 → 2 → 3 → imzalama → 4 → 5 → 6 → 7(a) → 8 → 9, sonrası kullanıcı geri
bildirimine göre.

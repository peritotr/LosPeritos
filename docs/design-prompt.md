# LosPeritos — Tasarım Promptu

Aşağıdaki metni Claude Design'a olduğu gibi yapıştır. Ekranları tek seferde değil, "Teslim sırası" bölümündeki sırayla istemen daha iyi sonuç verir.

---

## Prompt

LosPeritos adında açık kaynaklı (MIT) bir masaüstü uygulamasının arayüzünü tasarla. Uygulama macOS ve Windows'ta Electron içinde çalışır; arayüz React ile yazılacak.

### Ürün

LosPeritos, bir yazılım projesinde birlikte çalışan yapay zekâ kodlama ajanlarını yöneten bir çalışma alanıdır. Kullanıcı bir proje klasörü açar ve lider ajana bir iş verir. Lider işi parçalara böler, en fazla 8 ajana dağıtır. Her ajan kendi git dalında çalışır, kullanıcıya soru sorabilir ve riskli adımlarda (birleştirme, yayına alma) kullanıcının onayını bekler. Ajanlar kullanıcının kendi Claude Code veya Codex hesabıyla çalışır; uygulama hesap açtırmaz, veri toplamaz, her şey yerelde durur.

Kullanıcı bir yazılımcı ya da küçük bir ekibin teknik sorumlusudur. Uygulamayı gün boyu açık tutar, çoğu zaman başka bir işle uğraşırken ara ara bakar. En sık sorduğu soru şudur: "Şu an benden ne bekleniyor?"

### Tema: Uzmanlar Heyeti

"Los Peritos" İspanyolcada "uzmanlar / bilirkişiler" demektir. Uygulama bir eksper bürosu gibi hissettirmeli: işi ciddiye alan, her adımı kayda geçiren, kullanıcı mühür basmadan hiçbir şeyi yayına çıkarmayan bir uzmanlar heyeti.

Kavramların arayüzdeki adları:

| Sistemdeki kavram | Arayüzdeki adı | Açıklama |
|---|---|---|
| Lider ajan | Baş Perito | İşi inceler, dosyaları açar, uzmanlara dağıtır |
| Ekip ajanı | Perito | Bir uzmanlık alanı vardır: Mimar, Geliştirici, Denetçi, Testçi, Tasarımcı |
| Görev | Dosya | Numarası, durumu, sorumlu peritosu ve dalı vardır |
| Onay | Mühür | Kullanıcı mühürler ya da geri çevirir |
| Görev sonucu | Rapor | Ne yapıldı, ne test edildi, ne doğrulanmadı |
| Kalıcı dersler | Arşiv | Peritoların önerdiği, kullanıcının kabul ettiği kurallar |
| Günlük bütçe | Mesai defteri | Harcanan / kalan tutar |
| Çalışma alanı | Büro | Bir proje klasörü |

Peritoları insan ya da hayvan karakterleri olarak çizme. Her perito, uzmanlık alanını gösteren soyut bir amblemle (monogram, geometrik işaret, mühür baskısı gibi) temsil edilsin. Maskot yok.

### Görsel yön

- His: bir mimarlık ya da hukuk bürosunun antetli kâğıdı. Sakin, kesin, güven veren. Oyunsu veya sevimli değil.
- Malzeme: kâğıt dokusu hissi veren düz yüzeyler, ince çizgiler, teknik çizim ızgarası, dosya sekmeleri, damga ve mühür baskıları.
- Renk: nötr kâğıt tonları (açık temada kırık beyaz, koyu temada mürekkep laciverti/antrasit) ve tek bir vurgu rengi olarak mühür kırmızısı. Vurgu rengi yalnızca kullanıcıdan eylem beklenen yerlerde kullanılsın. Durum renkleri (çalışıyor, bekliyor, hata, tamam) ayrıca tanımlansın ve vurgu rengiyle karışmasın.
- Tipografi: başlıklarda karakterli bir serif, arayüz metinlerinde okunaklı bir sans, kod ve terminalde eş aralıklı yazı tipi. Dosya numaraları ve damgalarda eş aralıklı yazı kullanılabilir.
- Hareket: az ve işlevsel. Tek imza animasyonu mühür basma anıdır; kısa, tok, tatmin edici olsun. Başka dekoratif animasyon olmasın.
- Açık ve koyu tema birlikte tasarlansın. Renkler tasarım belirteçleri (token) olarak tanımlansın.

### Ekranlar

1. **Kurulum**: İlk açılış. Bilgisayarda kurulu ajan araçlarını (Claude Code, Codex, git) listeler, eksik olanı ve nasıl kurulacağını gösterir. Sonunda "Büro aç" (klasör seç) adımı vardır.
2. **Heyet Masası** (ana ekran): Açık bürodaki peritoların anlık durumu. Her perito bir kart: amblem, uzmanlık, durum (boşta / çalışıyor / soru soruyor / mühür bekliyor / hata), üzerinde çalıştığı dosya, son çıktı satırı. Üstte Baş Perito'ya iş vermek için tek bir giriş alanı.
3. **Dosyalar**: Görevlerin listesi ve Baş Perito'nun yaptığı iş bölümü. Üst-alt dosya ilişkisi görünür. Durumlar: taslak, sırada, işlemde, incelemede, mühür bekliyor, kapandı. Liste ve pano (kanban) görünümü.
4. **Dosya ayrıntısı**: Tanım, sorumlu perito, dal adı, değişen dosyaların farkı (diff), test sonuçları ve Rapor. Rapor üç bölümlüdür: yapılanlar, test edilenler, doğrulanmayanlar.
5. **Heyet Yazışmaları**: Ekip sohbeti. Peritoların birbirine ve kullanıcıya yazdıkları. Bir perito soru sorduğunda mesajın altında cevap seçenekleri düğme olarak çıkar; kullanıcı serbest metin de yazabilir.
6. **Perito ayrıntısı**: Tek bir ajanın terminal çıktısı (canlı akış), o oturumdaki harcaması, durdur / mesaj gönder eylemleri.
7. **Mühür kartı**: Onay bekleyen eylem. Ne yapılacağını, hangi dosyayı etkilediğini, adımlarını (ör. derle, yükle, kontrol et) ve geri alınıp alınamayacağını açıkça gösterir. İki eylem: "Mühürle" ve "Şimdi değil". Kart hem kendi sayfasında hem de diğer ekranların üzerinde bildirim olarak görünebilmeli.
8. **Bekleyenler**: Tüm bürolardaki, kullanıcıdan cevap ya da mühür bekleyen her şeyin tek listesi. Uygulamanın en önemli ekranı; boşken "Bekleyen iş yok" durumunu sakin biçimde göstersin.
9. **Arşiv**: Kabul edilmiş dersler ve peritoların yeni önerdiği dersler. Öneriler için "Arşive al" / "Reddet".
10. **Mesai defteri**: Büro başına günlük bütçe, harcanan tutar, perito başına dağılım. %80'de uyarı durumu, bütçe dolduğunda "yeni iş başlatılamaz" durumu.
11. **Ayarlar**: Büro ayarları (bütçe, güven modu: tam / kısıtlı), ajan araçları, bağlantılar, tema.
12. **Komut paleti**: Klavyeyle açılan arama; büro, dosya, perito ve eylemler arasında gezinir.

### Yerleşim

- Sol kenar çubuğu: bürolar listesi ve ana bölümler (Heyet Masası, Dosyalar, Yazışmalar, Bekleyenler, Arşiv, Mesai defteri). Bekleyenler'in yanında sayı rozeti.
- Üst çubuk: etkin büro, etkin dal, bugünkü harcama göstergesi, komut paleti kısayolu.
- İçerik alanı yeniden boyutlanabilir panellere bölünebilmeli (ör. solda sohbet, sağda terminal).
- En küçük pencere 1024×700. Tasarım 1440×900 için yapılsın, 1024'te de bozulmasın.

### Her bileşen için gereken durumlar

Boş, yükleniyor, dolu, hata ve devre dışı durumlarını göster. Özellikle şunlar tasarlansın: hiç büro yokken ilk ekran, perito hata verdiğinde kart, bütçe dolduğunda giriş alanı, ajan aracı kurulu değilken kurulum satırı, bağlantı koptuğunda üst çubuk.

### Bileşen listesi

Perito kartı, durum rozeti, dosya satırı ve dosya kartı, mühür kartı, mühür damgası (onaylandı / reddedildi / bekliyor), sohbet mesajı ve cevap seçenekleri, terminal paneli, diff görüntüleyici, rapor bloğu, bütçe çubuğu, bildirim (toast), komut paleti, kenar çubuğu öğesi, boş durum bloğu, düğmeler, form alanları, sekmeler.

### Kısıtlar

- Arayüz metinleri İngilizce yazılsın, çeviriye uygun olsun (metinler bileşenlere gömülmesin, uzun çevirilerde taşmasın). Tema adları İspanyolca kökünü korusun: Perito, Peritos.
- Arayüz, veriyi yerel bir servisten HTTP ve WebSocket ile alır; bileşenler veriyi dışarıdan parametre olarak alsın, kendi içinde veri üretmesin. Veri şekilleri depodaki `packages/protocol` paketinde tanımlıdır; örnek veriler onunla uyumlu olsun.
- Erişilebilirlik: tüm eylemler klavyeyle yapılabilsin, odak halkası görünür olsun, metin karşıtlığı WCAG AA'yı karşılasın, durum yalnızca renkle anlatılmasın (ikon ya da metin eşlik etsin).
- Özgün olsun: başka bir ürünün karakterlerini, ofis sahnesini, adlarını veya görsel dilini taklit etme.

### Teslim sırası

1. Tasarım belirteçleri (renk, tipografi, boşluk, köşe, gölge) ve açık/koyu tema.
2. Temel bileşenler: düğme, rozet, kart, form alanı, sekme.
3. Uygulama kabuğu: kenar çubuğu, üst çubuk, panel düzeni.
4. Heyet Masası, Bekleyenler ve Mühür kartı.
5. Dosyalar, Dosya ayrıntısı ve Rapor.
6. Yazışmalar ve Perito ayrıntısı (terminal).
7. Kurulum, Arşiv, Mesai defteri, Ayarlar, Komut paleti.

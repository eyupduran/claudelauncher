# ClaudeLauncher

**Telegram üzerinden, telefondan, Windows bilgisayarındaki herhangi bir projeyi ve Claude Code oturumunu aç.**

[English](README.md)

## Sorun

Claude Code Remote Control ile bir oturuma Claude mobil uygulamasından devam edebilirsin. Ama bunun için o oturumun bilgisayarda zaten açık olması gerekiyor. Masa başında değilken VS Code'da açık olmayan bir projede çalışman gerekirse, birinin bilgisayarın başına geçip projeyi açması ve geçmişten doğru oturumu seçmesi gerekiyor.

## Çözüm

ClaudeLauncher, bilgisayarında arka planda çalışan küçük bir Telegram botu:

1. Telefondan bota yazıp bir proje seçiyorsun.
2. Geçmiş bir Claude Code oturumunu seçiyorsun ya da yeni bir oturum başlatıyorsun.
3. Bilgisayarda VS Code o projeyle açılıyor, Claude Code da o oturumu açıyor.
4. Remote Control açık olduğu için oturum hemen telefondaki Claude uygulamasında görünüyor, oradan devam ediyorsun.

Bunlara ek olarak açık VS Code pencerelerini listeleyebilir, tek bir projenin penceresini kapatabilir ya da yeniden başlatabilir, git özeti gösterebilir ve ekran görüntüsü gönderebilir.

## Gereksinimler

- Windows 10/11
- [Node.js](https://nodejs.org) 18+ (npm paketi yok, bağımlılık sıfır)
- [VS Code](https://code.visualstudio.com) ve [Claude Code eklentisi](https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code)
- Her oturumda Remote Control açık olmalı: `~/.claude.json` içinde `"remoteControlAtStartup": true`
- Telegram hesabı

## Kurulum

1. **Bot oluştur:** Telegram'da **@BotFather** → `/newbot` → token'ı kopyala.
2. **Ayarla:** `config.example.json` dosyasını `config.json` olarak kopyala, `telegramToken` alanına token'ı yapıştır.
   `projectRoots` alanına projelerinin bulunduğu klasör(ler)i yaz.
3. **Servisi kur.** Windows'a giriş yapınca gizli başlar, çökerse kendini yeniden başlatır:
   ```
   npm run install-startup
   ```
4. **Telegram hesabını eşleştir:** `pairing-code.txt` dosyasındaki (ya da logdaki) 6 haneli kodu al, bota `/start <kod>` yaz. Bundan sonra bot sadece sana cevap verir.
5. **İsteğe bağlı: oturumu sağ panelde aç.** Claude Code oturumu normalde ortadaki sekmede açar. Sağdaki Claude panelinde açılmasını istiyorsan küçük yardımcı eklentiyi kur:
   ```
   npm run install-vscode-helper
   ```

Servis başlayınca bot "🟢 hazır" mesajı gönderir.

## Komutlar

Altta kalıcı bir menü var. Yardım için `?` ya da `/help` yaz.

| Komut | Ne yapar |
|---|---|
| `/projects` | Projeleri listeler (önce favoriler, sonra en son kullanılanlar) |
| `/favorites` | Sadece favori projeler |
| düz yazı, ör. `shop` | Adında bu geçen projeleri arar |
| `/last` | En son oturumu tekrar açar |
| `/new <proje>` | Projede yeni oturum açar |
| `/windows` | Açık VS Code pencereleri; her birinde kapat / yeniden başlat |
| `/close <proje>` | Sadece o projenin VS Code penceresini kapatır |
| `/restart <proje>` | Kapatıp son oturumla tekrar açar |
| `/git <proje>` | Branch, kaydedilmemiş değişiklikler, son commitler |
| `/screen` | Ekran görüntüsü |
| `/status` | Servis durumu |

## Güvenlik

- Bot **yalnızca** `allowedUserIds` içindeki Telegram kullanıcılarına cevap verir. Liste boşsa açılışta tek kullanımlık bir eşleştirme kodu üretilir.
- Bot sadece kendi proje listesindeki klasörleri açabilir. Bot üzerinden komut ya da kabuk çalıştırılamaz.
- `config.json` bot token'ını içerir ve git'e girmez. Token sızarsa @BotFather'da `/revoke` yap, `config.json`'u güncelle, `npm run restart` çalıştır.
- `/screen` ekranının görüntüsünü Telegram sohbetine gönderir, bunu aklında tut.

## Bakım

- Log: `logs/claudelauncher.log` (2 MB'da döner)
- `config.json` değişince: `npm run restart`
- Servisi kaldırmak için: `npm run uninstall-startup`
- Klasörü taşıdıysan ya da adını değiştirdiysen: tekrar `npm run install-startup`
- Bilgisayar açık, oturum açılmış ve uyku modunda olmamalı. Ekran kilitli olabilir (ekran görüntüsü siyah gelebilir).
- Oturum bazen yanlış VS Code penceresinde açılıyorsa `config.json` içinde `warmDelayMs` değerini artır (ör. `6000`).

Nasıl çalıştığına dair teknik ayrıntılar için [İngilizce README](README.md#how-it-works).

## Lisans

[MIT](LICENSE)

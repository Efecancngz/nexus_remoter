[English](CONTRIBUTING.md) | [Türkçe](CONTRIBUTING_TR.md) | [Deutsch](CONTRIBUTING_DE.md)

> İngilizce orijinal: [CONTRIBUTING.md](CONTRIBUTING.md) (uyuşmazlıkta İngilizce metin geçerlidir).

# Nexus Remote'a Katkıda Bulunma

Nexus Remote'u geliştirmek istediğiniz için teşekkürler! Bu rehber, sıfır bir klondan birleştirilmiş (merge edilmiş) bir PR'a giden yolu gösterir. Kısacası: proje, katkıların çoğunun **yeni dosyalar olacak, düzenleme olmayacak** şekilde bilinçli olarak tasarlanmıştır — herhangi bir şeye dokunmadan önce "Yeni bir eylem (action) ekleme" bölümünü okuyun.

## Geliştirme ortamı kurulumu

Depo iki uygulama barındırır: PC'de çalışan Python ajanı (`nexus_desktop/`) ve telefonun yüklediği React PWA (depo kökü).

- **Python ajanı:** bir sanal ortam (virtualenv) oluşturun ve gereksinimleri kurun, ardından ajanı kaynak koddan çalıştırın:

  ```bash
  python -m venv venv
  venv\Scripts\pip install -r requirements.txt
  venv\Scripts\python.exe nexus_desktop\main.py
  ```

  AI özellikleri için (sesli komutlar, makro oluşturma), depo kökünde bir `.env` dosyasına `GEMINI_API_KEY="..."` ekleyin. Anahtar PC'de kalır; hiçbir zaman telefona gönderilmez.

- **Web istemcisi:** standart Vite iş akışı:

  ```bash
  npm install
  npm run dev
  ```

  Bu, :5173 üzerinde bir HTTPS geliştirme sunucusu başlatır (PWA'nın ajanın TLS uç noktasıyla konuşabilmesi için HTTPS zorunludur).

- **Testler:** bir PR açmadan önce depo kökünden her iki test paketini de çalıştırın.

  Backend:

  ```bash
  venv\Scripts\python.exe -m pytest nexus_desktop\tests -q
  ```

  Frontend:

  ```bash
  npx vitest run
  npx tsc --noEmit
  ```

## 60 saniyede mimari

Telefon PWA (React) → HTTPS+token → Flask ajanı (`nexus_desktop/`) → EventBus → servisler.

Telefon PC'nize hiçbir zaman doğrudan dokunmaz: her istek bir oturum jetonu (session token) taşır ve TLS üzerinden Flask ajanına gider; ajan da işi, servislerin (system, media, automation, scheduler, …) abone olduğu bir EventBus'a yayınlar.

AI komutları bir ek adım daha atar: PWA serbest metni `/ai/*` rotalarına gönderir; ajan Gemini'den (**sunucu tarafında** bir API anahtarıyla) JSON otomasyon adımları üretmesini ister; bu adımlar telefona geri döner ve `/execute` üzerinden tek tek çalıştırılır. AI hiçbir şeyi kendisi çalıştırmaz — yalnızca eylem katmanının doğruladığı, türü belirli (typed) adımlar önerir.

## Yeni bir eylem ekleme (açık/kapalı kuralı)

Sistem, siz dosya **EKLEYECEK, mevcut olanları asla değiştirmeyecek** şekilde tasarlanmıştır. Bir eylem = `nexus_desktop/actions/` içinde bir dosya. Bu paketteki her modül (alt çizgiyle başlayan `_targets.py` gibi yardımcılar hariç) içe aktarma (import) anında otomatik olarak keşfedilir, `@register_action` dekoratörü üzerinden kendini kaydeder ve o andan itibaren:

- `/execute` dağıtıcısı (dispatcher) onu çalıştırabilir,
- Gemini sistem istemi (system prompt) örneklerini ve ipuçlarını otomatik olarak içerir,
- frontend onu render eder (özel bir simgesi yoksa varsayılan bir simgeyle).

İşte `nexus_desktop/actions/hotkey.py` dosyasının birebir hâli — bu, referans uygulamadır çünkü ihtiyacınız olan dört unsurun tamamını gösterir: registry dekoratörü, `prompt_examples`, `prompt_hint` ve düşman (hostile) girdide `ValueError` fırlatan izin listesi (allowlist) doğrulaması:

```python
import pyautogui

from .base import Action
from .registry import register_action

_ALLOWED_KEYS = (
    {chr(c) for c in range(ord('a'), ord('z') + 1)}
    | {str(d) for d in range(10)}
    | {f'f{i}' for i in range(1, 25)}
    | {
        'ctrl', 'alt', 'shift', 'win', 'enter', 'tab', 'esc', 'space',
        'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown',
        'delete', 'backspace', 'insert', 'capslock', 'printscreen',
        'volumemute', 'volumeup', 'volumedown', 'playpause', 'nexttrack', 'prevtrack',
    }
)


@register_action("HOTKEY")
class HotkeyAction(Action):
    prompt_examples = [
        '- "Kaydet": {{ "type": "HOTKEY", "value": "ctrl+s", "description": "Kaydediliyor" }}',
        '- "Sekmeyi kapat": {{ "type": "HOTKEY", "value": "ctrl+w", "description": "Sekme kapatılıyor" }}',
    ]
    prompt_hint = (
        'Tuş kombinasyonları için HER ZAMAN HOTKEY kullan (value: "ctrl+s" '
        'gibi, tuşlar + ile ayrılır). Tek tuş veya metin yazmak için KEYPRESS kullan.'
    )

    def execute(self, value, context):
        keys = [k.strip().lower() for k in (value or '').split('+')]
        if not keys or any(not k for k in keys):
            raise ValueError(f"Invalid hotkey: {value!r}")
        for key in keys:
            if key not in _ALLOWED_KEYS:
                raise ValueError(f"Key not allowed in hotkey: {key!r}")
        pyautogui.hotkey(*keys)
```

Baktığınız şeyle ilgili birkaç not:

- `@register_action("HOTKEY")` tek bağlantı (wiring) noktasıdır. Backend'de düzenlenecek bir dispatch tablosu, import listesi veya genişletilecek bir enum yoktur.
- `prompt_examples` satırları kasıtlı olarak çift `{{ }}` küme parantezi kullanır — `services/ai_service.py`, Gemini sistem istemini oluştururken bunları `{ }` olarak açar. Kendi örneklerinizde de bu kurala uyun. (Örnekler Türkçedir çünkü teslim edilen sistem istemi Türkçedir; buna uyun.)
- `execute`, `value`'yu düşman girdi olarak ele alır: her şey `_ALLOWED_KEYS` ile karşılaştırılır ve işletim sistemine herhangi bir şey dokunmadan *önce* beklenmeyen her şey `ValueError` ile reddedilir. Dağıtıcı, `ValueError`'ı temiz bir istemci hatasına dönüştürür.

Ve işte eşleşen test şablonu — `nexus_desktop/tests/test_actions_input.py` dosyasındaki `TestHotkey` sınıfı, birebir (o dosyanın en üstündeki `CTX` fikstürü, `actions.base`'den `ActionContext(bus=None)`'dır):

```python
class TestHotkey:
    def _action(self):
        from actions.hotkey import HotkeyAction
        return HotkeyAction()

    def test_valid_combo_calls_pyautogui(self, monkeypatch):
        calls = []
        monkeypatch.setattr("actions.hotkey.pyautogui.hotkey", lambda *keys: calls.append(keys))
        self._action().execute("Ctrl + Shift + S", CTX)
        assert calls == [("ctrl", "shift", "s")]

    def test_single_key_allowed(self, monkeypatch):
        calls = []
        monkeypatch.setattr("actions.hotkey.pyautogui.hotkey", lambda *keys: calls.append(keys))
        self._action().execute("f5", CTX)
        assert calls == [("f5",)]

    def test_unknown_key_rejected(self, monkeypatch):
        monkeypatch.setattr("actions.hotkey.pyautogui.hotkey", lambda *keys: pytest.fail("must not run"))
        with pytest.raises(ValueError):
            self._action().execute("ctrl+launchmissiles", CTX)

    def test_empty_value_rejected(self):
        with pytest.raises(ValueError):
            self._action().execute("  ", CTX)

    def test_empty_segment_rejected(self):
        with pytest.raises(ValueError):
            self._action().execute("ctrl++s", CTX)
```

Kalıp şu: işletim sistemine dokunan çağrıyı (burada `pyautogui.hotkey`) monkeypatch'leyin, böylece gerçekte hiçbir şey olmaz; mutlu yolun (happy path) doğru argümanları ilettiğini doğrulayın ve her düşman girdinin, işletim sistemi çağrısı **hiç** çalışmadan `ValueError` fırlattığını doğrulayın.

### Kontrol listesi

1. `nexus_desktop/actions/<eyleminiz>.py` dosyasını oluşturun — otomatik keşfedilir, hiçbir yerde düzenlenecek import yoktur.
2. Yukarıdaki şablonu izleyerek `nexus_desktop/tests/test_<eyleminiz>.py` dosyasını oluşturun.
3. `prompt_examples`/`prompt_hint`, Gemini'ye eyleminizi otomatik olarak öğretir — istem anlık görüntüsü (prompt snapshot) testiyle doğrulayın (`tests/test_ai_prompt.py`, düzenleme yapılmadan geçmelidir).
4. Frontend: yapılacak bir şey yok. Bilinmeyen eylem türleri varsayılan bir simgeyle render edilir. İsteğe bağlı olarak özel stil için `components/CommandPreviewModal.tsx` içine bir enum üyesi + simge durumu (icon case) ekleyin.

## Güvenlik kuralları (bu kuralları ihlal eden PR'lar reddedilir)

Bu uygulama bir telefondan doğal dilde komutlar kabul eder ve bir LLM'in bunları birinin PC'sinde eylemlere dönüştürmesine izin verir. Aşağıdaki kurallar, bunun bir uzaktan kod yürütme (remote-code-execution) hizmetine dönüşmesini engelleyen şeylerdir:

- **Asla bir shell üzerinden çalıştırmayın.** İzin listesine alınmış bir hedefle `os.startfile` kullanın veya yalnızca sabit bir argv ile `subprocess.run([...], shell=False)` kullanın. Dize (string) olarak oluşturulmuş komutlar, `shell=True`, `os.system` — anında reddedilir.
- **Kullanıcı/AI tarafından sağlanan değerler düşman girdidir.** İzin listelerine göre doğrulayın (`actions/hotkey.py`, `actions/command.py`'ye bakın) ve beklenmeyen her şeyde `ValueError` fırlatın. Gemini çıktısı, diğer her girdi gibi güvenilmez girdidir.
- **`actions/_targets.py: PROTECTED_PROCESSES`**, süreçlere dokunan her şey için pazarlığa kapalıdır. AI ne isim üretirse üretsin, hiçbir eylem `csrss`, `lsass` veya ajanın kendi `python` sürecini asla sonlandıramaz.
- **Her Flask rotası oturum jetonunu kontrol etmelidir**; AI rotaları yalnızca sunucu tarafı anahtarla kalır. Gemini API anahtarı PC'den asla çıkmaz ve frontend paketinde (bundle) asla görünmez.

## Daha güçlü bir model kullanma / görme (vision) ekleme

- **Model değişimi:** `nexus_desktop/services/ai_service.py` içindeki `MODEL_NAME`'i değiştirin (şu anda `"gemini-2.5-flash"`); anahtarınızın erişebildiği herhangi bir Gemini modeli çalışır. Tamamen başka bir sağlayıcı için, `AiService._model`/işleyicileri (handlers) içindeki `genai` çağrılarını değiştirin — rotalar ve JSON adım şeması sağlayıcıdan bağımsızdır (provider-agnostic), böylece başka hiçbir şey değişmez.
- **Görme ("bilgisayar kullanımı"):** bunu yalnızca başka bir eylem modülü olarak uygulayın (örneğin `SMART_CLICK`): ekranı yakalayın (`pyautogui.screenshot`), hedef metinle birlikte görme yeteneğine sahip bir modele gönderin, dönen koordinatları ayrıştırın, ardından ekranda kalmasını sağlamak için MOUSE_CLICK'in sınırlama (clamping) mantığını yeniden kullanın. Bu bir yeniden yazma değil, bir genişletme noktasıdır: tek bir yeni dosya.

## Dal (branch) ve PR kuralları

- Her iş parçası için bir dal (`feat/...`, `fix/...`), PR'lar `main`'e karşı.
- İncelemeyi (review) istemeden önce tüm test paketleri yeşil olmalı (pytest + vitest + tsc) — Geliştirme ortamı kurulumu bölümündeki komutlar, orada yazıldığı gibi, birebir.

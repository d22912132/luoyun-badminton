(function () {
  'use strict';
  var loadedVersion = document.querySelector('meta[name="app-version"]').content;
  var latestVersion = loadedVersion, registration, installPrompt, checking, updating = false;
  var notice, message, updateButton, dismissButton;

  function show(text, canUpdate) {
    if (!notice) {
      notice = document.createElement('section'); notice.id = 'app-notice';
      notice.setAttribute('aria-label', 'App 更新與安裝');
      message = document.createElement('p'); message.setAttribute('role', 'status');
      var actions = document.createElement('div');
      updateButton = document.createElement('button'); updateButton.type = 'button';
      updateButton.textContent = '立即更新'; updateButton.addEventListener('click', applyUpdate);
      dismissButton = document.createElement('button'); dismissButton.type = 'button';
      dismissButton.textContent = '稍後'; dismissButton.addEventListener('click', function () { notice.hidden = true; });
      actions.append(updateButton, dismissButton); notice.append(message, actions); document.body.append(notice);
    }
    message.textContent = text; updateButton.hidden = !canUpdate;
    dismissButton.textContent = canUpdate ? '稍後' : '知道了'; notice.hidden = false;
  }

  function canReload() {
    return typeof window.luoyunCanReload === 'function' && window.luoyunCanReload();
  }

  async function fetchVersion() {
    if (navigator.onLine === false) throw new Error('offline');
    var controller = new AbortController(), timer = setTimeout(function () { controller.abort(); }, 8000);
    try {
      var response = await fetch('/app-version.json', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('version request failed');
      var data = await response.json();
      if (typeof data.version !== 'string' || !data.version) throw new Error('invalid version');
      return data.version;
    } finally { clearTimeout(timer); }
  }

  function check(manual) {
    if (checking) return checking;
    checking = (async function () {
      try {
        latestVersion = await fetchVersion();
        if (registration) registration.update().catch(function () {});
        if (latestVersion !== loadedVersion) show('發現新版本。更新會重新載入頁面，請先儲存目前的內容。', true);
        else if (manual) show('目前已是最新版本。', false);
        else if (notice) notice.hidden = true;
        return true;
      } catch (error) {
        show(navigator.onLine === false ? '目前離線，無法確認新版本；活動與名單更新需要網路連線。' : '暫時無法確認新版本，恢復連線或重新開啟時會再檢查。', false);
        return false;
      } finally { checking = null; }
    })();
    return checking;
  }

  async function applyUpdate() {
    if (updating) return;
    if (!canReload()) { show('請先儲存或關閉目前表單，並等待操作完成，再按「立即更新」。', true); return; }
    updating = true; updateButton.disabled = true;
    try {
      // 網路檢查期間可能又打開表單；重新載入前必須再確認一次。
      latestVersion = await fetchVersion();
      if (!canReload()) { show('目前有未完成的操作，內容已保留。請完成後再更新。', true); return; }
      if (latestVersion === loadedVersion) { show('目前已是最新版本。', false); return; }
      if (registration && registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      window.location.reload();
    } catch (error) {
      show('更新暫時無法連線，目前內容已保留，請稍後再試。', true);
    } finally { updating = false; updateButton.disabled = false; }
  }

  async function install() {
    if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) {
      show('目前已經以 App 模式開啟。', false); return;
    }
    if (installPrompt) {
      var prompt = installPrompt; installPrompt = null;
      try { await prompt.prompt(); await prompt.userChoice; }
      catch (error) { show('請從瀏覽器選單選擇「安裝 App」或「加入主畫面」。', false); }
    } else {
      show('請從瀏覽器選單選擇「安裝 App」或「加入主畫面」；iPhone 請使用 Safari 的分享選單。', false);
    }
  }

  window.luoyunPwa = { check: function () { return check(true); }, install: install, applyUpdate: applyUpdate };
  window.addEventListener('beforeinstallprompt', function (event) { event.preventDefault(); installPrompt = event; });
  window.addEventListener('appinstalled', function () { installPrompt = null; if (notice) notice.hidden = true; });
  window.addEventListener('pageshow', function () { check(false); });
  window.addEventListener('online', function () { check(false); });
  window.addEventListener('offline', function () { show('目前離線；活動與名單更新需要網路連線。', false); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') check(false); });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then(function (reg) {
      registration = reg;
      reg.addEventListener('updatefound', function () {
        var worker = reg.installing;
        if (worker) worker.addEventListener('statechange', function () { if (worker.state === 'installed') check(false); });
      });
    }).catch(function () { show('App 離線功能尚未啟用，仍可連線使用；請重新開啟後再試。', false); });
    // 其他分頁啟用新版時，只檢查與提示，絕不強制重整正在編輯的分頁。
    navigator.serviceWorker.addEventListener('controllerchange', function () { check(false); });
  }
  check(false);
})();

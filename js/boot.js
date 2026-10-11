/* Семестр — до запуска приложения: тема без мигания и экран «не запустился» вместо пустого.
   Отдельным файлом, а не внутри index.html: политика безопасности страницы запрещает встроенные скрипты. */
// Тема до первой отрисовки, чтобы не мигало
(function () {
  var root = document.documentElement;
  window.__hostTheme = root.getAttribute('data-theme');
  try {
    var s = JSON.parse(localStorage.getItem('semestr.v1') || 'null');
    var t = s && s.settings && s.settings.theme;
    if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t);
  } catch (e) { /* хранилище недоступно */ }
})();

// Если Семестр не запустился (старый браузер, ошибка в коде), вместо пустого экрана показываем причину
(function () {
  var errors = [];
  window.addEventListener('error', function (e) { errors.push(e.message || 'ошибка загрузки'); });
  window.__bootFail = function (reason) {
    var view = document.getElementById('view');
    if (!view || view.childElementCount) return;
    var why = reason ? String(reason.message || reason) : errors[0];
    view.innerHTML = '<div class="view-inner"><div class="empty boot-error">'
      + '<div class="empty-title">Семестр не запустился</div>'
      + '<p>Скорее всего, браузер устарел. Обновите его или откройте сайт в Chrome, Edge, Firefox или Яндекс Браузере.</p>'
      + '<p class="boot-why"></p>'
      + '<button class="btn" type="button">Обновить страницу</button></div></div>';
    view.querySelector('.boot-why').textContent = why ? 'Причина: ' + why : '';
    view.querySelector('button').addEventListener('click', function () { location.reload(); });
  };
  window.addEventListener('load', function () { setTimeout(function () { window.__bootFail(); }, 1500); });
})();

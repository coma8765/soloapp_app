export function setupFullscreen(button, status, doc = document) {
  const root = doc.documentElement;
  const current = () => doc.fullscreenElement || doc.webkitFullscreenElement;
  const enter = root.requestFullscreen || root.webkitRequestFullscreen;
  const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
  const sync = () => {
    const active = Boolean(current());
    button.textContent = active ? '⛶ Выйти из полного экрана' : '⛶ На весь экран';
    button.setAttribute('aria-pressed', String(active));
  };
  if (!enter || !exit || doc.fullscreenEnabled === false || doc.webkitFullscreenEnabled === false) {
    button.disabled = true;
    button.textContent = 'Полный экран недоступен';
    return;
  }
  button.onclick = async () => {
    status.textContent = '';
    try {
      if (current()) await exit.call(doc);
      else await enter.call(root);
    } catch {
      status.textContent = 'Браузер не разрешил полноэкранный режим. Попробуйте ещё раз.';
    }
    sync();
  };
  doc.addEventListener('fullscreenchange', sync);
  doc.addEventListener('webkitfullscreenchange', sync);
  sync();
}

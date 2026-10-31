# GitHub Pages + Render

Интерфейс: https://averanges.github.io/korean-stickman/
Голосовой API: https://korean-stickman.onrender.com/api/stt

Изменения подготовлены локально. Публикация не выполнялась.

## Схема

Браузер ← GitHub Pages: HTML, CSS, JavaScript, SVG, анимации.
Браузер → Render /api/stt → Groq Whisper → окончательный текст → игровая логика в браузере.
Герой сохраняется в localStorage браузера. Ключ Groq есть только на сервере.

При открытии игры нет запросов к Render. Голосовой запрос отправляется только после второго нажатия на микрофон. Сервер не обслуживает интерфейс на Render; ответ 404 по корню Render теперь ожидаем.

## 1. Обновить GitHub

Используйте существующий репозиторий averanges/korean-stickman. Загрузите содержимое именно этой папки korean-stickman в корень репозитория, включая скрытую папку .github. Не загружайте outputs целиком, архивы, .env или node_modules.

Перед коммитом проверьте git status и git ls-files .env: второй вывод должен быть пустым. .gitignore не удаляет секреты, уже попавшие в историю: если такое происходило, замените ключ в Groq и удалите секрет из истории.

Файлы .env и серверные модули не попадают в публичную сборку Pages: сборка копирует только index.html, игровые JS/CSS и каталог SVG. Папка dist исключена из Git.

## 2. Обновить существующий Render Web Service

Сервис: https://korean-stickman.onrender.com

| Настройка | Значение |
|---|---|
| Repository | averanges/korean-stickman |
| Branch | Ветка с обновлённым проектом, обычно main |
| Root Directory | Пусто, если server.mjs лежит в корне репозитория |
| Runtime | Node |
| Instance | Free |
| Build Command | npm ci |
| Start Command | npm start |
| Health Check Path | /api/stt/status |

В Environment установите:

| Переменная | Значение |
|---|---|
| GROQ_API_KEY | Существующий ключ Groq; оставить секретом Render |
| FRONTEND_ORIGIN | https://averanges.github.io |
| STT_MODEL | Необязательно: whisper-large-v3 |

FRONTEND_ORIGIN — именно адрес без /korean-stickman/. Браузер отправляет Origin без пути; CORS не может различать репозитории на одном averanges.github.io. Чужие github.io-источники не разрешены. OPTIONS поддерживается, wildcard и cookies не используются.

PUBLIC_ORIGIN оставьте незаданным: сервер получит собственный домен из RENDER_EXTERNAL_URL. Если эта переменная уже установлена, удалите её либо задайте https://korean-stickman.onrender.com. Не указывайте здесь Pages.

RENDER, PORT и RENDER_EXTERNAL_URL предоставляет платформа. На Render сервер автоматически работает только как API и слушает 0.0.0.0. API_ONLY=true можно задать явно, но на Render это необязательно. Локальный .env на Render не читается.

После загрузки изменений в GitHub выполните Manual Deploy → Deploy latest commit (либо дождитесь уже включённого Auto-Deploy). Если включён Auto-Deploy, загрузка коммита сама обновит Render; этот агент коммиты не отправлял.

Проверьте /api/stt/status: ожидается JSON с configured: true. Адрес / на Render будет возвращать 404 — игру открывайте через Pages.

## 3. Включить GitHub Pages

1. В репозитории откройте Settings → Pages → Build and deployment → Source: GitHub Actions.
2. В Settings → Secrets and variables → Actions → Variables добавьте Repository variable API_BASE_URL = https://korean-stickman.onrender.com. Это публичный адрес, не секрет; /api/stt дописывается клиентом. В workflow уже есть этот адрес по умолчанию, переменная позволяет заменить его без правки кода.
3. Откройте Actions → Publish frontend to GitHub Pages → Run workflow. Выберите ветку с обновлением. Если workflow ещё не виден, поместите его в основную ветку репозитория.
4. После успешной сборки и публикации откройте https://averanges.github.io/korean-stickman/ и обновите страницу.

Workflow запускается только вручную. После следующих обновлений интерфейса запускайте его снова. Если окружение github-pages требует подтверждения, подтвердите deployment в Actions.

GitHub Actions выполняет npm ci, npm test, npm run build:pages и публикует только dist. Groq-ключ в GitHub Actions не нужен. Не выбирайте публикацию всего корня репозитория через Deploy from a branch.

## Проверка после самостоятельной публикации

- Откройте Pages: сцена, коробка, анкета и ручной ввод должны загружаться независимо от Render. В инструментах браузера все игровые JS/CSS загружаются по /korean-stickman/src/; SVG встроены в интерфейс.
- Введите 저는 한국 사람이에요. — страна должна примениться. Обновите страницу: герой сохраняется.
- Нажмите микрофон, скажите 저는, сделайте паузу 4 секунды, добавьте 러시아 사람이에요, нажмите второй раз. В Network ожидается один POST на https://korean-stickman.onrender.com/api/stt; OPTIONS перед ним допустим.
- При остановленном Render интерфейс и ручной ввод работают. После голосовой попытки появится сообщение об ошибке; ожидание запроса ограничено 65 секундами, можно отменить раньше. Автоматических повторов нет.
- На Render /.env и /server.mjs недоступны; в опубликованной сборке Pages этих файлов вообще нет.

Локальные проверки имитируют Host/Origin, OPTIONS и ошибки сервиса. Реальные CORS, HTTPS и микрофон на опубликованных доменах нужно проверить после вашего деплоя: публикация в рамках этой задачи не выполнялась.

## Локальная разработка

Node.js 24.x. Из папки проекта: npm ci, затем npm run dev. Адрес: http://localhost:5173. Здесь интерфейс и /api/stt по-прежнему обслуживает один локальный сервер; адрес Render не нужен. Для голоса используется локальный .env с GROQ_API_KEY.

Для сборки frontend вручную в PowerShell:

```powershell
$env:API_BASE_URL='https://korean-stickman.onrender.com'
npm run build:pages
```

Сборка в dist содержит публичный адрес API. В исходном src/api-config.js также указан https://korean-stickman.onrender.com, поэтому открытая без сборки публичная копия не теряет адрес сервиса. На localhost и 127.0.0.1 клиент всегда использует относительный /api/stt своего локального сервера. Публиковать по-прежнему рекомендуется только dist через подготовленный workflow. После изменения серверного кода перезапустите локальный npm run dev.

## Сохранение и ограничения

Формат и ключ localStorage (korean-stickman.hero.v2) сохранены. Прогресс старого сайта onrender.com и localhost не переносится на новый github.io-адрес автоматически: это разные источники браузера. Старое сохранение не удаляется; дальнейшая игра сохраняется на Pages.

Запись MediaRecorder, ручное завершение, паузы, отмена и передача целого файла не изменены. Сохраняются лимиты backend: 20 МиБ, 2 одновременных STT-запроса и 20 начатых операций в минуту на экземпляр. Лимиты в памяти сбрасываются при перезапуске. CORS и эти ограничения не заменяют авторизацию или денежный лимит в Groq.

Render Free может засыпать, и первая голосовая попытка может ждать пробуждения. Перенос делает интерфейс независимым, но не устраняет недоступность самого голосового сервиса. Heartbeat, фоновые запросы и автоматические повторы не добавлены.

Справка: [GitHub Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [Render Free](https://render.com/docs/free).

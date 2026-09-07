// Имя "версии" кэша. Менять цифру при каждом обновлении НЕ обязательно —
// страница подтягивается из сети, когда есть интернет (см. блок fetch).
// Поднимать версию стоит, только если нужно принудительно сбросить весь
// старый кэш у всех пользователей.
const CACHE_NAME = "payments-app-v3";

// Без этих файлов приложения просто нет — их кэшируем строго
const CORE_FILES = [
  "./",
  "./index.html",
  "./manifest.json"
];

// А это "приятные дополнения". Если одной иконки нет или она
// переименована — приложение всё равно должно установиться
const EXTRA_FILES = [
  "./icon-192.png",
  "./icon-512.png"
];

// Страница, которую отдаём, если интернета нет
const OFFLINE_PAGE = "./index.html";

// Установка: складываем файлы приложения в офлайн-кэш.
// addAll — это "всё или ничего": если хоть один файл не скачался,
// падает вся установка и офлайна не будет вообще. Поэтому
// обязательные файлы грузим пачкой, а иконки — поштучно и молча.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache
        .addAll(CORE_FILES)
        .then(() =>
          Promise.all(EXTRA_FILES.map((file) => cache.add(file).catch(() => {})))
        )
    )
  );
  self.skipWaiting();
});

// Активация: подчищаем старые версии кэша, если были
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Кладём ответ в кэш только если он успешный (статус 200-299).
// Иначе в офлайн-копию мог бы попасть 404 или страница-заглушка
// хостинга — и приложение "сломалось бы" даже после возврата сети.
function cacheIfOk(request, response) {
  if (!response || !response.ok) return Promise.resolve();
  const copy = response.clone();
  return caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
}

// Запросы обрабатываем по-разному:
//
// 1) Сама страница (навигация) — "сеть вперёд": если интернет есть,
//    берём свежую версию (и обновляем кэш), если нет — отдаём
//    сохранённую копию. Так правки видны сразу, а офлайн жив.
//
// 2) Всё остальное (иконки, manifest) — "кэш вперёд": отдаём быстро
//    из кэша, а в фоне тихо обновляем на свежее.
self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Не вмешиваемся в не-GET запросы
  if (request.method !== "GET") return;

  // Чужие домены не кэшируем: ответы оттуда бывают "непрозрачными"
  // (браузер не даёт прочитать статус), и в кэш легко положить мусор
  if (new URL(request.url).origin !== self.location.origin) return;

  // 1) Страница
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            event.waitUntil(cacheIfOk(OFFLINE_PAGE, response));
            return response;
          }

          // Интернет есть, но сервер ответил ерундой: 404, 500 или
          // страницей-заглушкой хостинга. Показывать это пользователю
          // хуже, чем показать вчерашнюю рабочую копию приложения
          return caches
            .match(OFFLINE_PAGE, { cacheName: CACHE_NAME })
            .then((cached) => cached || response);
        })
        .catch(() =>
          caches.match(OFFLINE_PAGE, { cacheName: CACHE_NAME }).then(
            (cached) =>
              cached ||
              new Response("Нет соединения и сохранённой копии страницы", {
                status: 503,
                headers: { "Content-Type": "text/plain; charset=utf-8" }
              })
          )
        )
    );
    return;
  }

  // 2) Прочие файлы
  event.respondWith(
    caches.match(request, { cacheName: CACHE_NAME }).then((cached) => {
      const fromNetwork = fetch(request).then((response) => {
        event.waitUntil(cacheIfOk(request, response));
        return response;
      });

      if (cached) {
        // Обновляем копию в фоне; ошибку сети здесь глушим —
        // пользователю уже отдан ответ из кэша
        event.waitUntil(fromNetwork.catch(() => {}));
        return cached;
      }

      return fromNetwork;
    })
  );
});

/**
 * Próximo Feriado Argentina - Service Worker
 * Versión: 1.0
 * 
 * Este Service Worker permite que la aplicación funcione offline
 * y mejora el rendimiento mediante el cacheo de recursos.
 */

const CACHE_NAME = 'proximoferiado-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/styles.css',
  '/script.js',
  '/calendario.js',
  '/feriados.txt',
  '/images/favicon.png',
  '/images/og-feriados-argentina.jpg',
  'https://cdnjs.cloudflare.com/ajax/libs/moment.js/2.29.1/moment.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/moment-timezone/0.5.34/moment-timezone-with-data.min.js'
];

// Instalación del Service Worker
self.addEventListener('install', event => {
  console.log('[Service Worker] Instalando...');
  
  // Precarga de recursos en caché
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[Service Worker] Cacheando recursos');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => {
        console.log('[Service Worker] Instalación completada');
        return self.skipWaiting();
      })
      .catch(error => {
        console.error('[Service Worker] Error durante la instalación:', error);
      })
  );
});

// Activación del Service Worker
self.addEventListener('activate', event => {
  console.log('[Service Worker] Activando...');
  
  // Limpiar cachés antiguos
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (cacheName !== CACHE_NAME) {
              console.log('[Service Worker] Eliminando caché antiguo:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('[Service Worker] Activación completada');
        return self.clients.claim();
      })
  );
});

// Interceptar solicitudes de red
self.addEventListener('fetch', event => {
  // Estrategia: Cache con fallback a red
  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        // Si el recurso está en caché, devolverlo
        if (cachedResponse) {
          return cachedResponse;
        }
        
        // Si no está en caché, buscarlo en la red
        return fetch(event.request)
          .then(networkResponse => {
            // Si la respuesta no es válida, devolver un error
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
              return networkResponse;
            }
            
            // Clonar la respuesta para poder almacenarla en caché
            const responseToCache = networkResponse.clone();
            
            // Almacenar la respuesta en caché para futuras solicitudes
            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
              });
            
            return networkResponse;
          })
          .catch(error => {
            console.error('[Service Worker] Error al recuperar recurso:', error);
            
            // Si es una solicitud de feriados.txt y falla, devolver una respuesta de fallback
            if (event.request.url.includes('feriados.txt')) {
              return new Response(
                'Año Nuevo,2025-01-01\nCarnaval,2025-03-03\nCarnaval,2025-03-04',
                { headers: { 'Content-Type': 'text/plain' } }
              );
            }
            
            // Para otras solicitudes, mostrar una página de error
            if (event.request.mode === 'navigate') {
              return caches.match('/offline.html')
                .then(offlineResponse => {
                  return offlineResponse || new Response(
                    '<html><body><h1>Estás offline</h1><p>No se pudo cargar el contenido solicitado.</p></body></html>',
                    { headers: { 'Content-Type': 'text/html' } }
                  );
                });
            }
          });
      })
  );
});

// Sincronización en segundo plano
self.addEventListener('sync', event => {
  if (event.tag === 'sync-feriados') {
    event.waitUntil(
      fetch('feriados.txt')
        .then(response => response.text())
        .then(data => {
          // Almacenar los datos actualizados en IndexedDB o localStorage
          self.clients.matchAll().then(clients => {
            clients.forEach(client => {
              client.postMessage({
                type: 'feriados-updated',
                data: data
              });
            });
          });
        })
        .catch(error => {
          console.error('[Service Worker] Error en sincronización:', error);
        })
    );
  }
});

// Notificaciones push
self.addEventListener('push', event => {
  const data = event.data.json();
  
  const options = {
    body: data.body || 'Próximo feriado en Argentina',
    icon: '/images/favicon.png',
    badge: '/images/favicon.png',
    data: {
      url: data.url || '/'
    }
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title || 'Próximo Feriado Argentina', options)
  );
});

// Acción al hacer clic en una notificación
self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  event.waitUntil(
    clients.openWindow(event.notification.data.url)
  );
});

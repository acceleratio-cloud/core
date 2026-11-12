# План: переход с SeaweedFS на Longhorn + RustFS

Статус: план утверждён 2026-11-12, выполняется в отдельной сессии.
Обратная совместимость не нужна: пользователей и публичного релиза нет. Старые
данные, миграции данных, флаги совместимости и переходные режимы не делаем.
SeaweedFS удаляется полностью — из инсталлятора, API, консоли, документации и
тестов. Критерий конца: `git grep -i -e seaweed -e filer -e "weed "` ничего не
находит (кроме этого файла).

## Почему (кратко, по результатам бенчмарков 2026-11-12)

- SeaweedFS отвечает на `fsync`, не сбрасывая данные на диск (`.dat` без
  `O_DIRECT`/`O_SYNC`, ни одного flush на ~3000 fsync). Postgres теряет
  подтверждённые транзакции при сбое.
- Слоты томов SeaweedFS считаются от свободного места, каждая коллекция
  (бакет или PVC) берёт 7 слотов: на 50 ГБ диска после ~5 бакетов/PVC запись в
  новые падает с `failed to find writable volumes`. Под нагрузкой были EIO и
  `ENOSPC`.
- Longhorn (одна реплика): pgbench 5430 TPS против 416–637 у SeaweedFS,
  случайное чтение ~9× быстрее. Две реплики на гигабите: 807 TPS, отказ узла —
  ~9 с паузы записи без потери данных, пересборка реплики ~10 с.
- RustFS 1.0.5: режим `strict` (fdatasync до 200 OK), IAM-политики на бакет,
  ротация ключей, квоты, lifecycle, CNPG/barman бэкап и восстановление —
  проверено. ~40 МиБ RAM в простое против 6 подов и 1,3 ГиБ у SeaweedFS.

## Принятые решения

1. **Longhorn — единственный CSI.** Все PVC (тома сервисов, Postgres,
   registry, данные RustFS) на Longhorn, движок v1 (iSCSI).
2. **RustFS — единственный S3**, один под (single-node single-drive) на PVC
   Longhorn в namespace `rustfs`. Бакеты пользователей, бэкапы Postgres и
   файлы статических сайтов — всё в нём.
3. **Тома сервисов только RWO.** RWX не нужен. Сервис с томом — максимум одна
   реплика (валидация в API и консоли).
4. **Локальная разработка: OrbStack + local-path.** Longhorn в OrbStack не
   работает (LXC, нет iSCSI netlink). `install.sh` получает режим хранилища
   `STORAGE_BACKEND=longhorn|local-path`; `scripts/cluster.sh` ставит
   `local-path`. Профили хранилища (Longhorn) в dev недоступны — консоль
   показывает это так же, как сейчас при отсутствии CSI-драйвера.
5. **Клиенты RustFS:** админ-операции — Job с образом `rustfs/rc` (тот же
   паттерн, что сейчас с `weed shell`); данные из API — S3 API через
   `@aws-sdk/client-s3` и `@aws-sdk/lib-storage` (новая зависимость, оправдана:
   SigV4, multipart, стриминг). Образы MinIO `mc` больше не публикуются — не
   использовать.
6. **Статические сайты:** файлы релизов в платформенном бакете
   `acceleratio-sites` под ключами `<workload>/<release>/…`. Под сайта:
   init-контейнер `rustfs/rc` зеркалирует свой релиз в `emptyDir`, затем
   `static-web-server` раздаёт его. У каждого сайта свой read-only ключ,
   ограниченный префиксом `acceleratio-sites/<workload>/*`. PV/PVC сайтов и
   CSI-монтирование исчезают.
7. **Профили хранилища у бакетов убираются** (`storage_class_id` в конфиге
   S3-бакета): все бакеты живут в одном RustFS. `ttl` из профиля заменяет
   lifecycle-правило бакета — только если понадобится, сейчас не делаем.

Фиксируемые версии (проверить актуальность в момент работы, пинить по digest,
как сейчас Alpine в бенчмарке):

| Компонент | Версия |
|---|---|
| Longhorn Helm chart | 1.13.0 |
| RustFS image | `rustfs/rustfs:1.0.5` (UID 10001) |
| rc image | `rustfs/rc:v0.1.37` |
| AWS SDK v3 | `@aws-sdk/client-s3`, `@aws-sdk/lib-storage` (последние) |

## Целевая архитектура

```
k3s ── Cilium
 ├─ longhorn-system      Longhorn 1.13 (UI выключен), StorageClass `longhorn` (default, platform)
 ├─ rustfs               Deployment rustfs (Recreate, 1 под) ─ PVC 'rustfs-data' на longhorn
 │                       Secret rustfs-root (ключ администратора), Service rustfs:9000
 ├─ acceleratio          API, консоль, registry (PVC на longhorn), Postgres платформы (hostPath, как сейчас)
 ├─ cnpg-system          CNPG; бэкапы баз → s3://<bucket-базы> на rustfs
 └─ project-*            сервисы (RWO PVC), сайты (init rc mirror → emptyDir), бакеты (ключи в Secret)
```

Переменные API (вместо всех `SEAWEEDFS_*`):

| Переменная | Значение по умолчанию | Назначение |
|---|---|---|
| `RUSTFS_NAMESPACE` | `rustfs` | где идут Job'ы `rc` и куда открывается сеть |
| `RUSTFS_S3_ENDPOINT` | `http://rustfs.rustfs.svc.cluster.local:9000` | адрес S3 для подов и CNPG |
| `RUSTFS_S3_API_ENDPOINT` | = `RUSTFS_S3_ENDPOINT` | адрес S3 для самого API; в dev — port-forward |
| `RUSTFS_ADMIN_SECRET` | `rustfs-root` | Secret с ключом администратора (в `RUSTFS_NAMESPACE`) |
| `RUSTFS_RC_IMAGE` | `rustfs/rc:v0.1.37@sha256:…` | образ Job'ов |
| `SITES_BUCKET` | `acceleratio-sites` | бакет файлов статических сайтов |
| `PLATFORM_STORAGE_CLASS` | `longhorn` | имя платформенного StorageClass |

## Этапы

Каждый этап — отдельный коммит (или несколько), после каждого
`cd apps/api && bun run test`, typecheck и lint зелёные. Тесты, которые
ломаются от изменения, правятся в том же коммите.

### 0. Подготовка

- Ветка от текущего `HEAD` ветки `command-palette-search` (в ней коммит
  `c638620` — правка UFW в `install.sh`, проверенная на реальной VM). Если
  ветка к моменту старта влита в `main` — от `main`.
- Прочитать `docs/FILE_STRUCTURE.md` и `docs/DATABASE.md` (конвенции модулей и
  миграций Drizzle).

### 1. Инсталлятор: Longhorn + RustFS вместо SeaweedFS

Файлы: `deploy/install.sh`, `deploy/uninstall.sh`, `deploy/update.sh`,
`deploy/install.env.example`, `deploy/README.md`.

`install.sh`:
- Удалить: все `SEAWEEDFS_*`, `install_seaweedfs`, `install_csi`,
  `write_seaweedfs_values`, `save_seaweedfs_s3_credentials`,
  `compute_seaweedfs_fullname`, проверку `/dev/fuse`, пакет `fuse3`, репозитории
  helm SeaweedFS, `seaweedfs-s3.env`.
- Новые переменные: `STORAGE_BACKEND` (`longhorn` по умолчанию, `local-path` для
  dev), `LONGHORN_CHART_VERSION`, `LONGHORN_NAMESPACE`, `LONGHORN_DATA_DIR`
  (`/var/lib/longhorn`), `LONGHORN_REPLICAS` (1), `RUSTFS_IMAGE`, `RC_IMAGE`,
  `RUSTFS_NAMESPACE`, `RUSTFS_SIZE`, `STORAGE_CLASS_NAME` (`longhorn`).
- Пакеты хоста (только для `longhorn`): `open-iscsi`, `systemctl enable --now
  iscsid`, `modprobe iscsi_tcp` + `/etc/modules-load.d/acceleratio.conf`.
- Preflight для `longhorn`: `iscsiadm` есть и `iscsid` реально работает. В
  LXC/OpenVZ он падает с `sendmsg: bug? ctrl_fd` — завершать с понятной ошибкой
  «Longhorn требует VM или bare metal; LXC/OpenVZ не поддерживаются». Сейчас
  такая же по смыслу проверка есть для FUSE — заменить её.
- multipathd (включён на Ubuntu Server): добавить в `/etc/multipath.conf`
  blacklist устройств Longhorn по vendor `IET` / product `VIRTUAL-DISK`, по
  документации Longhorn, и перезапустить multipathd, если он активен. Не
  блэклистить `sd*` целиком — у хоста может быть свой multipath.
- `install_longhorn`: helm `longhorn/longhorn` с `persistence.defaultClass=false`
  (платформенный класс создаём сами), `longhornUI.replicas=0`,
  `defaultSettings.defaultDataPath=$LONGHORN_DATA_DIR`,
  `defaultSettings.defaultReplicaCount={"v1":"$LONGHORN_REPLICAS"}`,
  `defaultSettings.storageOverProvisioningPercentage` ≈ 300 (тома тонкие; со
  значением по умолчанию 100% registry 50Gi + RustFS не помещаются на диск
  80 ГБ при `storageMinimalAvailablePercentage` 25),
  `defaultSettings.nodeDrainPolicy=block-for-eviction-if-contains-last-replica`
  (проверить имя и значения настройки в чарте 1.13). Дождаться
  `nodes.longhorn.io` в Ready.
- Платформенный StorageClass `longhorn` (свой манифест, default, `reclaimPolicy:
  Delete`, `allowVolumeExpansion: true`, `numberOfReplicas: $LONGHORN_REPLICAS`,
  `dataLocality: best-effort`); снять default с остальных классов, как сейчас.
- `local-path` (dev): не ставить Longhorn и open-iscsi; включить
  `local-storage` k3s (сейчас в `config.yaml` он в `disable:`), сделать
  `local-path` default. Тома без квот и без расширения — это ок для dev.
- `install_rustfs`: namespace, Secret `rustfs-root` со случайными ключами
  (сгенерировать, если Secret нет; не перегенерировать при повторном запуске),
  PVC `rustfs-data` (`RUSTFS_SIZE`, по умолчанию 50Gi) на платформенном классе,
  Deployment (`strategy: Recreate`, 1 реплика, `securityContext.fsGroup: 10001`
  или init-контейнер `chown 10001:10001` — на томе root образ падает с «File
  access denied»), `RUSTFS_VOLUMES=/data`, `RUSTFS_CONSOLE_ENABLE=false`,
  readiness по TCP 9000, ресурсы requests ~100m/128Mi. Service `rustfs:9000`.
  Создать бакет `acceleratio-sites` (Job `rc`). Сохранить
  `${CONFIG_DIR}/rustfs-s3.env` (0600) — эндпоинт и ключ администратора.
- Передать API переменные `RUSTFS_*` (там, где сейчас передаются
  `SEAWEEDFS_*`) и выдать сервис-аккаунту API право читать Secret
  `rustfs-root` в `rustfs` и создавать Job'ы там.
- `verify_installation`: PVC на платформенном классе пишется и читается (как
  сейчас), плюс S3 smoke test: Job `rc` кладёт и читает объект во временном
  бакете и удаляет его.
- `--reset`: Longhorn удаляется только с `deleting-confirmation-flag=true`;
  перед удалением k3s — `iscsiadm -m node --logoutall=all`; удалить
  `/var/lib/longhorn` (с той же защитой от опасных путей, что сейчас для
  `SEAWEEDFS_DATA_DIR`).
- `run_parallel`: группа `storage` = `install_longhorn install_rustfs
  verify_installation`.

`uninstall.sh`: helm uninstall Longhorn с флагом подтверждения, logout iSCSI,
удаление `/var/lib/longhorn`, `rustfs-s3.env`; убрать всё про SeaweedFS.

`update.sh`: таблица версий (Longhorn, RustFS, rc вместо SeaweedFS и CSI);
обновление Longhorn — только на соседнюю minor-версию за раз (требование
Longhorn), RustFS — замена образа (Recreate).

**Проверка этапа:** чистая установка на VM boat.dev (`default`, Ubuntu 24.04,
UFW включён), `--dry-run`, повторный запуск (идемпотентность), `--reset`,
`uninstall.sh`. Как запускать на boat — в разделе «Проверка на VM».

### 2. Слой RustFS в API

Новые файлы (по конвенциям `docs/FILE_STRUCTURE.md`, рядом с текущими):
- `apps/api/src/vendor/s3/s3.client.ts` — `S3Client` на `RUSTFS_S3_API_ENDPOINT`
  с ключом администратора из Secret (читать один раз, кешировать; path-style
  адресация, регион `us-east-1`). Хелперы: list (ListObjectsV2 с `Delimiter`),
  head, get (стрим), put (стрим через `lib-storage` `Upload`), delete prefix
  (ListObjectsV2 + DeleteObjects пачками по 1000).
- `apps/api/src/application/workload/s3-bucket/rustfs-jobs.ts` — замена
  `seaweedfs-jobs.ts`: `rustfsTarget()`, `rustfsS3Endpoint()`, `startBucketJob`,
  `readBucketJob`, `readBucketJobLog` (логика ожидания/перезапуска Job та же).
- `s3-bucket.manifests.ts`: `bucketCommands` → команды `rc`:
  - setup: `rc alias set admin $E $ADMIN_KEY $ADMIN_SECRET --bucket-lookup path`;
    `rc bucket create admin/<b>` (tolerate «exists» при повторе);
    `rc admin policy create admin bucket-<id> /tmp/policy.json` (политика
    генерируется в скрипте: ListBucket/GetBucketLocation/ListBucketMultipartUploads
    на бакет, Get/Put/Delete/AbortMultipart/ListMultipartUploadParts/*Tagging на
    `bucket/*`); `rc admin user add admin <ak> <sk>`;
    `rc admin policy attach admin bucket-<id> --user <ak>`.
  - rotate: добавить нового пользователя с политикой, удалить старого (старый
    ключ сразу 403 — проверено).
  - delete: `rc admin user remove`, `rc admin policy remove`,
    `rc bucket remove --force admin/<b>`; каждый шаг терпит «not found».
  - Ключи администратора и пользователя — только из env (Secret), не в тексте
    скрипта; вывод `rc`, который может содержать ключи, не логировать; ошибку
    отдавать одной строкой `BUCKET_ERROR`, как сейчас.
  - Имя бакета ≥ 3 символов (S3), проверить, что текущая валидация имени это
    гарантирует.
- Удалить `apps/api/src/vendor/seaweedfs/` целиком.

### 3. S3-бакеты

Файлы: `s3-bucket.service.ts`, `s3-bucket-objects.service.ts`,
`s3-bucket.config.ts`, `s3-bucket.manifests.ts`, тесты в `s3-bucket/tests/`,
`packages/shared/src/types/workload.ts`, фронтенд
`create-s3-bucket-form.tsx`, `s3-bucket-access-keys.tsx`, `utils/s3-bucket.ts`,
`api/workloads/s3-bucket-objects.ts`.

- Конфиг бакета без `storage_class_id`; `resolveForBucket` и связка бакет ↔
  профиль в `StorageClassService` удаляются.
- Обозреватель объектов: filer → S3 API (листинг по префиксу с папками через
  `CommonPrefixes`, скачивание стримом, загрузка стримом, удаление объекта и
  «папки» = префикса). Ограничения и сообщения об ошибках сохранить.
- Эндпоинт, который консоль показывает рядом с ключами, — `RUSTFS_S3_ENDPOINT`.
- Тексты консоли: убрать «SeaweedFS», «replication code», профиль хранилища в
  форме создания бакета.

### 4. Бэкапы Postgres

Файлы: `postgres-backup.service.ts`, `postgres.manifests.ts`, тесты.

- Бакет базы и его ключ — через новые Job'ы `rc` (тот же код, что у бакетов).
- `endpointURL` = `RUSTFS_S3_ENDPOINT`. Остальное не меняется (in-tree
  `barmanObjectStore`; переход на Barman Cloud Plugin — отдельная задача до
  CNPG 1.31, в этот план не входит).
- Текст «backups sit on the same SeaweedFS» → «on the same RustFS/Longhorn».

### 5. Статические сайты

Файлы: `static-workload.service.ts`, `static-workload.manifests.ts`,
`static-workload.config.ts`, `static-releases.controller.ts`, тесты в
`static/tests/`, фронтенд `api/workloads/static-releases.ts`.

- Загрузка файла: S3 PutObject (стрим) в `acceleratio-sites/<workload>/<release>/<path>`
  ключом администратора. `requireIndex` → HeadObject `…/index.html`.
- Удаление сайта: delete prefix `<workload>/` + удаление ключа сайта; при
  недоступности RustFS — как сейчас: проект удаляется, остаток пишется в лог.
- Ключ сайта: при создании сайта Job `rc` создаёт пользователя с политикой
  `s3:GetObject` на `acceleratio-sites/<workload>/*` и `s3:ListBucket` с
  условием `s3:prefix` = `<workload>/*`; ключ — Secret в namespace проекта.
- Манифест: убрать PV/PVC/`SITE_ACCESS_MODE`/`SITE_VOLUME_SIZE`; добавить
  `emptyDir` `/site` и init-контейнер `rc` (`rc mirror
  site/acceleratio-sites/<workload>/<release>/ /site/<release>/`) с ключом из
  Secret сайта. Аргументы `static-web-server` и readiness-проба те же; rolling
  update и откат по `release_id` работают как раньше (новый под — новое
  зеркалирование).
- Обновить `docs/PRODUCT.md` (сайты): файлы хранятся в RustFS, под копирует
  релиз при старте; время старта пода растёт с размером сайта.

### 6. Профили хранилища (StorageClass) на Longhorn

Файлы: `packages/shared/src/types/storage-class.ts`,
`storage-class/storage-class.config.ts`, `storage-class.manifests.ts`,
`storage-class.service.ts`, `storage-class.status.ts`,
`schemas/storage-class.schema.ts`, тесты, фронтенд
`settings/containers/storage-class-dialog.tsx`, `storage-settings.tsx`,
`settings/utils/storage-class-form.ts`, `docs/DATABASE.md`.

- `StorageClassParameters` (новый набор, всё прочее удалить):
  `number_of_replicas` (1–3), `data_locality` (`disabled` | `best-effort` |
  `strict-local`), `fs_type` (`ext4` | `xfs`), `disk_selector` (теги дисков
  Longhorn или null), `node_selector` (теги узлов Longhorn или null).
  Маппинг в параметры Longhorn: `numberOfReplicas`, `dataLocality`, `fsType`,
  `diskSelector`, `nodeSelector` (строки; селекторы — через запятую).
- `provisioner`: `driver.longhorn.io`. Платформенный класс по умолчанию —
  `longhorn` (`DEFAULT_PLATFORM_STORAGE_CLASS_NAME`, переменная
  `PLATFORM_STORAGE_CLASS`).
- `StorageEnvironment`: `csi_driver_installed` = есть CSIDriver
  `driver.longhorn.io`; `volume_servers` → `storage_nodes` (число
  `nodes.longhorn.io` с `allowScheduling` и Ready). Валидация: число реплик не
  больше `storage_nodes`, с понятной ошибкой. В dev (`local-path`) драйвера нет —
  профили недоступны, как сейчас без CSI.
- Колонка `parameters` — jsonb, SQL-миграция для смены формы не нужна; если в
  схеме/enum есть упоминания SeaweedFS — поправить комментарии. Миграцию
  Drizzle создавать только если меняются колонки (по `docs/DATABASE.md`).
- `Retain`-профили: оставить запрет для томов сервисов, как сейчас.
- Бенчмарк хранилища (`storage-class/benchmark`) не зависит от драйвера —
  только убрать упоминания SeaweedFS.
- Консоль: поля диалога под новые параметры, подсказки на языке продукта
  («копий на разных серверах», «держать копию рядом с сервисом»).

### 7. Тома сервисов и registry

Файлы: `docker-workload.manifests.ts`, `docker-workload.config.ts`,
`docker-workload.service.ts`, тесты, фронтенд (форма реплик/томов сервиса),
`modules/workloads/utils/volume-usage.ts`.

- `VOLUME_ACCESS_MODE = 'ReadWriteOnce'`; комментарий про SeaweedFS убрать.
- Валидация: `replicas > 1` вместе с томами — ошибка 400 с понятным текстом;
  в консоли поле реплик заблокировано с подсказкой, когда у сервиса есть том.
- `volume-usage.ts`: пороги оставить (85/95%), комментарий — Longhorn/ext4.
- Registry: PVC на платформенном классе, RWO (проверить манифест в
  `install.sh`).
- `docs/PRODUCT.md`: размер тома — реальный размер ext4, а не квота; запись
  при заполнении получает `ENOSPC` от файловой системы; одна реплика сервиса с
  томом.

### 8. Узлы, статус платформы, версии

Файлы: `node/node-drain-plan.ts`, `node-drain.service.ts`,
`node-join-script.ts`, `node-join.service.ts`, тесты в `node/tests/`,
`packages/shared/src/types/node.ts`, `system/system-status.service.ts`,
`platform-update/platform-version.service.ts`.

- Drain plan: убрать риск `seaweedfs`; добавить риск `longhorn_last_replica`:
  том, единственная здоровая реплика которого на этом узле (читать
  `replicas.longhorn.io` / `volumes.longhorn.io`). Тип в `node.ts`:
  `kind: "persistent_volume" | "longhorn_replica"`. С политикой
  `block-for-eviction-if-contains-last-replica` Longhorn сам переносит реплику
  при drain, если есть куда, — план должен это объяснять, а не блокировать
  молча.
- Join: preflight — `ISCSI=1/0` (есть `iscsiadm` и активен/запускается
  `iscsid`), обязательная проверка; скрипт присоединения ставит `open-iscsi` и
  включает `iscsid` (и multipath blacklist, как в `install.sh`). FUSE больше не
  требуется.
- System status: компонент «Longhorn» (namespace `longhorn-system`) и
  «RustFS» (`rustfs`) вместо SeaweedFS.
- Platform version: чарт `longhorn` и образ RustFS вместо `seaweedfs` и
  `seaweedfs-csi-driver`.

### 9. Изоляция проектов (Cilium)

Файлы: `project/project-isolation.service.ts`, тест.

- Egress из namespace проекта разрешён только в `rustfs` на порт `9000/TCP`
  (селектор подов RustFS по label из манифеста инсталлятора), вместо filer
  SeaweedFS на `8333`.
- Longhorn не требует правил для подов проектов (iSCSI идёт на уровне хоста) —
  проверить на VM, что том проекта монтируется при включённой изоляции.
- Прогнать `bun run test:cluster` (проверки приватной сети).

### 10. Локальная разработка

Файлы: `scripts/cluster.sh`, `scripts/dev.sh`, `Makefile`, `AGENTS.md`,
`README.md`.

- `cluster.sh up`: передать `STORAGE_BACKEND=local-path` в `install.sh`.
- `dev.sh`: перед запуском API — `kubectl -n rustfs port-forward svc/rustfs
  <свободный порт>:9000` в фоне (убивать при выходе), экспорт
  `RUSTFS_S3_API_ENDPOINT=http://127.0.0.1:<порт>`. Нужен потому, что API в dev
  работает на маке и не видит DNS кластера, а SigV4 не проходит через proxy
  API-сервера (меняется путь). Через port-forward подпись валидна: заголовок
  Host сохраняется.
- Тексты (`Makefile`, `AGENTS.md`, `README.md`): «SeaweedFS» → «RustFS,
  local-path (dev) / Longhorn (сервер)».
- Проверка: `make cluster-down && make dev` с нуля на маке: создать проект,
  сервис с томом, Postgres с бэкапом, бакет (ключи, загрузка в обозревателе),
  статический сайт (загрузка, публикация, откат).

### 11. Документация

`docs/PRODUCT.md`, `docs/FILE_STRUCTURE.md` (vendor/s3 вместо
vendor/seaweedfs), `docs/DATABASE.md` (описание `storage_class`), `README.md`,
`deploy/README.md`, `SECURITY.md`, `AGENTS.md`, `deploy/install.env.example`.
В PRODUCT.md убрать оговорки про слабую надёжность SeaweedFS для баз, честно
описать: одна реплика по умолчанию на одном узле; реплики — через профиль;
требование к сети между узлами для реплик.

### 12. Чистка

- `git grep -i -e seaweed -e filer -e "weed shell" -e fuse3` — пусто.
- Удалить неиспользуемые экспорты/константы, env-переменные из `.env.example`.
- `bun run test`, typecheck, lint для api, frontend, shared.

## Проверка на VM (boat.dev)

Ключ API boat.dev пользователь даёт в чате; хранить только во временном файле
с правами 0600 и удалить после. Пробный период: размер `default` (4 vCPU,
8 ГБ, 51 ГБ), не больше 2 VM, автоостановка ≤ 2 ч. Особенности, на которые уже
наступали:

- Команда API (`POST /sandboxes/{id}/commands`) живёт ≤ 600 с, и процессы,
  запущенные из неё, убиваются по её завершении. Долгое (инсталлятор,
  бенчмарки) запускать через `sudo systemd-run --unit=…` и опрашивать.
- На образе включены UFW и swap: swap выключить (`swapoff -a` + fstab);
  UFW теперь обрабатывает `install.sh`.
- Приватной сети между VM нет: `192.168.122.x` — свой NAT на каждом хосте,
  `wg0` между песочницами не маршрутизируется. Для нескольких узлов — свой
  WireGuard поверх публичного IPv6. Сеть нестабильна (RTT рос с 0,6 до 38 мс
  после ~12 ГиБ трафика) — для чистых цифр не годится, для функциональных
  проверок — да.
- Не выключать UFW целиком (классификатор безопасности блокирует) — только
  узкие правила.

Сценарий приёмки (одна VM, затем две для узлов):
1. `install.sh` с нуля → всё Ready, smoke test (PVC + S3) прошёл.
2. Консоль: проект; Docker-сервис с томом (запись, рестарт, данные на месте;
   попытка 2 реплик с томом — понятная ошибка); Postgres: бэкап по кнопке,
   WAL архивируется, восстановление в новую базу; S3-бакет: создать, ключи,
   ротация (старый ключ 403), обозреватель (загрузка/скачивание/удаление
   папки), удаление бакета с данными; статический сайт: загрузка, публикация,
   новый релиз, откат, 404.html, удаление.
3. Профиль хранилища с 2 репликами на одном узле — ошибка валидации; на двух
   узлах — том с репликами на обоих.
4. Присоединение второго узла из консоли (preflight показывает iSCSI), drain
   узла с единственной репликой — план объясняет перенос реплики.
5. `install.sh --reset`, затем `uninstall.sh` — хост чистый (нет
   `/var/lib/longhorn`, iSCSI-сессий, правил UFW с меткой).
6. Повтор пункта 2 в dev (`make dev`, OrbStack + local-path), кроме профилей.

## Риски и открытые вопросы

- **RustFS молодой** (1.0 — сентябрь 2026, патчи раз в ~2 недели). Пинить по
  digest; перед обновлением гонять сценарий приёмки. Single-node режим не
  расширяется на месте: переход на распределённый RustFS — новое развёртывание
  и перенос по S3. На Longhorn это смягчено (реплики тома, рост PVC).
- **`rc` — версия 0.1.x.** Если его поведение/вывод нестабильны для Job'ов —
  запасной вариант: админ-API RustFS (совместим с MinIO madmin) напрямую из API.
- **Longhorn не сбрасывает кеш диска на fsync** (пишет O_DIRECT без FLUSH):
  надёжно на дисках с защитой от потери питания. Написать это в
  `deploy/README.md` в требованиях к железу.
- **Несколько узлов:** реплика Longhorn ждёт подтверждения по сети; на гигабите
  Postgres ~4× медленнее; нестабильная сеть выбивает реплики (видели
  `degraded`). В требованиях — отдельная быстрая сеть между узлами. Для Postgres
  можно держать 1 реплику Longhorn и реплики CNPG — не проверено, не входит.
- **Размеры по умолчанию** (`RUSTFS_SIZE` 50Gi, registry 50Gi) на диске 50–80
  ГБ: зависят от over-provisioning Longhorn — проверить, что оба тома
  планируются на `default`-VM boat.
- **CNPG in-tree barman удаляется в CNPG 1.31** — отдельная задача.
- **dev ≠ сервер по хранилищу** (local-path): ошибки, специфичные для Longhorn
  (attach/detach, реплики, расширение), ловятся только на VM.

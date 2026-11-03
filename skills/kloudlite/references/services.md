# Service catalogue

Copy a row into `env` action `create` or `service` action `add`. A mount is `{"folder": NAME, "path": PATH}`. Mount in the same call that creates the service: data written before a mount is lost. Pick a strong password and store it as a secret (`${{ secrets.NAME }}`); never write a value into `env`.

Checked on 2026-11-03 against the image page or the vendor documentation named in the last column. A fact marked "unconfirmed" was not on the page that was read; check it before you rely on it.

| Image | Ports | Data mount | Required env | Notes | Source |
|---|---|---|---|---|---|
| `postgres:16` | 5432 (unconfirmed on the page) | `/var/lib/postgresql/data` | `POSTGRES_PASSWORD` (not empty); `POSTGRES_USER` default `postgres` | Init scripts in `/docker-entrypoint-initdb.d` run only on an empty data directory. For `postgres:18` and later the volume is `/var/lib/postgresql`, not `…/data`: a wrong path loses data on re-create. | Docker Hub `postgres` |
| `mysql:8` | 3306 (unconfirmed on the page) | `/var/lib/mysql` | `MYSQL_ROOT_PASSWORD` | Accepts no connection until first initialization ends: wait for the service to be ready. The root password variable is ignored when the data directory already holds a database. | Docker Hub `mysql` |
| `mongo:7` | 27017 | `/data/db`; also `/data/configdb` only for a config server | none. `MONGO_INITDB_ROOT_USERNAME` and `MONGO_INITDB_ROOT_PASSWORD` together create a root user and turn auth on | Both variables work only on an empty data directory. | Docker Hub `mongo` |
| `redis:7` | 6379 (unconfirmed on the page) | `/data`, only when persistence is on | none | Redis saves `dump.rdb` snapshots by default, into `/data`; with no mount they are lost on a re-create (harmless for a cache). To keep data, mount `/data`; for a different save rule use a command such as `["redis-server", "--save", "60", "1"]`. | Docker Hub `redis` |
| `rabbitmq:3-management` | 5672 (AMQP), 15672 (management) | `/var/lib/rabbitmq` | none. `RABBITMQ_DEFAULT_USER` and `RABBITMQ_DEFAULT_PASS` replace `guest`/`guest` | Data is kept under the node name, which defaults to the hostname. Keep the service name fixed so a restart finds its data. | Docker Hub `rabbitmq` |
| `minio/minio` | 9000 (API), 9001 (console) | `/data` | `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` (names unconfirmed on the pages read; default `minioadmin:minioadmin`) | `command`: `["server", "/data", "--console-address", ":9001"]`. The community repository was archived on 2026-04-25 and gets no fixes: tell the user. | github.com/minio/minio |
| `elasticsearch:8.15.5` (use `docker.elastic.co/elasticsearch/elasticsearch:8.15.5`) | 9200 | `/usr/share/elasticsearch/data` | `ES_SETTING_DISCOVERY_TYPE=single-node` (the Docker guide's env form of `discovery.type`; an env name with dots is refused with 422) | Set `resources` (all four): `{"cpuRequest": "1", "cpuLimit": "2", "memoryRequest": "4Gi", "memoryLimit": "4Gi"}`. Without the setting the pod runs in production mode and its bootstrap checks fail. Needs `vm.max_map_count` at 262144 on the node. Security is on by default: the first start prints the `elastic` password once; set `ELASTIC_PASSWORD` to choose it. | elastic.co 8.15 Docker guide |
| `nats:2` | 4222 (clients), 8222 (monitoring), 6222 (cluster) | `/data` with `command` `["-js", "-sd", "/data"]` | none | Without `-js` there is no JetStream and nothing to keep. The page names `/data` as an example, not a default. | Docker Hub `nats` |
| `axllent/mailpit` | 1025 (SMTP), 8025 (web) | none. Optional: `/data` with `MP_DATABASE=/data/mailpit.db` | none | Catches mail for tests. Point the app's SMTP at `mail:1025`. | mailpit.axllent.org |

## Example, the shop

```json
[
  {"name": "db", "image": "postgres:16", "ports": [5432],
   "env": {"POSTGRES_PASSWORD": "${{ secrets.DB_PASSWORD }}"},
   "mounts": [{"folder": "pg-data", "path": "/var/lib/postgresql/data"}]},
  {"name": "cache", "image": "redis:7", "ports": [6379]}
]
```

`api`, `worker` and `web` are the user's code. Add each as a service with its published image and ports, so callers have a name to dial; develop it in a workspace and intercept the service. Do not build an image for each change.
